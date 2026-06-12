import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  calculateAvgLikesSummary,
  captureInstagramData,
  launchChrome,
  killChrome,
  silentReporter,
  type PostData,
  type ProfileData,
  type StandardCrawlerOutput,
} from '@anubis/research-crawler'
import type { CapturedPost } from '@anubis/conversation'
import type { BatchCaptureJobResult, CaptureJobResult, CapturedPostSummary } from '@anubis/shared'
import { getDataDir, getStack } from './services.js'
import { withCrawlerProfileDefaults, crawlerProfileSchema } from './chrome-defaults.js'
import { HttpError } from './http-errors.js'
import { jobManager, type ProgressReporter } from './jobs.js'
import { runBatchCapture } from './capture-batch.js'
import { appendBatchCandidates, getBatchCandidates } from './capture-candidates.js'

type PostOwner = {
  handle?: string
  tint?: string
  followers?: number
  avgLikes?: number
  level?: 'black' | 'green' | 'yellow' | 'red'
}

/* -----------------------------------------------------------
   Capture orchestration
   -----------------------------------------------------------
   POST /captures/competitors/:id
     - profile=login  → CDP crawler using the user's logged-in
                        Chrome profile.
     - profile=public → existing CDP scraper (anonymous mode).
     - profile=flow   → existing CDP scraper.

   GET /posts                 — flat feed of captured posts joined
                                with the owning competitor.
   ----------------------------------------------------------- */

const CaptureBody = z.object({
  profile: crawlerProfileSchema.optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  maxResponses: z.number().int().positive().max(120).optional(),
  targetPosts: z.number().int().positive().max(120).optional(),
  preview: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(180_000).optional(),
  /** When true, run as a background job and return { jobId } immediately. */
  async: z.boolean().optional(),
}).strict()

type CaptureOptions = z.infer<typeof CaptureBody>

/**
 * Internal capture options: CaptureOptions plus batch-only flags.
 * - `keepChromeOpen`: the batch owns Chrome's lifetime, so each capture must not kill it.
 * - `openNewTab`: parallel captures each need their OWN tab. Without this they take the
 *   reuse path and collide on one shared tab, so only the race winner gets data.
 */
type InternalCaptureOptions = CaptureOptions & { keepChromeOpen?: boolean; openNewTab?: boolean }

/**
 * Batch capture body. "Select all" stays unbounded from the user's side — the
 * 8-per-chunk pacing is an internal execution detail, not a selection cap — so
 * the only ceiling here is a generous guard against absurd payloads.
 */
const BatchCaptureBody = z.object({
  competitorIds: z.array(z.string().min(1)).min(1).max(500),
  profile: crawlerProfileSchema.optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  maxResponses: z.number().int().positive().max(120).optional(),
  targetPosts: z.number().int().positive().max(120).optional(),
  timeoutMs: z.number().int().positive().max(180_000).optional(),
}).strict()

interface PersistedCapture {
  competitor: NonNullable<ReturnType<ReturnType<typeof getStack>['competitors']['get']>>
  capturedCount: number
  warnings: string[]
}

export const captureRoutes = new Hono()

/**
 * POST /captures/competitors/batch — capture a selection of competitors in
 * human-paced chunks (see capture-batch.ts) inside one background job. Returns
 * the job id immediately; progress + stop control flow through the job manager.
 *
 * NOTE: this static route MUST be registered before the dynamic
 * `/competitors/:id` route below. Hono resolves overlapping routes by
 * registration order, so declaring `:id` first makes it swallow
 * `/competitors/batch` (matching id="batch") and 404 every batch request.
 */
captureRoutes.post('/competitors/batch', async (c) => {
  const stack = getStack()
  const body = BatchCaptureBody.parse(await c.req.json().catch(() => ({})))

  // Resolve + de-duplicate ids, preserving selection order. Unknown ids are
  // dropped silently (the selection may have gone stale); if nothing resolves
  // we 404 rather than spinning up an empty job.
  const seen = new Set<string>()
  const targets = body.competitorIds.flatMap((id) => {
    if (seen.has(id)) return []
    seen.add(id)
    const competitor = stack.competitors.get(id)
    return competitor ? [{ id: competitor.id, handle: competitor.handle }] : []
  })
  if (targets.length === 0) return c.json({ ok: false, error: 'not_found' }, 404)

  const projectId = stack.competitors.get(targets[0]!.id)?.projectId
  const captureOpts: CaptureOptions = {
    profile: body.profile,
    headless: body.headless,
    forceHeadless: body.forceHeadless,
    maxResponses: body.maxResponses,
    targetPosts: body.targetPosts,
    timeoutMs: body.timeoutMs,
  }

  // The executor runs on the next microtask, after `jobId` is assigned below,
  // so candidates can be streamed into the per-job store keyed by this id.
  let jobId = ''
  const job = jobManager.runJob<BatchCaptureJobResult>(
    {
      kind: 'capture-posts-batch',
      label: `Capture · ${targets.length} competitor${targets.length === 1 ? '' : 's'}`,
      projectId,
    },
    async (ctx) => {
      const cfg = getStack().appConfig.get()
      const selectedProfile = captureOpts.profile ?? 'public'
      // Bring Chrome up once for the whole run so the parallel captures reuse
      // a single instance instead of racing to spawn/kill it.
      const launched = await launchChrome(withCrawlerProfileDefaults({
        profile: selectedProfile,
        chromePath: cfg.chromePath,
        headless: captureOpts.headless,
        forceHeadless: captureOpts.forceHeadless,
      }, selectedProfile, cfg, getDataDir()))
      try {
        return await runBatchCapture({
          competitors: targets,
          signal: ctx.signal,
          // Per-profile crawler progress is silenced so the batch orchestrator
          // owns the job's progress (chunk/profile counters, not scroll counts).
          captureOne: async (target) => {
            const { candidates, warnings } = await captureAndRefreshStats(
              target.id,
              { ...captureOpts, keepChromeOpen: true, openNewTab: true },
              silentReporter(),
            )
            // Stream the actual posts into the per-job store; report only the
            // count up to the orchestrator (the result payload carries counts).
            appendBatchCandidates(jobId, candidates)
            return { candidateCount: candidates.length, warnings }
          },
          reportProgress: ctx.setProgress,
          reportWarning: ctx.warn,
        })
      } finally {
        // Only tear down Chrome if this run spawned it; leave a pre-existing one.
        if (!launched.reused) {
          await killChrome(launched.remoteDebuggingPort).catch(() => {})
        }
      }
    },
  )
  jobId = job.id

  return c.json({ ok: true, jobId: job.id })
})

/**
 * GET /captures/competitors/batch/:jobId/candidates — the captured posts a
 * batch run has surfaced so far (streamed per-profile, served from the live
 * store). The store lives as long as the job record, so a finished-but-not-
 * dismissed job still serves its full set here.
 */
captureRoutes.get('/competitors/batch/:jobId/candidates', (c) => {
  const jobId = c.req.param('jobId')
  const job = jobManager.get(jobId)
  if (!job) return c.json({ ok: false, error: 'not_found' }, 404)
  const running = job.state === 'queued' || job.state === 'running' || job.state === 'stopping'
  return c.json({ ok: true, candidates: getBatchCandidates(jobId), running })
})

captureRoutes.post('/competitors/:id', async (c) => {
  const stack = getStack()
  const competitor = stack.competitors.get(c.req.param('id'))
  if (!competitor) return c.json({ ok: false, error: 'not_found' }, 404)

  const body = CaptureBody.parse(await c.req.json().catch(() => ({})))

  // Background mode: enqueue a job and return its id immediately. Preview
  // captures are always synchronous (the caller blocks on the candidate list).
  if (body.async && !body.preview) {
    const job = jobManager.runJob<CaptureJobResult>(
      {
        kind: 'capture-posts',
        label: `Capture · ${competitor.handle}`,
        projectId: competitor.projectId,
      },
      async (ctx) => {
        const persisted = await runCapture(competitor.id, body, ctx.reporter)
        for (const warning of persisted.warnings) ctx.warn(warning)
        return { competitor: persisted.competitor, capturedCount: persisted.capturedCount }
      },
    )
    return c.json({ ok: true, jobId: job.id })
  }

  const stackForOwner = getStack()
  const usernameNoAt = competitor.handle.replace(/^@/, '')
  const selectedProfile = body.profile ?? 'public'
  const cfg = stackForOwner.appConfig.get()
  const targetPosts = body.targetPosts ?? body.maxResponses ?? 30

  let result: StandardCrawlerOutput
  try {
    result = await captureInstagramData(withCrawlerProfileDefaults({
      username: usernameNoAt,
      profile: selectedProfile,
      chromePath: cfg.chromePath,
      headless: body.headless,
      forceHeadless: body.forceHeadless,
      maxResponses: targetPosts,
      timeoutMs: body.timeoutMs ?? 90_000,
      reporter: silentReporter(),
    }, selectedProfile, cfg, getDataDir()))
  } catch (e) {
    throw new HttpError(500, {
      ok: false,
      error: {
        code: 'CAPTURE_FAILED',
        message: e instanceof Error ? e.message : 'Capture threw.',
      },
    })
  }

  if (!result.ok) {
    throw new HttpError(500, {
      ok: false,
      error: {
        code: result.error?.code ?? 'CAPTURE_FAILED',
        message: result.error?.message ?? 'Capture failed.',
        warnings: result.meta.warnings,
      },
    })
  }

  // Preview: refresh the competitor's profile stats (bio/followers/avgLikes)
  // and return the captured posts as candidates WITHOUT persisting them.
  if (body.preview) {
    const refreshed = refreshCompetitorStats(competitor.id, result, targetPosts)
    return c.json({
      ok: true,
      competitor: refreshed.competitor,
      posts: refreshed.candidates,
      candidateCount: refreshed.candidates.length,
      warnings: refreshed.warnings,
    })
  }

  const persisted = persistCaptureResult(competitor.id, result, targetPosts)
  return c.json({
    ok: true,
    competitor: persisted.competitor,
    capturedCount: persisted.capturedCount,
    warnings: persisted.warnings,
  })
})

/**
 * Run a (non-preview) capture for a competitor and persist its posts.
 * Shared by the synchronous route and the background job executor; throws
 * on crawler failure so the job manager records the error.
 */
/**
 * Run the crawler for one competitor and return the validated output.
 * Shared by the (legacy) persisting path and the stats-only refresh path.
 * Throws on a crawler-level failure so callers/jobs record the error.
 */
async function crawlCompetitorPosts(
  competitorId: string,
  body: InternalCaptureOptions,
  reporter: ProgressReporter,
): Promise<{ result: StandardCrawlerOutput; targetPosts: number }> {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) throw new Error('Competitor not found.')

  const usernameNoAt = competitor.handle.replace(/^@/, '')
  const selectedProfile = body.profile ?? 'public'
  const cfg = stack.appConfig.get()
  const targetPosts = body.targetPosts ?? body.maxResponses ?? 30

  const result = await captureInstagramData(withCrawlerProfileDefaults({
    username: usernameNoAt,
    profile: selectedProfile,
    chromePath: cfg.chromePath,
    headless: body.headless,
    forceHeadless: body.forceHeadless,
    maxResponses: targetPosts,
    timeoutMs: body.timeoutMs ?? 90_000,
    ...(body.keepChromeOpen ? { keepChromeOpen: true } : {}),
    ...(body.openNewTab ? { openNewTab: true } : {}),
    reporter,
  }, selectedProfile, cfg, getDataDir()))

  if (!result.ok) throw new Error(result.error?.message ?? 'Capture failed.')
  return { result, targetPosts }
}

async function runCapture(
  competitorId: string,
  body: CaptureOptions,
  reporter: ProgressReporter,
): Promise<PersistedCapture> {
  const { result, targetPosts } = await crawlCompetitorPosts(competitorId, body, reporter)
  return persistCaptureResult(competitorId, result, targetPosts)
}

/**
 * Capture one competitor, refresh its profile stats (bio/displayName/followers/
 * avgLikes) WITHOUT persisting posts, and return the candidate posts for the
 * caller to surface for selection.
 */
async function captureAndRefreshStats(
  competitorId: string,
  body: InternalCaptureOptions,
  reporter: ProgressReporter,
): Promise<{ candidates: CapturedPostSummary[]; warnings: string[] }> {
  const { result, targetPosts } = await crawlCompetitorPosts(competitorId, body, reporter)
  const refreshed = refreshCompetitorStats(competitorId, result, targetPosts)
  return { candidates: refreshed.candidates, warnings: refreshed.warnings }
}

/** Persist captured posts + refresh competitor stats; returns the saved view. */
function persistCaptureResult(
  competitorId: string,
  result: StandardCrawlerOutput,
  targetPosts: number,
): PersistedCapture {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) throw new Error('Competitor not found.')
  const usernameNoAt = competitor.handle.replace(/^@/, '')

  const now = Date.now()
  const posts: CapturedPost[] = uniqueCapturedPosts(result.output.posts
    .filter((p) => Boolean(p.postUrl))
    .slice(0, targetPosts)
    .map((p) => postDataToCapturedPost(competitor.id, usernameNoAt, p, now, competitor.projectId)))

  const profileEntry =
    result.output.profiles.find((p) => p.username === usernameNoAt) ??
    result.output.profiles[0]
  const avgLikesEntry =
    result.meta.avgLikes?.perProfile.find((entry) => entry.username === usernameNoAt) ??
    result.meta.avgLikes?.perProfile[0]
  const avgLikesSummary =
    avgLikesEntry ?? calculateAvgLikesSummary(usernameNoAt, posts.map(capturedPostToPostData))

  stack.capturedPosts.upsertMany(posts)
  const totalPostsInDb = stack.capturedPosts.countForCompetitor(competitor.id)
  stack.competitors.update(competitor.id, {
    displayName: deriveDisplayName(competitor.displayName, profileEntry),
    bio: deriveBio(competitor.bio, profileEntry),
    followers: profileEntry?.followers,
    avgLikes: avgLikesSummary?.avgLikes ?? profileEntry?.avgLikes,
    postCount: totalPostsInDb,
  })
  stack.competitors.markRefreshedAt(competitor.id, now)

  return {
    competitor: stack.competitors.get(competitor.id)!,
    capturedCount: posts.length,
    warnings: result.meta.warnings,
  }
}

interface StatsRefresh {
  competitor: NonNullable<ReturnType<ReturnType<typeof getStack>['competitors']['get']>>
  candidates: CapturedPostSummary[]
  warnings: string[]
}

/**
 * Refresh a competitor's profile stats from a crawl result and return the
 * captured posts as candidates — WITHOUT persisting any post. Capture now owns
 * `avgLikes` (computed from the full crawl); `postCount` is left untouched and
 * only changes when the user saves selected posts via `/posts/import`.
 */
function refreshCompetitorStats(
  competitorId: string,
  result: StandardCrawlerOutput,
  targetPosts: number,
): StatsRefresh {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) throw new Error('Competitor not found.')
  const usernameNoAt = competitor.handle.replace(/^@/, '')

  const now = Date.now()
  const posts: CapturedPost[] = uniqueCapturedPosts(result.output.posts
    .filter((p) => Boolean(p.postUrl))
    .slice(0, targetPosts)
    .map((p) => postDataToCapturedPost(competitor.id, usernameNoAt, p, now, competitor.projectId)))

  const profileEntry =
    result.output.profiles.find((p) => p.username === usernameNoAt) ??
    result.output.profiles[0]
  const avgLikesEntry =
    result.meta.avgLikes?.perProfile.find((entry) => entry.username === usernameNoAt) ??
    result.meta.avgLikes?.perProfile[0]
  const avgLikesSummary =
    avgLikesEntry ?? calculateAvgLikesSummary(usernameNoAt, posts.map(capturedPostToPostData))

  stack.competitors.update(competitor.id, {
    displayName: deriveDisplayName(competitor.displayName, profileEntry),
    bio: deriveBio(competitor.bio, profileEntry),
    followers: profileEntry?.followers,
    avgLikes: avgLikesSummary?.avgLikes ?? profileEntry?.avgLikes,
  })
  stack.competitors.markRefreshedAt(competitor.id, now)

  const owner = stack.competitors.get(competitor.id)!
  // Strip `raw` (the full scraped blob) from candidates — the import mapper
  // never sends it and it would bloat the streamed/aggregated payload.
  const candidates: CapturedPostSummary[] = posts.map((post) => {
    const { raw: _raw, ...rest } = post
    return enrichPostForOwner(rest, owner) as CapturedPostSummary
  })

  return { competitor: owner, candidates, warnings: result.meta.warnings }
}

/** GET /posts — flat captured-post feed for the Content page. */
const ListQuery = z.object({
  competitorId: z.string().optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  orderBy: z.enum(['recent', 'engagement']).optional(),
}).strict()

const UpdatePostBody = z.object({
  caption: z.string().optional(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  postedAt: z.string().optional(),
  mediaKind: z.enum(['image', 'video', 'carousel']).optional(),
  mediaUrl: z.string().optional(),
  carouselCount: z.number().int().nonnegative().optional(),
}).strict()

const ImportPostsBody = z.object({
  posts: z.array(z.object({
    id: z.string().min(1).optional(),
    competitorId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    username: z.string().min(1),
    postUrl: z.string().min(1),
    caption: z.string().optional(),
    likes: z.number().int().nonnegative().optional(),
    comments: z.number().int().nonnegative().optional(),
    postedAt: z.string().optional(),
    mediaKind: z.enum(['image', 'video', 'carousel']).optional(),
    mediaUrl: z.string().optional(),
    carouselCount: z.number().int().nonnegative().optional(),
    capturedAt: z.number().int().positive().optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  })).max(500),
}).strict()

export const postRoutes = new Hono()

postRoutes.get('/', (c) => {
  const stack = getStack()
  const parsed = ListQuery.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  )
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: 'BAD_REQUEST', issues: parsed.error.issues } },
      400,
    )
  }
  const opts = parsed.data
  const rows = stack.capturedPosts.list({
    competitorId: opts.competitorId,
    projectId: opts.projectId,
    limit: opts.limit ?? 60,
    orderBy: opts.orderBy ?? 'recent',
  })

  const competitorsById = new Map(stack.competitors.list(opts.projectId).map((c) => [c.id, c]))
  const items = rows.map((row) => {
    // The frontend never reads the full scraped Instagram blob (`raw`); the
    // fields it does need (`assetPaths`, `failedAssets`) are already derived
    // top-level by the repo. Drop `raw` so we don't serialise/transfer/parse
    // megabytes of unused data on every list. See captured-posts-repo `toPost`.
    const { raw: _raw, ...rest } = row
    const owner = competitorsById.get(row.competitorId)
    return {
      ...rest,
      competitorHandle: owner?.handle,
      competitorTint: owner?.tint,
      competitorFollowers: owner?.followers,
      competitorAvgLikes: owner?.avgLikes,
      competitorLevel: owner?.level,
    }
  })
  return c.json({ ok: true, items })
})

postRoutes.post('/import', async (c) => {
  const stack = getStack()
  const body = ImportPostsBody.parse(await c.req.json())
  const now = Date.now()
  const posts: CapturedPost[] = uniqueCapturedPosts(body.posts.map((post) => {
    const owner = stack.competitors.get(post.competitorId)
    if (!owner) throw new Error(`Competitor not found: ${post.competitorId}`)
    return {
      id: post.id ?? randomUUID(),
      competitorId: post.competitorId,
      projectId: post.projectId ?? owner.projectId,
      username: post.username,
      postUrl: post.postUrl,
      caption: post.caption,
      likes: post.likes,
      comments: post.comments,
      postedAt: post.postedAt,
      mediaKind: post.mediaKind,
      mediaUrl: post.mediaUrl,
      carouselCount: post.carouselCount,
      capturedAt: post.capturedAt ?? now,
      raw: post.raw,
    }
  }))

  const result = stack.capturedPosts.upsertMany(posts)
  for (const competitorId of new Set(posts.map((post) => post.competitorId))) {
    refreshCompetitorPostStats(competitorId)
  }

  return c.json({ ok: true, importedCount: result.inserted })
})

postRoutes.patch('/:id', async (c) => {
  const stack = getStack()
  const body = UpdatePostBody.parse(await c.req.json())
  const post = stack.capturedPosts.update(c.req.param('id'), body)
  if (!post) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, post: enrichPost(post) })
})

postRoutes.delete('/:id', (c) => {
  const stack = getStack()
  const post = stack.capturedPosts.delete(c.req.param('id'))
  if (!post) return c.json({ ok: false, error: 'not_found' }, 404)
  const count = stack.capturedPosts.countForCompetitor(post.competitorId)
  stack.competitors.update(post.competitorId, { postCount: count })
  return c.json({ ok: true })
})

/* ---------- helpers ---------- */

function postDataToCapturedPost(
  competitorId: string,
  username: string,
  p: PostData,
  capturedAt: number,
  projectId?: string,
): CapturedPost {
  const kind = p.media?.kind
  const urls = p.media?.urls ?? []
  return {
    id: randomUUID(),
    competitorId,
    projectId,
    username: p.username ?? username,
    postUrl: p.postUrl,
    caption: p.caption,
    likes: p.likes,
    comments: p.comments,
    postedAt: p.timestamp,
    mediaKind: kind,
    mediaUrl: urls[0],
    carouselCount: kind === 'carousel' ? urls.length : undefined,
    capturedAt,
    raw: p as unknown as Record<string, unknown>,
  }
}

function capturedPostToPostData(post: CapturedPost): PostData {
  return {
    platform: 'instagram',
    postUrl: post.postUrl,
    username: post.username,
    likes: post.likes,
    comments: post.comments,
    timestamp: post.postedAt,
    caption: post.caption,
    media: post.mediaKind
      ? {
          kind: post.mediaKind,
          urls: post.mediaUrl ? [post.mediaUrl] : [],
        }
      : undefined,
    sourceProfileUrl: post.username ? `https://www.instagram.com/${post.username.replace(/^@/, '')}/` : undefined,
  }
}

function normalisePostUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function uniqueCapturedPosts(posts: CapturedPost[]): CapturedPost[] {
  const unique = new Map<string, CapturedPost>()
  for (const post of posts) {
    const key = `${post.competitorId}\u0000${normalisePostUrl(post.postUrl)}`
    unique.set(key, { ...post, postUrl: normalisePostUrl(post.postUrl) })
  }
  return [...unique.values()]
}

function refreshCompetitorPostStats(competitorId: string) {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) return
  // postCount reflects the posts actually saved to Content; avgLikes is owned
  // by capture (refreshCompetitorStats) and is intentionally NOT recomputed
  // from the saved subset, which is a curated selection rather than a sample.
  const count = stack.capturedPosts.countForCompetitor(competitorId)
  stack.competitors.update(competitorId, { postCount: count })
}

function deriveDisplayName(
  existing: string | undefined,
  profile: ProfileData | undefined,
): string | undefined {
  return profile?.fullName?.trim() || existing
}

function deriveBio(
  existing: string | undefined,
  profile: ProfileData | undefined,
): string | undefined {
  return profile?.bio?.trim() || existing
}

function enrichPost(post: CapturedPost) {
  const owner = getStack().competitors.get(post.competitorId)
  return owner ? enrichPostForOwner(post, owner) : post
}

function enrichPostForOwner(
  post: CapturedPost,
  owner: PostOwner,
) {
  return {
    ...post,
    competitorHandle: owner?.handle,
    competitorTint: owner?.tint,
    competitorFollowers: owner?.followers,
    competitorAvgLikes: owner?.avgLikes,
    competitorLevel: owner?.level,
  }
}

/** Internal helpers exposed for unit tests only. Not part of the HTTP surface. */
export const __testing = { refreshCompetitorStats }
