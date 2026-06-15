import { mkdirSync } from 'node:fs'
import type { AgentEvent, AiAgentService } from '@anubis/ai-agent'
import type { ConversationStack } from '@anubis/conversation'
import type { AgentKind, ReasoningEffort } from '@anubis/shared'

/** Web agents drive a browser session and cannot run headless agent steps. */
export const WEB_AGENTS = new Set<AgentKind>(['gpt-web', 'qwen-web'])

export function eventToProgressMessage(event: AgentEvent): string | null {
  switch (event.type) {
    case 'partial':
      return 'Agent is thinking…'
    case 'tool_call': {
      const name = (event.data as { toolName?: string }).toolName ?? 'tool'
      return `Using tool: ${name}…`
    }
    case 'tool_result':
      return 'Tool returned a result.'
    case 'approval_required': {
      const name = (event.data as { toolName?: string }).toolName ?? 'tool'
      return `Waiting for approval: ${name}`
    }
    case 'session':
      return 'Agent session started.'
    case 'done':
      return 'Agent finished.'
    default:
      return null
  }
}

export interface RunProfileAgentInput {
  /** A fully-resolved profile id (caller resolves any default chain). */
  profileId: string
  prompt: string
  /** Absolute working dir; the agent runs here. Created if missing. */
  cwd: string
  files?: string[]
  /** Model override; falls back to the profile's own config.model. */
  model?: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  workspaceId?: string
  onProgress?: (message: string) => void
}

/**
 * Resolve a profile to its agent and run a one-shot turn in `cwd`. Shared by the
 * content pipeline and the content-generation agent generators. Rejects web
 * agents and unauthenticated profiles with actionable errors.
 */
export async function runProfileAgent(
  stack: ConversationStack,
  agentService: AiAgentService,
  input: RunProfileAgentInput,
): Promise<{ text: string; agent: AgentKind }> {
  mkdirSync(input.cwd, { recursive: true })
  const resolved = stack.profiles.resolve(input.profileId)
  const agent = resolved.agent
  if (WEB_AGENTS.has(agent)) {
    throw new Error(
      `Profile "${input.profileId}" uses the web agent "${agent}", which can't run headless agent steps. `
      + 'Pick a CLI/SDK profile (Claude, Codex, Antigravity, or Qoder).',
    )
  }
  const home = stack.profileHomes.for(input.profileId, agent)
  if (!home.hasCredentials()) {
    throw new Error(
      `Profile "${input.profileId}" (${agent}) has no credentials. `
      + 'Open Profiles, sign in to the profile, then retry.',
    )
  }
  const cfg = stack.appConfig.get()
  const runInput = {
    agent,
    cwd: input.cwd,
    prompt: input.prompt,
    files: input.files,
    model: input.model ?? resolved.model,
    reasoningEffort: input.reasoningEffort ?? resolved.reasoningEffort,
    temperature: input.temperature,
    sandboxMode: resolved.sandboxMode ?? 'workspace-write' as const,
    approvalPolicy: resolved.approvalPolicy ?? 'never' as const,
    permissionMode: resolved.permissionMode ?? 'bypassPermissions' as const,
    allowedTools: resolved.allowedTools,
    disallowedTools: resolved.disallowedTools,
    claudeCliProfile: resolved.claudeCliProfile,
    workspaceId: input.workspaceId,
    extraEnv: { ...home.env(), ...(resolved.env ?? {}) },
    qoderApiKey: cfg.qoderApiKey,
  }

  if (!input.onProgress) {
    const res = await agentService.runAgent(runInput)
    return { text: res.text, agent }
  }

  const onProgress = input.onProgress
  const { stream } = await agentService.streamAgent(runInput)
  let text = ''
  return new Promise<{ text: string; agent: AgentKind }>((resolve, reject) => {
    stream.on('partial', (data) => {
      text += data.deltaText ?? ''
      const m = eventToProgressMessage({ type: 'partial', data })
      if (m) onProgress(m)
    })
    stream.on('tool_call', (data) => { const m = eventToProgressMessage({ type: 'tool_call', data }); if (m) onProgress(m) })
    stream.on('tool_result', (data) => { const m = eventToProgressMessage({ type: 'tool_result', data }); if (m) onProgress(m) })
    stream.on('approval_required', (data) => { const m = eventToProgressMessage({ type: 'approval_required', data }); if (m) onProgress(m) })
    stream.on('session', (data) => { const m = eventToProgressMessage({ type: 'session', data }); if (m) onProgress(m) })
    stream.on('done', () => { onProgress('Agent finished.'); resolve({ text, agent }) })
    stream.on('error', ({ error }) => reject(error))
  })
}
