import { randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  captureInstagramData,
  silentReporter,
  type PostData,
  type ProfileData,
  type StandardCrawlerOutput,
} from '@anubis/research-crawler'
import type { CapturedPost } from '@anubis/conversation'
import { getStack } from './services.js'
import { ensureFreshLoginChrome } from './chrome-guard.js'

/**
 * The configured loginProfileDir is the full path to a named profile
 * (e.g. ".../User Data/Profile 3"). Chrome needs that split into the
 * user-data root and the profile subdir, otherwise it treats the whole
 * path as a fresh user-data root and creates a blank Default profile
 * inside it — which is the "wrong profile" symptom.
 */
function splitProfilePath(full: string | undefined): {
  userDataDir?: string
  profileDirectory?: string
} {
  if (!full) return {}
  const trimmed = full.trim()
  if (!trimmed) return {}
  return {
    userDataDir: dirname(trimmed),
    profileDirectory: basename(trimmed),
  }
}

/* -----------------------------------------------------------
   Capture orchestration
   -----------------------------------------------------------
   Bridges @anubis/research-crawler (CDP-driven Instagram
   capture) with @anubis/conversation persistence (competitor
   stats + captured posts).

   POST /captures/competitors/:id   — runs a capture for one
                                      tracked handle and
                                      upserts posts.
   GET  /posts                      — flat feed of captured
                                      posts joined with the
                                      owning competitor, used
                                      by the Content page.
   ----------------------------------------------------------- */

const CaptureBody = z.object({
  /** Which Chrome profile dir/port to use. Defaults to 'public'. */
  profile: z.enum(['login', 'public', 'flow']).optional(),
  /** When true, launch Chrome headless. */
  headless: z.boolean().optional(),
  /**
   * Required when running the login profile headless — the crawler
   * normally refuses (it expects the user to be interacting). With
   * this flag set the saved cookies are reused without a UI.
   */
  forceHeadless: z.boolean().optional(),
  /** Hard cap on posts returned — keeps a refresh from running away. */
  maxResponses: z.number().int().positive().max(120).optional(),
  /** Default 90s; capture can be slow especially on the first scroll. */
  timeoutMs: z.number().int().positive().max(180_000).optional(),
}).strict()

export const captureRoutes = new Hono()

captureRoutes.post('/competitors/:id', async (c) => {
  const stack = getStack()
  const competitor = stack.competitors.get(c.req.param('id'))
  if (!competitor) return c.json({ ok: false, error: 'not_found' }, 404)

  const body = CaptureBody.parse(await c.req.json().catch(() => ({})))
  const usernameNoAt = competitor.handle.replace(/^@/, '')

  // When the user picked the 'login' profile, lift their configured
  // Chrome user-data dir + chrome executable path from app config so
  // captures hit the same Chrome profile they actually signed in on
  // (e.g. 'Profile 3' in the user's main Chrome). chromePath applies
  // to any profile if set.
  const cfg = stack.appConfig.get()
  const selectedProfile = body.profile ?? 'public'
  // Login flow is being rewired to the Anubis extension in a later task;
  // for now drop the removed loginProfileDir read so the file compiles.
  const split: { userDataDir?: string; profileDirectory?: string } = {}

  // Kill any stale Chrome on the login port whose user-data root
  // doesn't match what we want — otherwise launchChrome would silently
  // reuse it. Compared against the user-data root (parent), since
  // that's what Chrome's /json/version reports.
  if (selectedProfile === 'login') {
    await ensureFreshLoginChrome(split.userDataDir)
  }

  let result: StandardCrawlerOutput
  try {
    result = await captureInstagramData({
      username: usernameNoAt,
      profile: selectedProfile,
      profileDir: split.userDataDir,
      profileDirectory: split.profileDirectory,
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
          message: e instanceof Error ? e.message : 'Capture threw an unexpected error.',
          hint: 'If this is the first capture, run /research-crawler/chrome/open with profile=login, sign into Instagram once, then retry.',
        },
      },
      500,
    )
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

  // Refresh competitor stats from this capture's profile entry +
  // the avgLikes calculation in meta (modal-cluster-mean).
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

  // Join with competitor metadata so the UI can render handle + tint
  // without a second request.
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
