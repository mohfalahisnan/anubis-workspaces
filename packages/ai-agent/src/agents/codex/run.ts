import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { JsonRpcClient } from './jsonrpc.js'
import { CodexPool } from './pool.js'
import { TypedEmitter, type AgentEventMap } from '../../events/stream.js'
import { wrapPromptWithSystem } from '../wrap-system-prompt.js'
import type { ReasoningEffort } from '../catalog.js'

export interface CodexRunOpts {
  workspaceId: string
  sessionId: string
  codexThreadId?: string
  cwd: string
  prompt: string
  model?: string
  reasoningEffort?: ReasoningEffort
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  appendSystemPrompt?: string
  onSession?: (sessionId: string) => void
}

export interface SpawnCodexOpts {
  command?: string
  env?: NodeJS.ProcessEnv
  cwd: string
  configOverrides?: string[]
}

export class CodexAgent {
  private clients = new Map<string, JsonRpcClient>()
  private threadIds = new Map<string, string>()
  private initialized = new Set<string>()
  private activeEmitters = new Map<string, TypedEmitter<AgentEventMap>>()

  constructor(private pool: CodexPool) {}

  private key(o: { workspaceId: string; sessionId: string }): string {
    return `${o.workspaceId}::${o.sessionId}`
  }

  private async initialize(k: string, client: JsonRpcClient): Promise<void> {
    if (this.initialized.has(k)) return
    await client.request('initialize', {
      clientInfo: {
        name: 'anubis_ai_agent',
        title: '@anubis/ai-agent',
        version: '0.1.5',
      },
    })
    client.notify('initialized')
    this.initialized.add(k)
  }

  async run(opts: CodexRunOpts): Promise<TypedEmitter<AgentEventMap>> {
    const emitter = new TypedEmitter<AgentEventMap>()
    const k = this.key(opts)
    this.activeEmitters.set(k, emitter)

    const child = await this.pool.acquire({
      workspaceId: opts.workspaceId,
      sessionId: opts.sessionId,
    })

    let client = this.clients.get(k)
    if (!client) {
      client = new JsonRpcClient(child.stdout, child.stdin)
      this.clients.set(k, client)

      const toolNamesById = new Map<string, string>()
      const localClient = client

      client.onRequest = (req) => {
        const p = (req.params ?? {}) as any
        switch (req.method) {
          case 'item/commandExecution/requestApproval':
          case 'item/fileChange/requestApproval':
            this.emit(k, 'approval_required', {
              approvalId: String(req.id),
              kind: req.method,
              payload: p,
            })
            localClient.respond(req.id, { decision: 'decline' })
            return
          case 'item/permissions/requestApproval':
            this.emit(k, 'approval_required', {
              approvalId: String(req.id),
              kind: req.method,
              payload: p,
            })
            localClient.respond(req.id, { permissions: {}, scope: 'turn' })
            return
          case 'item/tool/requestUserInput':
            this.emit(k, 'approval_required', {
              approvalId: String(req.id),
              kind: req.method,
              payload: p,
            })
            localClient.respond(req.id, { action: 'cancel' })
            return
          case 'applyPatchApproval':
          case 'execCommandApproval':
            this.emit(k, 'approval_required', {
              approvalId: String(req.id),
              kind: req.method,
              payload: p,
            })
            localClient.respond(req.id, { decision: 'denied' })
            return
          default:
            localClient.respondError(req.id, -32601, `Method not found: ${req.method}`)
        }
      }

      client.onNotification = (n) => {
        const params = (n.params ?? {}) as any
        const msg = params.msg ?? params
        const methodType = n.method.startsWith('codex/event/')
          ? n.method.slice('codex/event/'.length)
          : n.method
        const eventType = msg.type ?? methodType

        switch (eventType) {
          case 'codex/event/agent_message_delta':
          case 'agent_message_delta':
          case 'item/agentMessage/delta':
            this.emit(k, 'partial', {
              deltaText: msg.delta ?? msg.text ?? '',
            })
            break
          case 'codex/event/exec_command_begin':
          case 'exec_command_begin':
          case 'item_started':
          case 'item/started': {
            const itemType = msg.item?.type ?? msg.type ?? 'item'
            if (isNonToolItem(itemType)) break
            const name = normalizeToolName(itemType)
            const id = toolEventId(msg, params)
            if (id) toolNamesById.set(id, name)
            this.emit(k, 'tool_call', {
              name,
              args: msg.item ?? msg,
            })
            break
          }
          case 'codex/event/exec_command_end':
          case 'exec_command_end':
          case 'item_completed':
          case 'item/completed': {
            const itemType = msg.item?.type ?? msg.type ?? 'item'
            if (isNonToolItem(itemType)) break
            const id = toolEventId(msg, params)
            const name = (id && toolNamesById.get(id)) ?? normalizeToolName(itemType)
            if (id) toolNamesById.delete(id)
            this.emit(k, 'tool_result', {
              name,
              result: msg.item ?? msg,
            })
            break
          }
          case 'codex/event/exec_approval_request':
          case 'exec_approval_request':
          case 'codex/event/apply_patch_approval_request':
          case 'apply_patch_approval_request':
          case 'askForApproval':
          case 'item/tool/requestUserInput':
            this.emit(k, 'approval_required', {
              approvalId: msg.requestId ?? msg.id ?? params.id,
              kind: eventType,
              payload: msg,
            })
            break
          case 'codex/event/task_complete':
          case 'task_complete':
          case 'turn/completed':
            if (msg.last_agent_message) {
              this.emit(k, 'partial', { deltaText: msg.last_agent_message })
            }
            this.emit(k, 'done', {
              finishReason: 'stop',
              usage: msg,
            })
            this.activeEmitters.delete(k)
            this.pool.release({
              workspaceId: opts.workspaceId,
              sessionId: opts.sessionId,
            })
            break
          case 'error':
            this.emit(k, 'error', { error: new Error(msg.message ?? 'Codex stream error') })
            break
          case 'stream_error':
            break
        }
      }

      child.on('error', (error) => {
        this.emit(k, 'error', { error })
      })
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim()
        if (text) {
          this.emit(k, 'tool_result', {
            name: 'codex_stderr',
            result: text,
          })
        }
      })
    }

    await this.initialize(k, client)

    let threadId = this.threadIds.get(k) ?? opts.codexThreadId
    if (!threadId) {
      const res = await client.request<any>('thread/start', {
        model: opts.model ?? 'gpt-5.5',
        modelReasoningEffort: opts.reasoningEffort,
        cwd: opts.cwd,
        approvalPolicy: opts.approvalPolicy ?? 'never',
        sandbox: opts.sandboxMode ?? 'workspace-write',
      })
      threadId = res?.thread?.id ?? res?.threadId ?? res?.conversationId ?? res?.id
      if (!threadId) {
        throw new Error(`thread/start returned no id: ${JSON.stringify(res)}`)
      }
      this.threadIds.set(k, threadId)
      opts.onSession?.(threadId)
      this.emit(k, 'session', { sessionId: threadId })
    } else if (!this.threadIds.has(k)) {
      this.threadIds.set(k, threadId)
      opts.onSession?.(threadId)
      this.emit(k, 'session', { sessionId: threadId })
    } else {
      opts.onSession?.(threadId)
      this.emit(k, 'session', { sessionId: threadId })
    }

    await client.request('turn/start', {
      threadId,
      input: [
        {
          type: 'text',
          text: wrapPromptWithSystem(opts.prompt, opts.appendSystemPrompt),
        },
      ],
    })
    return emitter
  }

  private emit<K extends keyof AgentEventMap>(k: string, event: K, data: AgentEventMap[K]): void {
    this.activeEmitters.get(k)?.emit(event, data)
  }

  static spawnCodex(opts: SpawnCodexOpts): ChildProcessWithoutNullStreams {
    const args: string[] = []
    for (const kv of opts.configOverrides ?? []) {
      args.push('-c', kv)
    }
    args.push('app-server')

    return spawn(opts.command ?? process.env.ANUBIS_CODEX_COMMAND ?? 'codex', args, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }
}

const NON_TOOL_ITEM_TYPES = new Set<string>([
  'agentMessage',
  'agent_message',
  'userMessage',
  'user_message',
  'reasoning',
  'thinking',
])

function isNonToolItem(type: string): boolean {
  return NON_TOOL_ITEM_TYPES.has(type)
}

function toolEventId(msg: any, params: any): string | undefined {
  return (
    msg.item?.id ??
    msg.item?.call_id ??
    msg.id ??
    msg.call_id ??
    params.id ??
    params.call_id
  )
}

function normalizeToolName(type: string): string {
  return type
    .replace(/Output$/, '')
    .replace(/Result$/, '')
}
