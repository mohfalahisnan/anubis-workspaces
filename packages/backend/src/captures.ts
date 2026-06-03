import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  applyAvgLikesToOutput,
  captureInstagramData,
  silentReporter,
  type PostData,
  type ProfileData,
  type StandardCrawlerOutput,
} from '@anubis/research-crawler'
import type { CapturedPost } from '@anubis/conversation'
import { getStack, ensureExtensionStarted, getJobQueue } from './services.js'
import { mapExtensionError } from './extension/error-mapping.js'

/* -----------------------------------------------------------
   Capture orchestration
   -----------------------------------------------------------
   POST /captures/competitors/:id
     - profile=login  → dispatch to the Anubis extension. The
                        extension scrapes IG inside the user's
                        real session and posts back raw
                        ProfileData + PostData. We synthesize a
                        StandardCrawlerOutput and run avg-likes
                        backend-side so persistence + competitor
                        stats stay identical.
     - profile=public → existing CDP scraper (anonymous mode).
     - profile=flow   → existing CDP scraper.

   GET /posts                 — flat feed of captured posts joined
                                with the owning competitor.
   ----------------------------------------------------------- */

const CaptureBody = z.object({
  profile: z.enum(['login', 'public', 'flow']).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  maxResponses: z.number().int().positive().max(120).optional(),
  timeoutMs: z.number().int().positive().max(180_000).optional(),
}).strict()

export const captureRoutes = new Hono()

captureRoutes.post('/competitors/:id', async (c) => {
  const stack = getStack()
  const competitor = stack.competitors.get(c.req.param('id'))
  if (!competitor) return c.json({ ok: false, error: 'not_found' }, 404)

  const body = CaptureBody.parse(await c.req.json().catch(() => ({})))
  const usernameNoAt = competitor.handle.replace(/^@/, '')
  const selectedProfile = body.profile ?? 'public'
  const cfg = stack.appConfig.get()

  let result: StandardCrawlerOutput
  if (selectedProfile === 'login') {
    await ensureExtensionStarted()
    const queue = getJobQueue()
    if (!queue) {
      return c.json(
        { ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Extension queue not ready.' } },
        503,
      )
    }
    try {
      const data = await queue.dispatch({
        kind: 'capture-profile',
        input: { username: usernameNoAt, maxResponses: body.maxResponses ?? 30 },
        timeoutMs: body.timeoutMs ?? 90_000,
      }) as { profiles: ProfileData[]; posts: PostData[] }
      result = synthStandardOutput(data, usernameNoAt, body.maxResponses ?? 30)
    } catch (e) {
      return mapExtensionError(c, e)
    }
  } else {
    try {
      result = await captureInstagramData({
        username: usernameNoAt,
        profile: selectedProfile,
        chromePath: cfg.chromePath,
        headless: body.headless,
        forceHeadless: body.forceHeadless,
        maxResponses: body.maxResponses ?? 30,
        timeoutMs: body.timeoutMs ?? 90_000,
        reporter: silentReporter(),
      })
    } catch (e) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'CAPTURE_FAILED',
            message: e instanceof Error ? e.message : 'Capture threw.',
          },
        },
        500,
      )
    }
  }

  if (!result.ok) {
    return c.json(
      {
        ok: false,
        error: {
          code: result.error?.code ?? 'CAPTURE_FAILED',
          message: result.error?.message ?? 'Capture failed.',
          warnings: result.meta.warnings,
        },
      },
      500,
    )
  }

  // Persist posts
  const now = Date.now()
  const posts: CapturedPost[] = result.output.posts
    .filter((p) => Boolean(p.postUrl))
    .map((p) => postDataToCapturedPost(competitor.id, usernameNoAt, p, now))
  stack.capturedPosts.upsertMany(posts)

  const profileEntry =
    result.output.profiles.find((p) => p.username === usernameNoAt) ??
    result.output.profiles[0]
  const avgLikesEntry =
    result.meta.avgLikes?.perProfile.find((entry) => entry.username === usernameNoAt) ??
    result.meta.avgLikes?.perProfile[0]

  const totalPostsInDb = stack.capturedPosts.countForCompetitor(competitor.id)
  stack.competitors.update(competitor.id, {
    displayName: deriveDisplayName(competitor.displayName, profileEntry),
    followers: profileEntry?.followers,
    avgLikes: avgLikesEntry?.avgLikes ?? profileEntry?.avgLikes,
    postCount: totalPostsInDb,
  })
  stack.competitors.markRefreshedAt(competitor.id, now)

  return c.json({
    ok: true,
    competitor: stack.competitors.get(competitor.id),
    capturedCount: posts.length,
    warnings: result.meta.warnings,
  })
})

/** GET /posts — flat captured-post feed for the Content page. */
const ListQuery = z.object({
  competitorId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  orderBy: z.enum(['recent', 'engagement']).optional(),
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
    limit: opts.limit ?? 60,
    orderBy: opts.orderBy ?? 'recent',
  })

  const competitorsById = new Map(stack.competitors.list().map((c) => [c.id, c]))
  const items = rows.map((row) => {
    const owner = competitorsById.get(row.competitorId)
    return {
      ...row,
      competitorHandle: owner?.handle,
      competitorTint: owner?.tint,
    }
  })
  return c.json({ ok: true, items })
})

/* ---------- helpers ---------- */

/**
 * Wraps extension-returned raw posts in the StandardCrawlerOutput
 * shape the downstream persistence + avg-likes code expects, then
 * runs the modal-cluster-mean over the posts so the resulting
 * meta.avgLikes matches the CDP path exactly.
 */
function synthStandardOutput(
  data: { profiles: ProfileData[]; posts: PostData[] },
  username: string,
  maxResponses: number,
): StandardCrawlerOutput {
  const out: StandardCrawlerOutput = {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['Profile Data List', 'Post Data List'],
    input: {
      target: 'instagram',
      mode: 'profile_capture',
      username,
      maxResponses,
    },
    output: { profiles: data.profiles, posts: data.posts },
    meta: {
      profileCount: data.profiles.length,
      postCount: data.posts.length,
      warnings: [],
    },
  }
  return applyAvgLikesToOutput(out)
}

function postDataToCapturedPost(
  competitorId: string,
  username: string,
  p: PostData,
  capturedAt: number,
): CapturedPost {
  const kind = p.media?.kind
  const urls = p.media?.urls ?? []
  return {
    id: randomUUID(),
    competitorId,
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

function deriveDisplayName(
  existing: string | undefined,
  profile: ProfileData | undefined,
): string | undefined {
  return profile?.fullName?.trim() || existing
}
