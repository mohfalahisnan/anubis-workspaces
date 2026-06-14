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
      const res = await agentService.runAgent({
        agent: 'claude',
        cwd: workDir,
        prompt,
        model: step === 'ai_review' ? REVIEW_MODEL : undefined,
        permissionMode: 'bypassPermissions',
        workspaceId: projectId,
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
