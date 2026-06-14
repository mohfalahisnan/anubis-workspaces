import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { captureInstagramData, silentReporter, type StandardCrawlerOutput } from '@anubis/research-crawler'
import type { CapturedPost, ContentItem, UpdateContentItemPatch } from '@anubis/conversation'
import type { CapturedPostSummary, ContentItemSummary } from '@anubis/shared'
import { getDataDir, getStack } from './services.js'
import { withCrawlerProfileDefaults } from './chrome-defaults.js'
import { jobManager } from './jobs.js'
import { buildRawIdea, getPipelineService, getTranscriber } from './content-pipeline/index.js'
import { getGenerationService } from './content-generation/index.js'

let pipelineProvider = getPipelineService
/** Test seam: override the pipeline service provider with a fake. */
export function __setPipelineProviderForTests(fn: typeof getPipelineService): void { pipelineProvider = fn }

let generationProvider = getGenerationService
/** Test seam: override the generation service provider with a fake. */
export function __setGenerationProviderForTests(fn: typeof getGenerationService): void { generationProvider = fn }

const StatusSchema = z.enum(['idea', 'raw_extracted', 'brief', 'content_refined', 'ai_review', 'human_review', 'generating', 'draft', 'review', 'scheduled', 'published', 'rejected'])

const ListQuery = z.object({
  projectId: z.string().optional(),
  status: StatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict()

const CreateBody = z.object({
  projectId: z.string().min(1).optional(),
  referencePostId: z.string().min(1).optional(),
  referenceUrl: z.string().url().optional(),
  title: z.string().min(1),
  status: StatusSchema.optional(),
  rawBrief: z.string().optional(),
  improvedDraft: z.string().optional(),
  sourceWorkflowRunId: z.string().optional(),
  sourceConversationId: z.string().optional(),
}).strict().refine((body) => Boolean(body.referencePostId) !== Boolean(body.referenceUrl), {
  message: 'Provide exactly one of referencePostId or referenceUrl.',
  path: ['referencePostId'],
})

const UpdateBody = z.object({
  title: z.string().min(1).optional(),
  status: StatusSchema.optional(),
  rawBrief: z.string().optional(),
  improvedDraft: z.string().optional(),
  rejectionReason: z.string().nullable().optional(),
  publishedUrl: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  analytics: z.object({
    likes: z.number().int().nonnegative().nullable().optional(),
    comments: z.number().int().nonnegative().nullable().optional(),
    saves: z.number().int().nonnegative().nullable().optional(),
  }).optional(),
  sourceWorkflowRunId: z.string().nullable().optional(),
  sourceConversationId: z.string().nullable().optional(),
}).strict()

export const contentItemRoutes = new Hono()

const FromCandidateBody = z.object({
  candidateId: z.string().min(1),
  projectId: z.string().min(1).optional(),
}).strict()

const HumanReviewBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
  type: z.string().optional(),
}).strict()

const StepParam = z.enum(['breakdown', 'refine', 'ai-review'])

// Static path — must be registered before the `/:id` routes below.
contentItemRoutes.post('/from-candidate', async (c) => {
  const stack = getStack()
  const body = FromCandidateBody.parse(await c.req.json())
  const candidate = stack.research.getCandidate(body.candidateId)
  if (!candidate) return c.json({ ok: false, error: 'candidate_not_found' }, 404)

  const post = stack.capturedPosts.findById(candidate.postId)
  const projectId = body.projectId ?? candidate.projectId ?? 'default'
  const title = (candidate.caption?.trim() || `Idea from ${candidate.competitorId}`).slice(0, 80)

  const item = stack.contentItems.create({
    id: randomUUID(),
    projectId,
    referencePostId: post ? candidate.postId : undefined,
    referenceUrl: post ? undefined : candidate.postUrl,
    title,
    status: 'idea',
    sourceCandidateId: candidate.id,
    rawBrief: candidate.caption ? `Reference: ${candidate.caption}` : undefined,
    now: Date.now(),
  })
  return c.json({ ok: true, item: toSummary(item) }, 201)
})

contentItemRoutes.get('/', (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', issues: parsed.error.issues } }, 400)
  const items = getStack().contentItems
    .list({ projectId: parsed.data.projectId, status: parsed.data.status, limit: parsed.data.limit ?? 200 })
    .map(toSummary)
  return c.json({ ok: true, items })
})

contentItemRoutes.get('/:id', (c) => {
  const item = getStack().contentItems.findById(c.req.param('id'))
  if (!item) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, item: toSummary(item) })
})

contentItemRoutes.post('/', async (c) => {
  const stack = getStack()
  const body = CreateBody.parse(await c.req.json())
  let projectId = body.projectId ?? 'default'
  if (body.referencePostId) {
    const reference = stack.capturedPosts.findById(body.referencePostId)
    if (!reference) return c.json({ ok: false, error: 'reference_not_found' }, 404)
    projectId = body.projectId ?? reference.projectId ?? 'default'
    if ((reference.projectId ?? 'default') !== projectId) {
      return c.json({ ok: false, error: 'reference_project_mismatch' }, 400)
    }
  }

  const item = stack.contentItems.create({
    id: randomUUID(),
    projectId,
    referencePostId: body.referencePostId,
    referenceUrl: body.referenceUrl,
    title: body.title.trim(),
    status: body.status,
    rawBrief: body.rawBrief,
    improvedDraft: body.improvedDraft,
    sourceWorkflowRunId: body.sourceWorkflowRunId,
    sourceConversationId: body.sourceConversationId,
    now: Date.now(),
  })
  return c.json({ ok: true, item: toSummary(item) }, 201)
})

contentItemRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const patch: UpdateContentItemPatch = {}
  if ('title' in body) patch.title = body.title?.trim()
  if ('status' in body) patch.status = body.status
  if ('rawBrief' in body) patch.rawBrief = body.rawBrief
  if ('improvedDraft' in body) patch.improvedDraft = body.improvedDraft
  if ('rejectionReason' in body) patch.rejectionReason = body.rejectionReason ?? undefined
  if ('publishedUrl' in body) patch.publishedUrl = body.publishedUrl ?? undefined
  if ('publishedAt' in body) patch.publishedAt = body.publishedAt ?? undefined
  if (body.analytics && 'likes' in body.analytics) patch.analyticsLikes = body.analytics.likes ?? undefined
  if (body.analytics && 'comments' in body.analytics) patch.analyticsComments = body.analytics.comments ?? undefined
  if (body.analytics && 'saves' in body.analytics) patch.analyticsSaves = body.analytics.saves ?? undefined
  if ('sourceWorkflowRunId' in body) patch.sourceWorkflowRunId = body.sourceWorkflowRunId ?? undefined
  if ('sourceConversationId' in body) patch.sourceConversationId = body.sourceConversationId ?? undefined
  const item = getStack().contentItems.update(c.req.param('id'), patch)
  if (!item) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, item: toSummary(item) })
})

contentItemRoutes.delete('/:id', (c) => {
  const item = getStack().contentItems.softDelete(c.req.param('id'))
  if (!item) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true })
})

contentItemRoutes.post('/:id/sync-metrics', async (c) => {
  const stack = getStack()
  const item = stack.contentItems.findById(c.req.param('id'))
  if (!item) return c.json({ ok: false, error: 'not_found' }, 404)
  if (!item.publishedUrl) return c.json({ ok: false, error: 'missing_published_url' }, 400)

  let result: StandardCrawlerOutput
  try {
    const cfg = stack.appConfig.get()
    result = await captureInstagramData(withCrawlerProfileDefaults({
      url: item.publishedUrl,
      profile: 'public',
      chromePath: cfg.chromePath,
      maxResponses: 1,
      reporter: silentReporter(),
    }, 'public', cfg, getDataDir()))
  } catch (err) {
    return c.json({
      ok: false,
      error: {
        code: 'SYNC_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    }, 500)
  }

  if (!result.ok) {
    return c.json({
      ok: false,
      error: {
        code: result.error?.code ?? 'SYNC_FAILED',
        message: result.error?.message ?? 'Could not sync metrics.',
      },
    }, 500)
  }

  const post = result.output.posts[0]
  if (!post) return c.json({ ok: false, error: 'no_post_metrics_found' }, 404)
  const next = stack.contentItems.update(item.id, {
    analyticsLikes: post.likes,
    analyticsComments: post.comments,
    metricsSyncedAt: Date.now(),
  })!
  return c.json({ ok: true, item: toSummary(next) })
})

contentItemRoutes.post('/:id/extract', async (c) => {
  const stack = getStack()
  const item = stack.contentItems.findById(c.req.param('id'))
  if (!item) return c.json({ ok: false, error: 'not_found' }, 404)
  const post = item.referencePostId ? stack.capturedPosts.findById(item.referencePostId) ?? undefined : undefined
  const raw = await buildRawIdea({ post, referenceUrl: item.referenceUrl, transcribeMedia: getTranscriber() })
  stack.contentPipeline.patch(item.id, {
    rawIdea: raw,
    transcript: raw.transcript,
    transcriptSource: raw.transcript ? 'extractor' : undefined,
  })
  stack.contentItems.update(item.id, { status: 'raw_extracted' })
  return c.json({ ok: true, pipeline: stack.contentPipeline.get(item.id) })
})

contentItemRoutes.get('/:id/pipeline', (c) => {
  const stack = getStack()
  const id = c.req.param('id')
  if (!stack.contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, pipeline: stack.contentPipeline.get(id), lessons: stack.contentLessons.listByContent(id) })
})

contentItemRoutes.post('/:id/pipeline/run', (c) => {
  const id = c.req.param('id')
  if (!getStack().contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  const job = jobManager.runJob({ kind: 'content-pipeline', label: `Pipeline · ${id}` }, async () => {
    return pipelineProvider().runAuto(id)
  })
  return c.json({ ok: true, jobId: job.id })
})

contentItemRoutes.post('/:id/pipeline/step/:step', async (c) => {
  const id = c.req.param('id')
  const parsed = StepParam.safeParse(c.req.param('step'))
  if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', issues: parsed.error.issues } }, 400)
  const svc = pipelineProvider()
  try {
    if (parsed.data === 'breakdown') return c.json({ ok: true, brief: await svc.runBreakdown(id) })
    if (parsed.data === 'refine') return c.json({ ok: true, refined: await svc.runRefine(id) })
    return c.json({ ok: true, review: await svc.runAiReview(id) })
  } catch (err) {
    return c.json({ ok: false, error: { code: 'AI_STEP_FAILED', message: err instanceof Error ? err.message : 'AI step failed' } }, 502)
  }
})

contentItemRoutes.post('/:id/human-review', async (c) => {
  const body = HumanReviewBody.parse(await c.req.json())
  try {
    const review = await pipelineProvider().submitHumanReview(c.req.param('id'), {
      decision: body.decision,
      reason: body.reason,
      type: body.type as never,
    })
    if (review.decision === 'approved') {
      generationProvider().enqueue(c.req.param('id'))
    }
    return c.json({ ok: true, review })
  } catch (err) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'failed' } }, 400)
  }
})

contentItemRoutes.post('/:id/generation/start', (c) => {
  const stack = getStack()
  const id = c.req.param('id')
  if (!stack.contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  const svc = generationProvider()
  if (stack.contentGenerationTasks.listByContent(id).length === 0) svc.enqueue(id)
  const job = jobManager.runJob({ kind: 'content-generation', label: `Generate · ${id}` }, async () => svc.runAll(id))
  return c.json({ ok: true, jobId: job.id })
})

contentItemRoutes.get('/:id/generation', (c) => {
  const stack = getStack()
  const id = c.req.param('id')
  if (!stack.contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({
    ok: true,
    tasks: stack.contentGenerationTasks.listByContent(id),
    draftOutput: stack.contentPipeline.get(id).draftOutput ?? null,
  })
})

contentItemRoutes.post('/:id/generation/tasks/:taskId/retry', async (c) => {
  const result = await generationProvider().retryTask(c.req.param('id'), c.req.param('taskId'))
  return c.json({ ok: true, result })
})

contentItemRoutes.post('/:id/generation/tasks/:taskId/cancel', (c) => {
  const result = generationProvider().cancelTask(c.req.param('id'), c.req.param('taskId'))
  return c.json({ ok: true, result })
})

function toSummary(item: ContentItem): ContentItemSummary {
  const referencePost = item.referencePostId ? getStack().capturedPosts.findById(item.referencePostId) : null
  return {
    id: item.id,
    projectId: item.projectId,
    referencePostId: item.referencePostId,
    referenceUrl: item.referenceUrl,
    title: item.title,
    status: item.status,
    rawBrief: item.rawBrief,
    improvedDraft: item.improvedDraft,
    rejectionReason: item.rejectionReason,
    publishedUrl: item.publishedUrl,
    publishedAt: item.publishedAt,
    analytics: {
      likes: item.analyticsLikes,
      comments: item.analyticsComments,
      saves: item.analyticsSaves,
      syncedAt: item.metricsSyncedAt,
    },
    sourceWorkflowRunId: item.sourceWorkflowRunId,
    sourceConversationId: item.sourceConversationId,
    sourceCandidateId: item.sourceCandidateId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    referencePost: referencePost ? capturedPostSummary(referencePost) : undefined,
  }
}

function capturedPostSummary(post: CapturedPost): CapturedPostSummary {
  const owner = getStack().competitors.get(post.competitorId)
  return {
    id: post.id,
    competitorId: post.competitorId,
    username: post.username,
    postUrl: post.postUrl,
    caption: post.caption,
    likes: post.likes,
    comments: post.comments,
    postedAt: post.postedAt,
    mediaKind: post.mediaKind,
    mediaUrl: post.mediaUrl,
    carouselCount: post.carouselCount,
    capturedAt: post.capturedAt,
    competitorHandle: owner?.handle,
    competitorTint: owner?.tint,
    competitorFollowers: owner?.followers,
    competitorAvgLikes: owner?.avgLikes,
    competitorLevel: owner?.level,
  }
}
