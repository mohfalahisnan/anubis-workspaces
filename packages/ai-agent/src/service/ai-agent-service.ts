import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { AGENTS, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, MODELS, REASONING_EFFORTS } from '../agents/catalog.js'
import type { Agent, ReasoningEffort } from '../agents/catalog.js'
import { extractUsage, type ExtractedUsage } from '../agents/usage.js'
import { CodexAgent } from '../agents/codex/run.js'
import { CodexPool } from '../agents/codex/pool.js'
import { ClaudeAgent } from '../agents/claude/runner.js'
import { AntigravityAgent } from '../agents/antigravity/runner.js'
import { GptWebAgent } from '../agents/gpt-web/runner.js'
import { QwenWebAgent } from '../agents/qwen-web/runner.js'
import type { AgentEventMap, AgentStream } from '../events/stream.js'
import { detectAgents, type AgentAvailability } from './detect-agents.js'

export interface AiAgentServiceOptions {
  codexCommand?: string
  claudeCommand?: string
  antigravityCommand?: string
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
  claudeCliProfile?: string
  extraEnv?: Record<string, string>
  appendSystemPrompt?: string
  files?: string[]
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
  private antigravity: AntigravityAgent
  private gptWeb: GptWebAgent
  private qwenWeb: QwenWebAgent
  private availability: Record<'claude' | 'codex' | 'antigravity' | 'gpt-web' | 'qwen-web', AgentAvailability>

  constructor(private opts: AiAgentServiceOptions = {}) {
    const env = opts.env ?? process.env
    // Detect first so we can use the resolved absolute path as a spawn fallback.
    // On Windows in particular, a bare `spawn('codex', …)` doesn't follow
    // PATHEXT, so npm-installed shims like `codex.cmd` fail with ENOENT even
    // though `where.exe codex` finds them.
    this.availability = detectAgents()
    const codexCommand =
      opts.codexCommand
      ?? process.env.ANUBIS_CODEX_COMMAND
      ?? this.availability.codex.path
    const claudeCommand =
      opts.claudeCommand
      ?? process.env.ANUBIS_CLAUDE_COMMAND
      ?? this.availability.claude.path
    const antigravityCommand =
      opts.antigravityCommand
      ?? process.env.ANUBIS_ANTIGRAVITY_COMMAND
      ?? this.availability.antigravity.path

    const pool = new CodexPool({
      idleMs: opts.codexIdleMs ?? 10 * 60 * 1000,
      spawn: (key) =>
        CodexAgent.spawnCodex({
          command: codexCommand,
          cwd: process.cwd(),
          env: {
            ...env,
            ...(key.extraEnv ?? {}),
          },
        }),
    })

    this.codex = new CodexAgent(pool)
    this.claude = new ClaudeAgent({
      command: claudeCommand,
      env,
    })
    this.antigravity = new AntigravityAgent({
      command: antigravityCommand,
      env,
    })
    this.gptWeb = new GptWebAgent()
    this.qwenWeb = new QwenWebAgent()
  }

  catalog() {
    return {
      agents: AGENTS,
      models: MODELS,
      defaultModel: DEFAULT_MODEL,
      reasoningEfforts: REASONING_EFFORTS,
      defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
      agentAvailability: this.availability,
    }
  }

  async streamAgent(input: RunAgentInput): Promise<{
    stream: AgentStream
    workspaceId: string
    sessionId: string
    agentSessionId?: string
    /** Terminate this run (kills the CLI child / interrupts the turn). */
    cancel: () => void | Promise<void>
  }> {
    const workspaceId = input.workspaceId ?? 'default'
    const sessionId = input.sessionId ?? randomUUID()
    let agentSessionId: string | undefined

    if (input.agent === 'codex') {
      let appendSystemPrompt = input.appendSystemPrompt
      if (input.files?.length) {
        const fileList = input.files.map(f => basename(f)).join(', ')
        const filesNote = `The user has explicitly attached the following files to this turn: ${fileList}. You can read or edit them in the workspace.`
        appendSystemPrompt = appendSystemPrompt
          ? `${appendSystemPrompt}\n\n${filesNote}`
          : filesNote
      }
      const stream = await this.codex.run({
        workspaceId,
        sessionId,
        codexThreadId: input.prevAgentSessionId,
        cwd: input.cwd,
        prompt: input.prompt,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        appendSystemPrompt,
        sandboxMode: input.yolo ? 'danger-full-access' : input.sandboxMode,
        approvalPolicy: input.yolo ? 'never' : input.approvalPolicy,
        extraEnv: input.extraEnv,
        onSession: (id) => {
          agentSessionId = id
        },
      })

      return {
        workspaceId,
        sessionId,
        agentSessionId,
        stream,
        cancel: () => this.codex.cancel({ workspaceId, sessionId }),
      }
    }

    if (input.agent === 'antigravity') {
      // agy exposes a single `--dangerously-skip-permissions` flag, so both the
      // direct `yolo` toggle and a profile's `bypassPermissions` mode map to it.
      const skipPermissions = input.yolo === true || input.permissionMode === 'bypassPermissions'
      let appendSystemPrompt = input.appendSystemPrompt
      if (input.files?.length) {
        const fileList = input.files.map(f => basename(f)).join(', ')
        const filesNote = `The user has explicitly attached the following files to this turn: ${fileList}. You can read or edit them in the workspace.`
        appendSystemPrompt = appendSystemPrompt
          ? `${appendSystemPrompt}\n\n${filesNote}`
          : filesNote
      }
      const { emitter, cancel } = await this.antigravity.run({
        workspaceId,
        sessionId,
        conversationId: input.prevAgentSessionId,
        cwd: input.cwd,
        prompt: input.prompt,
        model: input.model,
        yolo: skipPermissions,
        appendSystemPrompt,
        extraEnv: input.extraEnv,
      })

      return {
        workspaceId,
        sessionId,
        stream: emitter,
        cancel,
      }
    }

    if (input.agent === 'gpt-web') {
      const { emitter, cancel } = await this.gptWeb.run({
        workspaceId,
        sessionId,
        conversationId: input.prevAgentSessionId,
        cwd: input.cwd,
        prompt: input.prompt,
        model: input.model,
        extraEnv: input.extraEnv,
        appendSystemPrompt: input.appendSystemPrompt,
        files: input.files,
      })

      return {
        workspaceId,
        sessionId,
        stream: emitter,
        cancel,
      }
    }

    if (input.agent === 'qwen-web') {
      const { emitter, cancel } = await this.qwenWeb.run({
        workspaceId,
        sessionId,
        conversationId: input.prevAgentSessionId,
        cwd: input.cwd,
        prompt: input.prompt,
        model: input.model,
        extraEnv: input.extraEnv,
        appendSystemPrompt: input.appendSystemPrompt,
        files: input.files,
      })

      return {
        workspaceId,
        sessionId,
        stream: emitter,
        cancel,
      }
    }

    const mode = input.yolo
      ? 'bypassPermissions'
      : input.permissionMode ?? 'default'
    let appendSystemPrompt = input.appendSystemPrompt
    if (input.files?.length) {
      const fileList = input.files.map(f => basename(f)).join(', ')
      const filesNote = `The user has explicitly attached the following files to this turn: ${fileList}. You can read or edit them in the workspace.`
      appendSystemPrompt = appendSystemPrompt
        ? `${appendSystemPrompt}\n\n${filesNote}`
        : filesNote
    }
    const { emitter, cancel } = await this.claude.run({
      workspaceId,
      sessionId,
      claudeResumeId: input.prevAgentSessionId,
      cwd: input.cwd,
      prompt: input.prompt,
      model: input.model,
      claudeCliProfile: input.claudeCliProfile,
      extraEnv: input.extraEnv,
      permissionMode: mode,
      allowedTools: input.allowedTools,
      disallowedTools: input.disallowedTools,
      appendSystemPrompt,
      files: input.files,
    })

    return {
      workspaceId,
      sessionId,
      stream: emitter,
      cancel,
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
