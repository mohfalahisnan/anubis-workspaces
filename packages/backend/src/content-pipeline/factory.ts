import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAiAgentService, type AgentEvent } from '@anubis/ai-agent'
import type { ConversationStack } from '@anubis/conversation'
import type { AgentKind } from '@anubis/shared'
import { getDataDir, getStack } from '../services.js'
import { ContentPipelineService, type PipelineDeps } from './pipeline-service.js'
import { buildRawIdea, makeRealTranscriber, type TranscribeMedia } from './raw-extract.js'

function eventToProgressMessage(event: AgentEvent): string | null {
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

const agentService = createAiAgentService()

const MAX_AUTO_ITERATIONS = 3
/** Token budget for the per-step knowledge-base context pack. */
const CONTEXT_PACK_BUDGET = 2000
/** Opus for the review step (reasoning-heavy); other steps use the agent default. */
const REVIEW_MODEL = 'claude-opus-4-7'
/**
 * Optional explicit Claude profile whose agent-home credentials authenticate
 * the pipeline's CLI calls. When unset we prefer the bootstrapped `claude-coding`
 * default, then any other signed-in Claude profile. The chosen profile's
 * CLAUDE_CONFIG_DIR is injected so the spawned CLI reads its credentials — the
 * same mechanism chat uses. Without it the CLI runs unauthenticated (401).
 */
const PIPELINE_PROFILE_OVERRIDE = process.env.ANUBIS_PIPELINE_PROFILE_ID

/** Web agents drive a browser session and cannot run headless pipeline steps. */
const WEB_AGENTS = new Set<AgentKind>(['gpt-web', 'qwen-web'])

/**
 * Resolve the profile id to use for a pipeline step.
 * Priority: explicit per-step profileId → env override → claude-coding default →
 * first signed-in non-web profile (any agent).
 */
function resolveProfileId(stack: ConversationStack, explicitProfileId?: string): string {
  if (explicitProfileId) return explicitProfileId
  if (PIPELINE_PROFILE_OVERRIDE) return PIPELINE_PROFILE_OVERRIDE
  if (stack.profileHomes.for('claude-coding', 'claude').hasCredentials()) return 'claude-coding'
  const first = stack.profiles.list().find(
    (p) => !WEB_AGENTS.has(p.config.agent) && stack.profileHomes.for(p.id, p.config.agent).hasCredentials(),
  )
  return first?.id ?? 'claude-coding'
}

/** The agent kind a (resolved) step profile runs on — used to tag history + auth. */
function resolveAgentKind(stack: ConversationStack, profileId?: string): AgentKind {
  const id = resolveProfileId(stack, profileId)
  return stack.profiles.get(id)?.config.agent ?? 'claude'
}

export function getPipelineService(): ContentPipelineService {
  const stack = getStack()
  const dataDir = getDataDir()

  const deps: PipelineDeps = {
    getItem: (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) return null
      return {
        id: item.id,
        projectId: item.projectId ?? 'default',
        status: item.status,
        referencePostId: item.referencePostId,
        referenceUrl: item.referenceUrl,
      }
    },
    setStatus: (id, status) => { stack.contentItems.update(id, { status: status as never }) },
    pipeline: stack.contentPipeline,
    history: { append: (input) => { stack.contentPipelineHistory.append(input) } },
    resolveAgent: (profileId) => resolveAgentKind(stack, profileId),
    lessons: stack.contentLessons,
    appConfig: { get: () => stack.appConfig.get() },
    settings: { get: (projectId) => stack.contentPipelineSettings.get(projectId) },
    // Pull brand guideline / niche / similar winning content from the project's
    // knowledge-base index. Best-effort: returns '' when the engine binary isn't
    // configured or the project isn't indexed, so the pipeline still runs.
    contextPack: async (projectId, query) => {
      try {
        const { contextPack } = await import('../knowledge-base.js')
        const res = await contextPack({ projectId, query, budget: CONTEXT_PACK_BUDGET })
        return res.text ?? ''
      } catch {
        return ''
      }
    },
    runAgent: async ({ prompt, cwd, projectId, step, profileId, model: stepModel, reasoningEffort: stepEffort, temperature, onProgress }) => {
      const workDir = join(dataDir, 'content-pipeline', cwd.split('/').pop() ?? 'scratch')
      mkdirSync(workDir, { recursive: true })
      // Resolve the profile + its agent. Each step runs on whatever agent the
      // selected profile uses (Claude / Codex / Antigravity / Qoder).
      const resolvedId = resolveProfileId(stack, profileId)
      const resolved = stack.profiles.resolve(resolvedId)
      const agent = resolved.agent
      if (WEB_AGENTS.has(agent)) {
        throw new Error(
          `Profile "${resolvedId}" uses the web agent "${agent}", which can't run content-pipeline steps. `
          + 'Pick a CLI/SDK profile (Claude, Codex, Antigravity, or Qoder).',
        )
      }
      // Authenticate: inject the profile's agent-home env (CLAUDE_CONFIG_DIR /
      // CODEX_HOME / GEMINI_DIR; Qoder authenticates via its access token below).
      const home = stack.profileHomes.for(resolvedId, agent)
      if (!home.hasCredentials()) {
        throw new Error(
          `Profile "${resolvedId}" (${agent}) has no credentials for the content pipeline. `
          + 'Open Profiles, sign in to the profile, then retry.',
        )
      }
      const cfg = stack.appConfig.get()
      // Model: per-step override wins, then the profile's own config.model; for the
      // reasoning-heavy ai_review step fall back to a stronger Claude model only
      // when running on Claude.
      const model = stepModel ?? resolved.model ?? (step === 'ai_review' && agent === 'claude' ? REVIEW_MODEL : undefined)
      const input = {
        agent,
        cwd: workDir,
        prompt,
        model,
        reasoningEffort: stepEffort ?? resolved.reasoningEffort,
        // Best-effort: most CLI agents ignore temperature, but plumb it through
        // for the (e.g. Qoder) ones that accept sampling parameters.
        temperature,
        // Run autonomously regardless of agent: prefer the profile's own setting,
        // else the most permissive non-interactive default for each knob.
        sandboxMode: resolved.sandboxMode ?? 'workspace-write' as const,
        approvalPolicy: resolved.approvalPolicy ?? 'never' as const,
        permissionMode: resolved.permissionMode ?? 'bypassPermissions' as const,
        allowedTools: resolved.allowedTools,
        disallowedTools: resolved.disallowedTools,
        claudeCliProfile: resolved.claudeCliProfile,
        workspaceId: projectId,
        extraEnv: { ...home.env(), ...(resolved.env ?? {}) },
        qoderApiKey: cfg.qoderApiKey,
      }

      // Fast path: no progress listener needed.
      if (!onProgress) {
        const res = await agentService.runAgent(input)
        return res.text
      }

      // Streaming path: forward agent events as human-readable progress messages.
      const { stream } = await agentService.streamAgent(input)
      let text = ''
      return new Promise<string>((resolve, reject) => {
        stream.on('partial', (data) => {
          text += data.deltaText ?? ''
          const msg = eventToProgressMessage({ type: 'partial', data })
          if (msg) onProgress(msg)
        })
        stream.on('tool_call', (data) => {
          const msg = eventToProgressMessage({ type: 'tool_call', data })
          if (msg) onProgress(msg)
        })
        stream.on('tool_result', (data) => {
          const msg = eventToProgressMessage({ type: 'tool_result', data })
          if (msg) onProgress(msg)
        })
        stream.on('approval_required', (data) => {
          const msg = eventToProgressMessage({ type: 'approval_required', data })
          if (msg) onProgress(msg)
        })
        stream.on('session', (data) => {
          const msg = eventToProgressMessage({ type: 'session', data })
          if (msg) onProgress(msg)
        })
        stream.on('done', () => {
          onProgress('Agent finished.')
          resolve(text)
        })
        stream.on('error', ({ error }) => {
          reject(error)
        })
      })
    },
    extract: async (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) throw new Error(`content item ${id} not found`)
      const post = item.referencePostId ? stack.capturedPosts.findById(item.referencePostId) ?? undefined : undefined
      const transcribeMedia = getTranscriber()
      const raw = await buildRawIdea({ post, referenceUrl: item.referenceUrl, transcribeMedia })
      stack.contentPipeline.patch(id, {
        rawIdea: raw,
        transcript: raw.transcript,
        transcriptSource: raw.transcript ? 'extractor' : undefined,
      })
      stack.contentPipelineHistory.append({
        contentId: id,
        iteration: stack.contentPipeline.get(id).autoIterationCount,
        step: 'extract',
        data: raw,
      })
      stack.contentItems.update(id, { status: 'raw_extracted' })
      return raw
    },
    maxAutoIterations: MAX_AUTO_ITERATIONS,
  }

  return new ContentPipelineService(deps)
}

export function getTranscriber(): TranscribeMedia {
  return makeRealTranscriber()
}
