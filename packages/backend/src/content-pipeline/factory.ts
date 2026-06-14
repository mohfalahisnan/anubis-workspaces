import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAiAgentService } from '@anubis/ai-agent'
import { getDataDir, getStack } from '../services.js'
import { ContentPipelineService, type PipelineDeps } from './pipeline-service.js'
import { makeRealTranscriber, type TranscribeMedia } from './raw-extract.js'

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
    lessons: stack.contentLessons,
    brand: { get: (projectId) => stack.brandContext.get(projectId) },
    kbSearch: async () => [], // Phase 1: KB injection optional/empty; wire knowledge-base.contextPack later.
    runAgent: async ({ prompt, cwd, projectId, step }) => {
      const workDir = join(dataDir, 'content-pipeline', cwd.split('/').pop() ?? 'scratch')
      mkdirSync(workDir, { recursive: true })
      // Authenticate the CLI the same way chat does: point CLAUDE_CONFIG_DIR at a
      // signed-in profile's agent-home. Prefer an explicit override, then the
      // bootstrapped default, then any signed-in Claude profile.
      const profileId = PIPELINE_PROFILE_OVERRIDE
        ?? (stack.profileHomes.for('claude-coding', 'claude').hasCredentials() ? 'claude-coding' : undefined)
        ?? stack.profiles.list().find((p) => p.config.agent === 'claude'
            && stack.profileHomes.for(p.id, 'claude').hasCredentials())?.id
        ?? 'claude-coding'
      const home = stack.profileHomes.for(profileId, 'claude')
      if (!home.hasCredentials()) {
        throw new Error(
          'No signed-in Claude profile found for the content pipeline. Open Profiles, sign in to a '
          + 'Claude profile (e.g. "Claude — Coding"), then retry — or set ANUBIS_PIPELINE_PROFILE_ID '
          + 'to a signed-in Claude profile id.',
        )
      }
      const res = await agentService.runAgent({
        agent: 'claude',
        cwd: workDir,
        prompt,
        model: step === 'ai_review' ? REVIEW_MODEL : undefined,
        permissionMode: 'bypassPermissions',
        workspaceId: projectId,
        extraEnv: home.env(),
      })
      return res.text
    },
    maxAutoIterations: MAX_AUTO_ITERATIONS,
  }

  return new ContentPipelineService(deps)
}

export function getTranscriber(): TranscribeMedia {
  return makeRealTranscriber()
}
