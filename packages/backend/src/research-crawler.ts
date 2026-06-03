import { basename, dirname } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  captureInstagramData,
  discoverInstagramCompetitors,
  launchChrome,
  silentReporter,
} from '@anubis/research-crawler'
import { getStack } from './services.js'
import { ensureFreshLoginChrome } from './chrome-guard.js'

/**
 * AppConfig stores the full path to a named Chrome profile
 * (e.g. ".../User Data/Profile 3"). Chrome wants that split into:
 *   - --user-data-dir = the parent (the User Data folder)
 *   - --profile-directory = the subdir name (Profile 3)
 * Without --profile-directory Chrome treats the whole path as a fresh
 * user-data root and creates a blank Default profile inside it.
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

/**
 * Returns a partial input that wires up the user's configured Chrome
 * profile + executable path. For the 'login' profile the path is split
 * into (userDataDir, profileDirectory) so Chrome loads the named
 * profile inside the existing user-data root instead of treating the
 * full path as a fresh root.
 */
function configOverrides(profile: string | undefined): {
  profileDir?: string
  profileDirectory?: string
  chromePath?: string
} {
  const cfg = getStack().appConfig.get()
  // Login flow moves to the Anubis extension in a later task; for now
  // the CDP login path is a no-op carrying only chromePath.
  void profile
  return { chromePath: cfg.chromePath }
}

/**
 * Merges request input with config overrides using the precedence
 *   explicit body field > config > undefined
 * Spread order matters — we cannot `{ ...overrides, ...input }` because
 * the request body has the keys present-but-undefined when the caller
 * didn't set them, which would wipe the configured value.
 */
function withOverrides<
  T extends { profileDir?: string; profileDirectory?: string; chromePath?: string },
>(
  input: T,
  overrides: { profileDir?: string; profileDirectory?: string; chromePath?: string },
): T {
  return {
    ...input,
    profileDir: input.profileDir ?? overrides.profileDir,
    profileDirectory: input.profileDirectory ?? overrides.profileDirectory,
    chromePath: input.chromePath ?? overrides.chromePath,
  }
}

researchCrawlerRoutes.post('/chrome/open', async (c) => {
  const input = openChromeSchema.parse(await c.req.json())
  const merged = withOverrides(input, configOverrides(input.profile))
  if (input.profile === 'login') {
    await ensureFreshLoginChrome(merged.profileDir)
  }
  return c.json(await launchChrome(merged))
})

researchCrawlerRoutes.post('/instagram/capture-profile', async (c) => {
  const input = captureInstagramProfileSchema.parse(await c.req.json())
  const merged = withOverrides(input, configOverrides(input.profile))
  if (input.profile === 'login') {
    await ensureFreshLoginChrome(merged.profileDir)
  }
  return c.json(
    await captureInstagramData({
      ...merged,
      reporter: silentReporter(),
    }),
  )
})

researchCrawlerRoutes.post('/instagram/discover', async (c) => {
  const input = discoverInstagramSchema.parse(await c.req.json())
  const merged = withOverrides(input, configOverrides(input.profile))
  if (input.profile === 'login') {
    await ensureFreshLoginChrome(merged.profileDir)
  }
  return c.json(
    await discoverInstagramCompetitors({
      ...merged,
      reporter: silentReporter(),
    }),
  )
})
