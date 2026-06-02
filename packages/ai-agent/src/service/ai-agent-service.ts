import { randomUUID } from 'node:crypto'
import { AGENTS, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, MODELS, REASONING_EFFORTS } from '../agents/catalog.js'
import type { Agent, ReasoningEffort } from '../agents/catalog.js'
import { extractUsage, type ExtractedUsage } from '../agents/usage.js'
import { CodexAgent } from '../agents/codex/run.js'
import { CodexPool } from '../agents/codex/pool.js'
import { ClaudeAgent } from '../agents/claude/runner.js'
import type { AgentEventMap, AgentStream } from '../events/stream.js'

export interface AiAgentServiceOptions {
  codexCommand?: string
  claudeCommand?: string
  codexIdleMs?: number
  env?: NodeJS.ProcessEnv
}

export interface RunAgentInput {
  agent: Agent
  workspaceId?: string
  sessionId?: string
  prevAgentSessionId?: string
  cwd: string
  prompt: string
  model?: string
  profile?: string
  extraEnv?: Record<string, string>
  appendSystemPrompt?: string
  yolo?: boolean
  reasoningEffort?: ReasoningEffort
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  allowedTools?: string[]
  disallowedTools?: string[]
}

export type AgentEvent =
  | { type: 'partial'; data: AgentEventMap['partial'] }
  | { type: 'tool_call'; data: AgentEventMap['tool_call'] }
  | { type: 'tool_result'; data: AgentEventMap['tool_result'] }
  | { type: 'approval_required'; data: AgentEventMap['approval_required'] }
  | { type: 'session'; data: AgentEventMap['session'] }
  | { type: 'done'; data: AgentEventMap['done'] }

export interface RunAgentResult {
  ok: true
  agent: Agent
  workspaceId: string
  sessionId: string
  agentSessionId?: string
  text: string
  events: AgentEvent[]
  usage?: ExtractedUsage
}

export class AiAgentService {
  private codex: CodexAgent
  private claude: ClaudeAgent

  constructor(private opts: AiAgentServiceOptions = {}) {
    const env = opts.env ?? process.env
    const pool = new CodexPool({
      idleMs: opts.codexIdleMs ?? 10 * 60 * 1000,
      spawn: () =>
        CodexAgent.spawnCodex({
          command: opts.codexCommand,
          cwd: process.cwd(),
          env,
        }),
    })

    this.codex = new CodexAgent(pool)
    this.claude = new ClaudeAgent({
      command: opts.claudeCommand,
      env,
    })
  }

  catalog() {
    return {
      agents: AGENTS,
      models: MODELS,
      defaultModel: DEFAULT_MODEL,
      reasoningEfforts: REASONING_EFFORTS,
      defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    }
  }

  async streamAgent(input: RunAgentInput): Promise<{
    stream: AgentStream
    workspaceId: string
    sessionId: string
    agentSessionId?: string
  }> {
    const workspaceId = input.workspaceId ?? 'default'
    const sessionId = input.sessionId ?? randomUUID()
    let agentSessionId: string | undefined

    if (input.agent === 'codex') {
      const stream = await this.codex.run({
        workspaceId,
        sessionId,
        codexThreadId: input.prevAgentSessionId,
        cwd: input.cwd,
        prompt: input.prompt,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        appendSystemPrompt: input.appendSystemPrompt,
        sandboxMode: input.yolo ? 'danger-full-access' : input.sandboxMode,
        approvalPolicy: input.yolo ? 'never' : input.approvalPolicy,
        onSession: (id) => {
          agentSessionId = id
        },
      })

      return {
        workspaceId,
        sessionId,
        agentSessionId,
        stream,
      }
    }

    const mode = input.yolo
      ? 'bypassPermissions'
      : input.permissionMode ?? 'plan'
    const { emitter } = await this.claude.run({
      workspaceId,
      sessionId,
      claudeResumeId: input.prevAgentSessionId,
      cwd: input.cwd,
      prompt: input.prompt,
      model: input.model,
      profile: input.profile,
      extraEnv: input.extraEnv,
      permissionMode: mode,
      allowedTools: input.allowedTools,
      disallowedTools: input.disallowedTools,
      appendSystemPrompt: input.appendSystemPrompt,
    })

    return {
      workspaceId,
      sessionId,
      stream: emitter,
    }
  }

  async runAgent(input: RunAgentInput): Promise<RunAgentResult> {
    const { stream, workspaceId, sessionId, agentSessionId: initialAgentSessionId } = await this.streamAgent(input)
    const events: AgentEvent[] = []
    let text = ''
    let agentSessionId: string | undefined = initialAgentSessionId
    let usage: ExtractedUsage | undefined

    if (initialAgentSessionId) {
      events.push({
        type: 'session',
        data: { sessionId: initialAgentSessionId },
      })
    }

    return new Promise<RunAgentResult>((resolve, reject) => {
      stream.on('partial', (data) => {
        text += data.deltaText
        events.push({ type: 'partial', data })
      })
      stream.on('tool_call', (data) => {
        events.push({ type: 'tool_call', data })
      })
      stream.on('tool_result', (data) => {
        events.push({ type: 'tool_result', data })
      })
      stream.on('approval_required', (data) => {
        events.push({ type: 'approval_required', data })
      })
      stream.on('session', (data) => {
        agentSessionId = data.sessionId
        events.push({ type: 'session', data })
      })
      stream.on('done', (data) => {
        usage = extractUsage(input.agent, data.usage)
        events.push({ type: 'done', data })
        resolve({
          ok: true,
          agent: input.agent,
          workspaceId,
          sessionId,
          agentSessionId,
          text,
          events,
          usage,
        })
      })
      stream.on('error', ({ error }) => {
        reject(error)
      })
    })
  }
}

export function createAiAgentService(options?: AiAgentServiceOptions): AiAgentService {
  return new AiAgentService(options)
}
