import { join } from 'node:path'
import { getDataDir, getStack } from '../services.js'
import { GenerationService, type GenerationDeps } from './generation-service.js'
import { FlowImageGenerator, GeneratorRegistry, TextGenerator } from './generators.js'

const MAX_RETRIES = 2

export function getGenerationService(): GenerationService {
  const stack = getStack()

  const registry = new GeneratorRegistry([
    new TextGenerator(),
    new FlowImageGenerator({ getConfig: () => stack.appConfig.get(), getDataDir }),
  ])

  const deps: GenerationDeps = {
    getItem: (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) return null
      return {
        id: item.id, projectId: item.projectId ?? 'default', status: item.status,
        referenceUrl: item.referenceUrl, referencePostId: item.referencePostId, sourceCandidateId: item.sourceCandidateId,
      }
    },
    setStatus: (id, status) => { stack.contentItems.update(id, { status: status as never }) },
    pipeline: stack.contentPipeline,
    taskRepo: stack.contentGenerationTasks,
    lessons: stack.contentLessons,
    registry,
    assetDirFor: (contentId) => join(getDataDir(), 'content-pipeline', contentId, 'assets'),
    maxRetries: MAX_RETRIES,
  }

  return new GenerationService(deps)
}
