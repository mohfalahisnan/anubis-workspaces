import type {
  ContentLesson, ContentPipeline, DraftOutput, GenerationProfileConfig, GenerationTask, LessonType,
} from '@anubis/shared'
import { deriveTasks, MANUAL_PROFILE_ID } from './derive-tasks.js'
import type { Generator } from './generators.js'
import { stitchDraft } from './stitch.js'

export interface GenItem {
  id: string
  projectId: string
  status: string
  referenceUrl?: string
  referencePostId?: string
  sourceCandidateId?: string
}

export interface GenerationDeps {
  getItem: (id: string) => GenItem | null
  setStatus: (id: string, status: string) => void
  pipeline: {
    get: (id: string) => ContentPipeline
    patch: (id: string, patch: Record<string, unknown>) => unknown
  }
  taskRepo: {
    create: (input: { contentId: string; projectId: string; type: GenerationTask['type']; capability: GenerationTask['capability']; inputPrompt: string; status: GenerationTask['status'] }) => GenerationTask
    get: (id: string) => GenerationTask | null
    listByContent: (contentId: string) => GenerationTask[]
    update: (id: string, patch: Partial<GenerationTask>) => GenerationTask | null
    deleteByContent: (contentId: string) => void
  }
  lessons: { create: (input: Omit<ContentLesson, 'id' | 'createdAt'>) => ContentLesson }
  registry: { get: (capability: GenerationTask['capability']) => Generator | undefined }
  /** Resolve the conversation workspace (project workdir) + asset output dir for a task. */
  genDirsFor: (projectId: string, contentId: string) => { workspaceDir: string; assetDir: string }
  /** Read app config to resolve the project's generation profiles (manual / flow / agent). */
  getConfig: () => { generationProfiles?: GenerationProfileConfig }
  maxRetries: number
}

export interface GenerationResult {
  status: 'draft' | 'generating'
  completed: number
  failed: number
  manual: number
}

export class GenerationService {
  constructor(private readonly deps: GenerationDeps) {}

  enqueue(id: string): GenerationTask[] {
    const item = this.requireItem(id)
    const pipeline = this.deps.pipeline.get(id)
    if (!pipeline.refinedContent) throw new Error('Cannot generate before refined content exists.')
    const mediaKind = pipeline.rawIdea?.mediaKind
    const gp = this.deps.getConfig().generationProfiles
    const manual = { image: gp?.image === MANUAL_PROFILE_ID, video: gp?.video === MANUAL_PROFILE_ID }
    const specs = deriveTasks(pipeline.refinedContent, mediaKind, manual)
    this.deps.taskRepo.deleteByContent(id)
    return specs.map((s) => this.deps.taskRepo.create({ contentId: id, projectId: item.projectId, ...s }))
  }

  async runAll(id: string): Promise<GenerationResult> {
    this.requireItem(id)
    const pending = this.deps.taskRepo.listByContent(id).filter((t) => t.status === 'pending')
    for (const task of pending) await this.runTask(id, task)
    return this.finalize(id)
  }

  async retryTask(id: string, taskId: string): Promise<GenerationResult> {
    const task = this.deps.taskRepo.get(taskId)
    if (task && (task.status === 'failed' || task.status === 'cancelled')) {
      const reset = this.deps.taskRepo.update(taskId, { status: 'pending', error: undefined })!
      await this.runTask(id, reset)
    }
    return this.finalize(id)
  }

  cancelTask(id: string, taskId: string): GenerationResult {
    const task = this.deps.taskRepo.get(taskId)
    if (task && (task.status === 'pending' || task.status === 'running')) {
      this.deps.taskRepo.update(taskId, { status: 'cancelled' })
    }
    return this.finalize(id)
  }

  private async runTask(id: string, task: GenerationTask): Promise<void> {
    const generator = this.deps.registry.get(task.capability)
    if (!generator) {
      this.deps.taskRepo.update(task.id, { status: 'manual' })
      return
    }
    const { workspaceDir, assetDir } = this.deps.genDirsFor(task.projectId, id)
    const ctx = {
      contentId: id,
      projectId: task.projectId,
      workspaceDir,
      assetDir,
      conversationId: task.conversationId,
      onConversation: (cid: string) => { this.deps.taskRepo.update(task.id, { conversationId: cid }) },
    }
    let lastError = ''
    for (let attempt = 0; attempt <= this.deps.maxRetries; attempt++) {
      this.deps.taskRepo.update(task.id, { status: 'running', generator: generator.name, retryCount: attempt })
      try {
        const output = await generator.generate({ ...task, generator: generator.name }, ctx)
        this.deps.taskRepo.update(task.id, { status: 'completed', output, error: undefined })
        return
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    this.deps.taskRepo.update(task.id, { status: 'failed', error: lastError })
    this.deps.lessons.create({
      projectId: this.requireItem(id).projectId, contentId: id, source: 'generation_failure',
      type: 'technical_generation_error' as LessonType,
      reason: `Generation failed for ${task.type}: ${lastError}`,
      whatWentWrong: lastError,
      howToImprove: `Retry ${task.type} or adjust the prompt/provider.`,
    })
  }

  private finalize(id: string): GenerationResult {
    const tasks = this.deps.taskRepo.listByContent(id)
    const auto = tasks.filter((t) => t.status !== 'manual')
    const completed = auto.filter((t) => t.status === 'completed').length
    const failed = auto.filter((t) => t.status === 'failed').length
    const manual = tasks.filter((t) => t.status === 'manual').length
    const settled = auto.every((t) => t.status === 'completed' || t.status === 'cancelled')

    if (auto.length > 0 && settled) {
      const item = this.requireItem(id)
      const pipeline = this.deps.pipeline.get(id)
      const draft: DraftOutput = stitchDraft({
        pipeline, tasks,
        sourceRef: { candidateId: item.sourceCandidateId, referenceUrl: item.referenceUrl, referencePostId: item.referencePostId },
        lessonsUsed: pipeline.improvedBrief?.referenceLessons ?? [],
        now: Date.now(),
      })
      this.deps.pipeline.patch(id, { draftOutput: draft })
      this.deps.setStatus(id, 'draft')
      return { status: 'draft', completed, failed, manual }
    }
    return { status: 'generating', completed, failed, manual }
  }

  private requireItem(id: string): GenItem {
    const item = this.deps.getItem(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }
}
