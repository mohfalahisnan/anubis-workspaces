import type {
  AiReview, BrandContext, ContentLesson, HumanReview, ImprovedBrief, LessonType, RefinedContent,
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
  lessons: {
    create: (input: Omit<ContentLesson, 'id' | 'createdAt'>) => ContentLesson
    listForInjection: (q: { projectId: string; types?: LessonType[]; limit?: number }) => ContentLesson[]
  }
  brand: { get: (projectId: string) => BrandContext | undefined }
  kbSearch: (projectId: string, query: string) => Promise<string[]>
  runAgent: (input: { prompt: string; cwd: string; projectId: string; step: string }) => Promise<string>
  maxAutoIterations: number
}

export interface AutoResult {
  finalStatus: string
  stoppedReason: 'human_review' | 'max_iterations'
  iterations: number
}

export class ContentPipelineService {
  constructor(private readonly deps: PipelineDeps) {}

  private runner(item: PipelineItem, step: string): StructuredRunner {
    return (prompt: string) => this.deps.runAgent({ prompt, cwd: `content-pipeline/${item.id}`, projectId: item.projectId, step })
  }

  async runBreakdown(id: string): Promise<ImprovedBrief> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    const rawIdea = (p.rawIdea ?? { assetRefs: [] }) as never
    const brand = this.deps.brand.get(item.projectId)
    const lessons = this.deps.lessons.listForInjection({ projectId: item.projectId, limit: 8 })
    const kbHits = await this.deps.kbSearch(item.projectId, brand?.nichePositioning ?? '')
    const brief = await runStructured(this.runner(item, 'brief'), {
      prompt: buildBriefPrompt({ rawIdea, brand, lessons, kbHits }),
      schema: ImprovedBriefSchema,
    })
    this.deps.pipeline.patch(id, { improvedBrief: brief })
    this.deps.setStatus(id, 'brief')
    return brief
  }

  async runRefine(id: string): Promise<RefinedContent> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    if (!p.improvedBrief) throw new Error('Cannot refine before a brief exists.')
    const brand = this.deps.brand.get(item.projectId)
    const refined = await runStructured(this.runner(item, 'refine'), {
      prompt: buildRefinePrompt({ brief: p.improvedBrief, brand }),
      schema: RefinedContentSchema,
    })
    this.deps.pipeline.patch(id, { refinedContent: refined })
    this.deps.setStatus(id, 'content_refined')
    return refined
  }

  async runAiReview(id: string): Promise<AiReview> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    if (!p.refinedContent) throw new Error('Cannot review before refined content exists.')
    const brand = this.deps.brand.get(item.projectId)
    const review = await runStructured(this.runner(item, 'ai_review'), {
      prompt: buildReviewPrompt({ refined: p.refinedContent, brand, niche: brand?.nichePositioning }),
      schema: AiReviewSchema,
    })
    this.deps.pipeline.patch(id, { aiReview: review })
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
      this.deps.setStatus(id, 'brief')
    } else {
      this.deps.pipeline.patch(id, { humanReview: review })
      // Phase 2 will set 'generating'. Phase 1 leaves status at human_review (approved/ready).
      this.deps.setStatus(id, 'human_review')
    }
    return review
  }

  /** Auto-run: breakdown → refine → ai review, looping on rejection up to maxAutoIterations. */
  async runAuto(id: string): Promise<AutoResult> {
    this.requireItem(id)
    this.deps.pipeline.resetIteration(id)
    let iterations = 0
    for (;;) {
      await this.runBreakdown(id)
      await this.runRefine(id)
      const review = await this.runAiReview(id)
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

  private requireItem(id: string): PipelineItem {
    const item = this.deps.getItem(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }
}
