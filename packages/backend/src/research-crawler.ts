import { Hono } from 'hono'
import { z } from 'zod'
import {
  captureInstagramData,
  discoverInstagramCompetitors,
  launchChrome,
  silentReporter,
} from '@anubis/research-crawler'
import { getDataDir, getStack } from './services.js'
import { withCrawlerProfileDefaults, type CrawlerProfileName } from './chrome-defaults.js'

/* -----------------------------------------------------------
   Research-crawler routes
   -----------------------------------------------------------
   - profile=login   → CDP crawler using the user's logged-in
                       Chrome profile.
   - profile=public  → existing CDP scraper (anonymous mode).
   - profile=flow    → existing CDP scraper.
   ----------------------------------------------------------- */

const profileSchema = z.enum(['login', 'public', 'flow'])

const openChromeSchema = z.object({
  url: z.string().url().optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  profileDirectory: z.string().min(1).optional(),
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
  profileDirectory: z.string().min(1).optional(),
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
  profileDirectory: z.string().min(1).optional(),
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
  const cfg = getStack().appConfig.get()
  return c.json(await launchChrome(withCrawlerProfileDefaults({
    ...input,
    chromePath: input.chromePath ?? cfg.chromePath,
  }, input.profile ?? 'login', cfg, getDataDir())))
})

researchCrawlerRoutes.post('/instagram/capture-profile', async (c) => {
  const input = captureInstagramProfileSchema.parse(await c.req.json())
  const cfg = getStack().appConfig.get()
  const profile = inferCaptureProfile(input.profile, input.remoteDebuggingPort)
  return c.json(
    await captureInstagramData(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

researchCrawlerRoutes.post('/instagram/discover', async (c) => {
  const input = discoverInstagramSchema.parse(await c.req.json())
  const cfg = getStack().appConfig.get()
  const profile = inferDiscoverProfile(input.profile, input.remoteDebuggingPort)
  return c.json(
    await discoverInstagramCompetitors(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

function inferCaptureProfile(
  profile: CrawlerProfileName | undefined,
  port: number | undefined,
): CrawlerProfileName {
  if (profile) return profile
  return port === 9222 ? 'login' : 'public'
}

function inferDiscoverProfile(
  profile: CrawlerProfileName | undefined,
  port: number | undefined,
): CrawlerProfileName {
  if (profile) return profile
  return port === 9223 ? 'public' : 'login'
}
