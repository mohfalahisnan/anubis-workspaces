import { join } from 'node:path'
import type { GenerationProfileConfig } from '@anubis/shared'
import { getDataDir, getStack } from '../services.js'
import { GenerationService, type GenerationDeps } from './generation-service.js'
import { FlowImageGenerator, GeneratorRegistry, TextGenerator } from './generators.js'
import { AgentVideoGenerator, ConfigurableImageGenerator, type RunAgent } from './agent-generators.js'
import { runGenerationAgent } from './conversation-runner.js'

const MAX_RETRIES = 2

export function getGenerationService(): GenerationService {
  const stack = getStack()
  const getConfig = () => stack.appConfig.get()
  const runAgent: RunAgent = (input) => runGenerationAgent(stack, input)

  const effectiveProfiles = (projectId: string): GenerationProfileConfig => {
    const project = stack.contentPipelineSettings.get(projectId).generationProfiles
    const global = stack.appConfig.get().generationProfiles
    return { image: project?.image ?? global?.image, video: project?.video ?? global?.video }
  }

  const flow = new FlowImageGenerator({ getConfig, getDataDir })
  const registry = new GeneratorRegistry([
    new TextGenerator(),
    new ConfigurableImageGenerator({ getProfiles: effectiveProfiles, runAgent, flow }),
    new AgentVideoGenerator({ getProfiles: effectiveProfiles, runAgent }),
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
    genDirsFor: (projectId, contentId) => {
      // Run the generation conversation in the project's workdir when it has one,
      // so the agent works inside the real project; otherwise fall back to a
      // per-content scratch workspace under the app data dir. Generated media lands
      // in the standard `outputs/generated-assets/<contentId>` folder either way.
      const workdir = stack.projects.findById(projectId)?.workdir?.trim()
      const workspaceDir = workdir && workdir.length > 0
        ? workdir
        : join(getDataDir(), 'content-pipeline', contentId)
      return { workspaceDir, assetDir: join(workspaceDir, 'outputs', 'generated-assets', contentId) }
    },
    maxRetries: MAX_RETRIES,
    getGenerationProfiles: effectiveProfiles,
  }

  return new GenerationService(deps)
}
