import { join } from 'node:path'
import { createAiAgentService } from '@anubis/ai-agent'
import type { ConversationStack } from '@anubis/conversation'
import type { AgentKind } from '@anubis/shared'
import { getDataDir, getStack } from '../services.js'
import { runProfileAgent, WEB_AGENTS } from '../agent-run.js'
import { ContentPipelineService, type PipelineDeps } from './pipeline-service.js'
import { buildRawIdea, makeRealTranscriber, makeRealFetchMedia, type TranscribeMedia, type FetchMedia } from './raw-extract.js'
import { pipelineItemAssetsDir, type PostMedia } from './assets.js'

const agentService = createAiAgentService()

const MAX_AUTO_ITERATIONS = 3
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
    // context-pack stubbed: the old CLI-backed contextPack is removed (Task B1).
    // Task C2 will wire up the new in-process engine search here.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contextPack: async (_projectId, _query) => '',
    runAgent: async ({ prompt, cwd, projectId, step, profileId, model: stepModel, reasoningEffort: stepEffort, temperature, files, onProgress }) => {
      const workDir = join(dataDir, 'content-pipeline', cwd.split('/').pop() ?? 'scratch')
      // Resolve the profile (default chain) + its agent, then the step model:
      // per-step override wins, then the profile's own config.model; for the
      // reasoning-heavy ai_review step fall back to a stronger Claude model only
      // when running on Claude.
      const resolvedId = resolveProfileId(stack, profileId)
      const resolved = stack.profiles.resolve(resolvedId)
      const model = stepModel ?? resolved.model ?? (step === 'ai_review' && resolved.agent === 'claude' ? REVIEW_MODEL : undefined)
      const res = await runProfileAgent(stack, agentService, {
        profileId: resolvedId,
        prompt,
        cwd: workDir,
        files,
        model,
        reasoningEffort: stepEffort,
        temperature,
        workspaceId: projectId,
        onProgress,
      })
      return res.text
    },
    extract: async (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) throw new Error(`content item ${id} not found`)
      const post = item.referencePostId ? stack.capturedPosts.findById(item.referencePostId) ?? undefined : undefined
      const destDir = pipelineItemAssetsDir(dataDir, id)
      const raw = await buildRawIdea({
        post: post as never,
        referenceUrl: item.referenceUrl,
        media: (post?.raw as Record<string, unknown> | undefined)?.media as PostMedia | undefined,
        assetPaths: post?.assetPaths,
        destDir,
        fetchMedia: getFetchMedia(),
        transcribeMedia: getTranscriber(),
      })
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

export function getFetchMedia(): FetchMedia {
  return makeRealFetchMedia()
}
