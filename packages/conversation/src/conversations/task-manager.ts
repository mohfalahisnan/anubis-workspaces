import type { AgentEventMap, AiAgentService } from '@anubis/ai-agent'
import { TypedEmitter } from '@anubis/ai-agent'
import { nowMs } from '../util/time.js'
import type { ResolvedProfile, AgentKind } from '../profiles/types.js'

export interface AgentTask {
  conversationId: string
  agent: AgentKind
  status: 'pending' | 'running' | 'finished' | 'error'
  agentSessionId?: string
  lastActivityAt: number
  emitter: TypedEmitter<AgentEventMap>
  sendMessage(input: { prompt: string; msgId: string }): Promise<void>
  cancel(): Promise<void>
}

export interface ConversationLite {
  id: string
  agent: AgentKind
  workspacePath: string
}

export interface TurnInput {
  prompt: string
  msgId: string
  appendSystemPrompt?: string
  files?: string[]
  prevAgentSessionId?: string
  /** Qoder personal access token from settings, forwarded to the qoder runner. */
  qoderApiKey?: string
}

export interface TaskManagerOpts {
  idleMs: number
  scanIntervalMs?: number
}

export class TaskManager {
  private tasks = new Map<string, AgentTask>()
  private building = new Map<string, Promise<AgentTask>>()
  private cancelledWhileBuilding = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private aiAgent: Pick<AiAgentService, 'streamAgent'>,
    private opts: TaskManagerOpts,
  ) {
    const interval = opts.scanIntervalMs ?? 60_000
    this.timer = setInterval(() => this.scan(), interval)
    this.timer.unref?.()
  }

  subscribe(conversationId: string): TypedEmitter<AgentEventMap> | null {
    return this.tasks.get(conversationId)?.emitter ?? null
  }

  isBusy(conversationId: string): boolean {
    if (this.building.has(conversationId)) return true
    const task = this.tasks.get(conversationId)
    return task?.status === 'pending' || task?.status === 'running'
  }

  async getOrBuild(
    conv: ConversationLite,
    profile: ResolvedProfile,
    turn: TurnInput,
  ): Promise<AgentTask> {
    const existing = this.tasks.get(conv.id)
    if (existing) {
      if (existing.status === 'pending' || existing.status === 'running') {
        throw new Error(`Conversation ${conv.id} already has a running agent task`)
      }
      existing.lastActivityAt = nowMs()
      this.tasks.delete(conv.id)
    }
    const inflight = this.building.get(conv.id)
    if (inflight) return inflight

    const promise = (async () => {
      const { stream, agentSessionId, cancel: cancelRun } = await this.aiAgent.streamAgent({
        agent: profile.agent,
        workspaceId: conv.id,
        sessionId: conv.id,
        prevAgentSessionId: turn.prevAgentSessionId,
        cwd: conv.workspacePath,
        prompt: turn.prompt,
        model: profile.model,
        claudeCliProfile: profile.claudeCliProfile,
        extraEnv: profile.env,
        appendSystemPrompt: turn.appendSystemPrompt ?? profile.appendSystemPrompt,
        files: turn.files,
        reasoningEffort: profile.reasoningEffort,
        sandboxMode: profile.sandboxMode,
        approvalPolicy: profile.approvalPolicy,
        permissionMode: profile.permissionMode,
        allowedTools: profile.allowedTools,
        disallowedTools: profile.disallowedTools,
        qoderApiKey: turn.qoderApiKey,
      })
      const task: AgentTask = {
        conversationId: conv.id,
        agent: conv.agent,
        status: 'running',
        agentSessionId,
        lastActivityAt: nowMs(),
        emitter: stream,
        sendMessage: async () => {
          throw new Error('Re-sending into an existing task is not supported yet; spawn a new turn instead.')
        },
        cancel: async () => {
          // Actually terminate the spawned agent run (kills the CLI child /
          // interrupts the codex turn). Without this, Stop only drops the
          // bookkeeping entry while the real process keeps running, holds the
          // agent session, and blocks the next turn from resuming it.
          try {
            await cancelRun?.()
          } finally {
            this.tasks.delete(conv.id)
          }
        },
      }
      task.emitter.on('session', (d) => { task.agentSessionId = d.sessionId; task.lastActivityAt = nowMs() })
      task.emitter.on('partial', () => { task.lastActivityAt = nowMs() })
      task.emitter.on('tool_call', () => { task.lastActivityAt = nowMs() })
      task.emitter.on('tool_result', () => { task.lastActivityAt = nowMs() })
      task.emitter.on('done', () => { task.status = 'finished' })
      task.emitter.on('error', () => { task.status = 'error' })
      this.tasks.set(conv.id, task)
      // A kill that landed while we were still spawning recorded the id here.
      // Tear the freshly-spawned run down now that the child actually exists.
      // (UI/DB state was already settled by ConversationService.cancel.)
      if (this.cancelledWhileBuilding.delete(conv.id)) {
        await task.cancel()
      }
      return task
    })()

    this.building.set(conv.id, promise)
    try {
      return await promise
    } finally {
      this.building.delete(conv.id)
    }
  }

  async kill(conversationId: string, _reason: 'idle' | 'user' | 'shutdown'): Promise<void> {
    const t = this.tasks.get(conversationId)
    if (t) {
      await t.cancel()
      this.tasks.delete(conversationId)
      return
    }
    // No live task yet, but a spawn may be in flight. Flag it so the build's
    // continuation kills the run the moment the child exists — instead of
    // silently dropping the Stop and letting an unstoppable turn proceed.
    if (this.building.has(conversationId)) {
      this.cancelledWhileBuilding.add(conversationId)
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    await Promise.all([...this.tasks.keys()].map(id => this.kill(id, 'shutdown')))
  }

  private scan(): void {
    const now = nowMs()
    for (const [id, t] of this.tasks) {
      if (now - t.lastActivityAt > this.opts.idleMs) void this.kill(id, 'idle')
    }
  }
}
