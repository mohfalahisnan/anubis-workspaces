import type {
  AgentKind, AiReview, ContentLesson, HumanReview, ImprovedBrief, LessonType, PipelineAgentProgress, PipelineSettings, PipelineStep, PipelineStepProfileConfig, PipelineStepSettings, ReasoningEffort, RawIdea, RefinedContent,
} from '@anubis/shared'
import { runStructured, type StructuredRunner } from './json.js'
import {
  AiReviewSchema, ImprovedBriefSchema, RefinedContentSchema,
  buildBriefPrompt, buildRefinePrompt, buildReviewPrompt,
} from './schemas.js'

export interface PipelineItem {
  id: string
  projectId: string
  status: string
  referencePostId?: string
  referenceUrl?: string
}

export interface PipelineStateView {
  contentId: string
  autoIterationCount: number
  rawIdea?: unknown
  improvedBrief?: ImprovedBrief
  refinedContent?: RefinedContent
  stepProfiles?: PipelineStepProfileConfig
  agentProgress?: PipelineAgentProgress
}

export interface PipelineDeps {
  getItem: (id: string) => PipelineItem | null
  setStatus: (id: string, status: string) => void
  pipeline: {
    get: (id: string) => PipelineStateView
    patch: (id: string, patch: Record<string, unknown>) => unknown
    incrementIteration: (id: string) => number
    resetIteration: (id: string) => void
  }
  /** Append-only snapshot store; preserves every iteration's step output. */
  history: {
    append: (input: { contentId: string; iteration: number; step: PipelineStep; data: unknown; profileId?: string; agent?: AgentKind }) => void
  }
  /** Resolve the agent kind a profile runs on (for tagging history). */
  resolveAgent?: (profileId?: string) => AgentKind | undefined
  lessons: {
    create: (input: Omit<ContentLesson, 'id' | 'createdAt'>) => ContentLesson
    listForInjection: (q: { projectId: string; types?: LessonType[]; limit?: number }) => ContentLesson[]
  }
  runAgent: (input: {
    prompt: string
    cwd: string
    projectId: string
    step: string
    profileId?: string
    /** Per-step overrides (fall back to the profile's values). */
    model?: string
    reasoningEffort?: ReasoningEffort
    temperature?: number
    /** Absolute paths attached to the agent turn (e.g. reference images). */
    files?: string[]
    onProgress?: (message: string) => void
  }) => Promise<string>
  /** Extract raw idea from the item's reference post/URL. Returns the raw idea and patches the pipeline. */
  extract: (id: string) => Promise<RawIdea>
  /** Application config for project-level pipeline settings (e.g., page-level step profiles). */
  appConfig: { get: () => { pipelineStepProfiles?: PipelineStepProfileConfig } }
  /** Per-project prompt + parameter overrides for each pipeline step. */
  settings: { get: (projectId: string) => PipelineSettings }
  maxAutoIterations: number
}

export interface AutoResult {
  finalStatus: string
  stoppedReason: 'human_review' | 'max_iterations'
  iterations: number
}

export interface FullAutoResult extends AutoResult {
  extracted: boolean
}

export class ContentPipelineService {
  constructor(private readonly deps: PipelineDeps) {}

  private runner(
    item: PipelineItem,
    step: string,
    profileId: string | undefined,
    settings: PipelineStepSettings | undefined,
    onProgress?: (message: string) => void,
    files?: string[],
  ): StructuredRunner {
    return (prompt: string) => this.deps.runAgent({
      prompt,
      cwd: `content-pipeline/${item.id}`,
      projectId: item.projectId,
      step,
      profileId,
      model: settings?.model,
      reasoningEffort: settings?.reasoningEffort,
      temperature: settings?.temperature,
      files,
      onProgress,
    })
  }

  /** Per-step prompt + parameter overrides for an item's project. */
  private stepSettings(item: PipelineItem, step: keyof PipelineSettings['steps']): PipelineStepSettings | undefined {
    return this.deps.settings.get(item.projectId).steps[step]
  }

  private reportProgress(id: string, step: string, status: PipelineAgentProgress['status'], message: string, startedAt?: string): void {
    const now = new Date().toISOString()
    const progress: PipelineAgentProgress = {
      step,
      status,
      message,
      startedAt: startedAt ?? now,
      updatedAt: now,
    }
    this.deps.pipeline.patch(id, { agentProgress: progress })
  }

  /** Append a step's output to the append-only history, tagged with the current iteration + agent. */
  private recordHistory(id: string, step: PipelineStep, data: unknown, profileId?: string): void {
    const iteration = this.deps.pipeline.get(id).autoIterationCount
    this.deps.history.append({
      contentId: id,
      iteration,
      step,
      data,
      profileId,
      agent: this.deps.resolveAgent?.(profileId),
    })
  }

  /**
   * Resolve effective step profiles for an item.
   * Per-item profiles are the base; project-level (page-level) profiles override them
   * so the Content Studio page-level setting is consistent across all items.
   */
  private resolveStepProfiles(item: PipelineItem): PipelineStepProfileConfig {
    const perItem = this.deps.pipeline.get(item.id).stepProfiles
    const pageLevel = this.deps.appConfig.get().pipelineStepProfiles
    return { ...perItem, ...pageLevel }
  }

  private async runAiStep<T>(
    id: string,
    step: string,
    profileId: string | undefined,
    run: (onProgress: (message: string) => void) => Promise<T>,
  ): Promise<T> {
    const item = this.requireItem(id)
    const startedAt = new Date().toISOString()
    this.reportProgress(id, step, 'running', `Starting ${step.replace(/_/g, '-')}…`, startedAt)
    try {
      const result = await run((message) => this.reportProgress(id, step, 'running', message, startedAt))
      this.reportProgress(id, step, 'done', `${step.replace(/_/g, '-')} complete.`, startedAt)
      return result
    } catch (err) {
      this.reportProgress(id, step, 'error', err instanceof Error ? err.message : `${step} failed`, startedAt)
      throw err
    }
  }

  /**
   * Extract the raw idea for an item: download the reference media + transcript,
   * patch the pipeline, snapshot history, and advance status to raw_extracted.
   */
  async extract(id: string): Promise<RawIdea> {
    return this.deps.extract(id)
  }

  async runBreakdown(id: string, profileId?: string): Promise<ImprovedBrief> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    const rawIdea = (p.rawIdea ?? { assetRefs: [] }) as RawIdea
    // image / carousel → attach the downloaded images for the agent to view.
    // video → transcript-only (no files); see the {{media}} prompt block.
    const imageFiles = (rawIdea.mediaKind === 'image' || rawIdea.mediaKind === 'carousel')
      ? (rawIdea.localAssets ?? []).filter((a) => a.kind === 'image').map((a) => a.path)
      : []
    const lessons = this.deps.lessons.listForInjection({ projectId: item.projectId, limit: 8 })
    const resolvedId = profileId ?? this.resolveStepProfiles(item).brief
    const settings = this.stepSettings(item, 'brief')
    const brief = await this.runAiStep(id, 'breakdown', resolvedId, (onProgress) => runStructured(this.runner(item, 'brief', resolvedId, settings, onProgress, imageFiles), {
      prompt: buildBriefPrompt({ rawIdea, lessons }, settings?.promptTemplate),
      schema: ImprovedBriefSchema,
      maxAttempts: settings?.maxJsonAttempts,
    }))
    this.deps.pipeline.patch(id, { improvedBrief: brief })
    this.recordHistory(id, 'breakdown', brief, resolvedId)
    this.deps.setStatus(id, 'brief')
    return brief
  }

  async runRefine(id: string, profileId?: string): Promise<RefinedContent> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    const brief = p.improvedBrief
    if (!brief) throw new Error('Cannot refine before a brief exists.')
    const resolvedId = profileId ?? this.resolveStepProfiles(item).refine
    const settings = this.stepSettings(item, 'refine')
    const refined = await this.runAiStep(id, 'refine', resolvedId, (onProgress) => runStructured(this.runner(item, 'refine', resolvedId, settings, onProgress), {
      prompt: buildRefinePrompt({ brief }, settings?.promptTemplate),
      schema: RefinedContentSchema,
      maxAttempts: settings?.maxJsonAttempts,
    }))
    this.deps.pipeline.patch(id, { refinedContent: refined })
    this.recordHistory(id, 'refine', refined, resolvedId)
    this.deps.setStatus(id, 'content_refined')
    return refined
  }

  async runAiReview(id: string, profileId?: string): Promise<AiReview> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    const refined = p.refinedContent
    if (!refined) throw new Error('Cannot review before refined content exists.')
    const resolvedId = profileId ?? this.resolveStepProfiles(item).ai_review
    const settings = this.stepSettings(item, 'ai_review')
    const review = await this.runAiStep(id, 'ai-review', resolvedId, (onProgress) => runStructured(this.runner(item, 'ai_review', resolvedId, settings, onProgress), {
      prompt: buildReviewPrompt({ refined }, settings?.promptTemplate),
      schema: AiReviewSchema,
      maxAttempts: settings?.maxJsonAttempts,
    }))
    this.deps.pipeline.patch(id, { aiReview: review })
    this.recordHistory(id, 'ai_review', review, resolvedId)
    if (review.decision === 'approved') {
      this.deps.setStatus(id, 'human_review')
    } else {
      this.deps.lessons.create({
        projectId: item.projectId, contentId: id, source: 'ai_review',
        type: 'content_quality',
        reason: review.rejectionReason ?? 'AI review rejected the content.',
        whatWentWrong: review.rejectionReason ?? 'Unspecified.',
        howToImprove: review.improvementInstruction ?? 'Improve per the rejection reason.',
      })
      this.deps.setStatus(id, 'brief')
    }
    return review
  }

  async submitHumanReview(id: string, input: { decision: 'approved' | 'rejected'; reason?: string; type?: LessonType }): Promise<HumanReview> {
    const item = this.requireItem(id)
    const review: HumanReview = { decision: input.decision, reason: input.reason, reviewedAt: Date.now() }
    if (input.decision === 'rejected') {
      if (!input.reason?.trim()) throw new Error('A rejection reason is required.')
      this.deps.lessons.create({
        projectId: item.projectId, contentId: id, source: 'human_review',
        type: input.type ?? 'content_quality',
        reason: input.reason, whatWentWrong: input.reason,
        howToImprove: `Human reviewer says: ${input.reason}`,
      })
      this.deps.pipeline.patch(id, { humanReview: review })
      this.recordHistory(id, 'human_review', review)
      this.deps.setStatus(id, 'brief')
    } else {
      this.deps.pipeline.patch(id, { humanReview: review })
      this.recordHistory(id, 'human_review', review)
      // Phase 2: approval advances into generation. The route enqueues tasks.
      this.deps.setStatus(id, 'generating')
    }
    return review
  }

  /** Auto-run: breakdown → refine → ai review, looping on rejection up to maxAutoIterations. */
  async runAuto(id: string): Promise<AutoResult> {
    const item = this.requireItem(id)
    this.deps.pipeline.resetIteration(id)
    const sp = this.resolveStepProfiles(item)
    let iterations = 0
    for (;;) {
      await this.runBreakdown(id, sp?.brief)
      await this.runRefine(id, sp?.refine)
      const review = await this.runAiReview(id, sp?.ai_review)
      iterations++
      if (review.decision === 'approved') {
        return { finalStatus: 'human_review', stoppedReason: 'human_review', iterations }
      }
      this.deps.pipeline.incrementIteration(id)
      if (iterations >= this.deps.maxAutoIterations) {
        return { finalStatus: 'brief', stoppedReason: 'max_iterations', iterations }
      }
    }
  }

  /**
   * Full auto-run: extract (if needed) → breakdown → refine → AI review loop.
   * Handles the complete workflow from raw idea extraction through to human review.
   */
  async runFullAuto(id: string): Promise<FullAutoResult> {
    const item = this.requireItem(id)
    let extracted = false

    // Step 1: Extract raw idea if not yet extracted
    if (item.status === 'idea') {
      const startedAt = new Date().toISOString()
      this.reportProgress(id, 'extract', 'running', 'Extracting raw idea from reference…', startedAt)
      try {
        await this.deps.extract(id)
        this.reportProgress(id, 'extract', 'done', 'Raw idea extracted.', startedAt)
        extracted = true
      } catch (err) {
        this.reportProgress(id, 'extract', 'error', err instanceof Error ? err.message : 'Extraction failed', startedAt)
        throw err
      }
    }

    // Steps 2-4: Breakdown → Refine → AI Review (with loop on rejection)
    const result = await this.runAuto(id)
    return { ...result, extracted }
  }

  private requireItem(id: string): PipelineItem {
    const item = this.deps.getItem(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }
}
