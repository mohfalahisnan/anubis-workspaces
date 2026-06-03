import { Hono } from 'hono'
import { z } from 'zod'
import {
  captureInstagramData,
  discoverInstagramCompetitors,
  launchChrome,
  silentReporter,
  type PostData,
  type ProfileData,
} from '@anubis/research-crawler'
import { getStack, ensureExtensionStarted, getJobQueue } from './services.js'
import { mapExtensionError } from './extension/error-mapping.js'

/* -----------------------------------------------------------
   Research-crawler routes
   -----------------------------------------------------------
   - profile=login   → dispatched to the Anubis extension; the
                       chrome/open route returns NOT_APPLICABLE
                       because there is no Chrome for us to
                       launch on the login flow anymore.
   - profile=public  → existing CDP scraper (anonymous mode).
   - profile=flow    → existing CDP scraper.
   ----------------------------------------------------------- */

const profileSchema = z.enum(['login', 'public', 'flow'])

const openChromeSchema = z.object({
  url: z.string().url().optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  remoteDebuggingPort: z.number().int().positive().optional(),
  chromePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
}).strict()

const captureInstagramProfileSchema = z.object({
  username: z.string().min(1).optional(),
  url: z.string().url().optional(),
  chromeOrigin: z.string().url().optional(),
  remoteDebuggingPort: z.number().int().positive().optional(),
  maxResponses: z.number().int().positive().max(200).optional(),
  timeoutMs: z.number().int().positive().optional(),
  includeRaw: z.boolean().optional(),
  openNewTab: z.boolean().optional(),
  scrollIntervalMs: z.number().int().positive().max(10000).optional(),
  initialDelayMs: z.number().int().nonnegative().max(10000).optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  chromePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  keepChromeOpen: z.boolean().optional(),
  keepTabOpen: z.boolean().optional(),
}).strict().refine((value) => value.username || value.url, {
  message: 'Pass username or url.',
})

const discoverInstagramSchema = z.object({
  source: z.enum(['explore', 'hashtag', 'keyword']).optional(),
  hashtag: z.string().min(1).optional(),
  keyword: z.string().min(1).optional(),
  chromeOrigin: z.string().url().optional(),
  remoteDebuggingPort: z.number().int().positive().optional(),
  targetCompetitors: z.number().int().positive().max(200).optional(),
  timeoutMs: z.number().int().positive().optional(),
  includeRaw: z.boolean().optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  chromePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  keepChromeOpen: z.boolean().optional(),
}).strict().refine((value) => value.source !== 'hashtag' || value.hashtag, {
  message: 'Pass hashtag when source is hashtag.',
}).refine((value) => value.source !== 'keyword' || value.keyword, {
  message: 'Pass keyword when source is keyword.',
})

export const researchCrawlerRoutes = new Hono()

researchCrawlerRoutes.post('/chrome/open', async (c) => {
  const input = openChromeSchema.parse(await c.req.json())
  if (input.profile === 'login') {
    return c.json({
      ok: false,
      error: {
        code: 'NOT_APPLICABLE_FOR_LOGIN',
        message: 'Login captures use the Anubis extension; there is no Chrome for the backend to launch.',
      },
    }, 400)
  }
  const chromePath = getStack().appConfig.get().chromePath
  return c.json(await launchChrome({ ...input, chromePath: input.chromePath ?? chromePath }))
})

researchCrawlerRoutes.post('/instagram/capture-profile', async (c) => {
  const input = captureInstagramProfileSchema.parse(await c.req.json())
  if (input.profile === 'login') {
    await ensureExtensionStarted()
    const queue = getJobQueue()
    if (!queue) return c.json({ ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Extension queue not ready.' } }, 503)
    const username = input.username?.replace(/^@/, '').trim()
    if (!username) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'username required for login profile' } }, 400)
    try {
      const data = await queue.dispatch({
        kind: 'capture-profile',
        input: { username, maxResponses: input.maxResponses ?? 30 },
        timeoutMs: input.timeoutMs ?? 90_000,
      }) as { profiles: ProfileData[]; posts: PostData[] }
      return c.json({
        ok: true,
        schemaVersion: '1.0',
        outputTypes: ['Profile Data List', 'Post Data List'],
        output: { profiles: data.profiles, posts: data.posts },
        meta: { profileCount: data.profiles.length, postCount: data.posts.length, warnings: [] },
      })
    } catch (e) {
      return mapExtensionError(c, e)
    }
  }
  const chromePath = getStack().appConfig.get().chromePath
  return c.json(
    await captureInstagramData({
      ...input,
      chromePath: input.chromePath ?? chromePath,
      reporter: silentReporter(),
    }),
  )
})

researchCrawlerRoutes.post('/instagram/discover', async (c) => {
  const input = discoverInstagramSchema.parse(await c.req.json())
  if (input.profile === 'login') {
    await ensureExtensionStarted()
    const queue = getJobQueue()
    if (!queue) return c.json({ ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Extension queue not ready.' } }, 503)
    try {
      const data = await queue.dispatch({
        kind: 'discover',
        input: {
          source: input.source ?? 'explore',
          hashtag: input.hashtag,
          keyword: input.keyword,
          targetCompetitors: input.targetCompetitors ?? 10,
        },
        timeoutMs: input.timeoutMs ?? 60_000,
      }) as { profiles: ProfileData[]; posts: PostData[] }
      return c.json({
        ok: true,
        schemaVersion: '1.0',
        outputTypes: ['Profile Data List', 'Post Data List'],
        output: { profiles: data.profiles, posts: data.posts },
        meta: { profileCount: data.profiles.length, postCount: data.posts.length, warnings: [] },
      })
    } catch (e) {
      return mapExtensionError(c, e)
    }
  }
  const chromePath = getStack().appConfig.get().chromePath
  return c.json(
    await discoverInstagramCompetitors({
      ...input,
      chromePath: input.chromePath ?? chromePath,
      reporter: silentReporter(),
    }),
  )
})
