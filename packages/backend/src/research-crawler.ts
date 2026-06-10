import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  captureInstagramData,
  discoverInstagramCompetitors,
  captureChatGPTConversations,
  captureChatGPTConversationDetails,
  sendChatGPTPrompt,
  captureQwenConversations,
  captureQwenConversationDetails,
  sendQwenPrompt,
  launchChrome,
  silentReporter,
} from '@anubis/research-crawler'
import type { DiscoverJobResult, DiscoveredCandidate } from '@anubis/shared'
import { getDataDir, getStack } from './services.js'
import { withCrawlerProfileDefaults, type CrawlerProfileName } from './chrome-defaults.js'
import { jobManager } from './jobs.js'

/* -----------------------------------------------------------
   Research-crawler routes
   -----------------------------------------------------------
   - profile=login   → CDP crawler using the user's logged-in
                       Chrome profile.
   - profile=public  → existing CDP scraper (anonymous mode).
   - profile=flow    → existing CDP scraper.
   - ----------------------------------------------------------- */

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
  /** When true, run as a background job and return { jobId } immediately. */
  async: z.boolean().optional(),
  /** Optional project scope for the job (used to filter the top-nav job list). */
  projectId: z.string().min(1).optional(),
}).strict().refine((value) => value.source !== 'hashtag' || value.hashtag, {
  message: 'Pass hashtag when source is hashtag.',
}).refine((value) => value.source !== 'keyword' || value.keyword, {
  message: 'Pass keyword when source is keyword.',
})

export const researchCrawlerRoutes = new Hono()

const captureChatGPTConversationsSchema = z.object({
  chromeOrigin: z.string().url().optional(),
  remoteDebuggingPort: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  openNewTab: z.boolean().optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  profileDirectory: z.string().min(1).optional(),
  chromePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  keepChromeOpen: z.boolean().optional(),
  keepTabOpen: z.boolean().optional(),
  includeRaw: z.boolean().optional(),
}).strict()

const captureChatGPTConversationDetailsSchema = z.object({
  chromeOrigin: z.string().url().optional(),
  remoteDebuggingPort: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  openNewTab: z.boolean().optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  profileDirectory: z.string().min(1).optional(),
  chromePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  keepChromeOpen: z.boolean().optional(),
  keepTabOpen: z.boolean().optional(),
  includeRaw: z.boolean().optional(),
}).strict()

const sendChatGPTPromptSchema = z.object({
  prompt: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  chromeOrigin: z.string().url().optional(),
  remoteDebuggingPort: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  openNewTab: z.boolean().optional(),
  profile: profileSchema.optional(),
  profileDir: z.string().min(1).optional(),
  profileDirectory: z.string().min(1).optional(),
  chromePath: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  forceHeadless: z.boolean().optional(),
  keepChromeOpen: z.boolean().optional(),
  keepTabOpen: z.boolean().optional(),
  includeRaw: z.boolean().optional(),
}).strict()

researchCrawlerRoutes.post('/chrome/open', async (c) => {
  const input = openChromeSchema.parse(await c.req.json())
  const cfg = getStack().appConfig.get()
  return c.json(await launchChrome(withCrawlerProfileDefaults({
    ...input,
    chromePath: input.chromePath ?? cfg.chromePath,
  }, input.profile ?? 'login', cfg, getDataDir())))
})

researchCrawlerRoutes.post('/chatgpt/conversations', async (c) => {
  const input = captureChatGPTConversationsSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return c.json(
    await captureChatGPTConversations(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

researchCrawlerRoutes.post('/chatgpt/conversations/:id', async (c) => {
  const conversationId = c.req.param('id')
  const input = captureChatGPTConversationDetailsSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return c.json(
    await captureChatGPTConversationDetails(withCrawlerProfileDefaults({
      ...input,
      conversationId,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

researchCrawlerRoutes.post('/chatgpt/prompt', async (c) => {
  const input = sendChatGPTPromptSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return c.json(
    await sendChatGPTPrompt(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

// Streaming variant: emits Server-Sent Events as the assistant response renders.
//   event: delta  data: { text }   (full assistant text so far)
//   event: done   data: <StandardCrawlerOutput>
//   event: error  data: { message }
researchCrawlerRoutes.post('/chatgpt/prompt/stream', async (c) => {
  const input = sendChatGPTPromptSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return streamSSE(c, async (stream) => {
    // Buffer deltas across the async boundary so we never miss one between writes.
    let latest: string | null = null
    let lastSent: string | null = null
    let finished = false

    const pump = (async () => {
      while (!finished) {
        if (latest !== null && latest !== lastSent) {
          lastSent = latest
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: lastSent }) })
        }
        await stream.sleep(150)
      }
    })()

    try {
      const result = await sendChatGPTPrompt(withCrawlerProfileDefaults({
        ...input,
        chromePath: input.chromePath ?? cfg.chromePath,
        reporter: silentReporter(),
        onDelta: (text) => { latest = text },
      }, profile, cfg, getDataDir()))
      finished = true
      await pump
      if (latest !== null && latest !== lastSent) {
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: latest }) })
      }
      await stream.writeSSE({ event: 'done', data: JSON.stringify(result) })
    } catch (err) {
      finished = true
      await pump.catch(() => {})
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: err instanceof Error ? err.message : 'stream failed' }) })
    }
  })
})

/* -----------------------------------------------------------
   Qwen (chat.qwen.ai) routes — same CDP login profile as ChatGPT.
   ----------------------------------------------------------- */

researchCrawlerRoutes.post('/qwen/conversations', async (c) => {
  const input = captureChatGPTConversationsSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return c.json(
    await captureQwenConversations(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

researchCrawlerRoutes.post('/qwen/conversations/:id', async (c) => {
  const conversationId = c.req.param('id')
  const input = captureChatGPTConversationDetailsSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return c.json(
    await captureQwenConversationDetails(withCrawlerProfileDefaults({
      ...input,
      conversationId,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

researchCrawlerRoutes.post('/qwen/prompt', async (c) => {
  const input = sendChatGPTPromptSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return c.json(
    await sendQwenPrompt(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

// Streaming variant: emits Server-Sent Events as the assistant response renders.
//   event: delta  data: { text }   (full assistant text so far)
//   event: done   data: <StandardCrawlerOutput>
//   event: error  data: { message }
researchCrawlerRoutes.post('/qwen/prompt/stream', async (c) => {
  const input = sendChatGPTPromptSchema.parse(await c.req.json().catch(() => ({})))
  const cfg = getStack().appConfig.get()
  const profile = input.profile ?? 'login'
  return streamSSE(c, async (stream) => {
    let latest: string | null = null
    let lastSent: string | null = null
    let finished = false

    const pump = (async () => {
      while (!finished) {
        if (latest !== null && latest !== lastSent) {
          lastSent = latest
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: lastSent }) })
        }
        await stream.sleep(150)
      }
    })()

    try {
      const result = await sendQwenPrompt(withCrawlerProfileDefaults({
        ...input,
        chromePath: input.chromePath ?? cfg.chromePath,
        reporter: silentReporter(),
        onDelta: (text) => { latest = text },
      }, profile, cfg, getDataDir()))
      finished = true
      await pump
      if (latest !== null && latest !== lastSent) {
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: latest }) })
      }
      await stream.writeSSE({ event: 'done', data: JSON.stringify(result) })
    } catch (err) {
      finished = true
      await pump.catch(() => {})
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: err instanceof Error ? err.message : 'stream failed' }) })
    }
  })
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

  // Background mode: enqueue a job and return its id immediately. The
  // job result carries the candidate profiles so the UI can render the
  // "pick competitors to add" modal on completion.
  if (input.async) {
    const sourceLabel =
      input.source === 'hashtag'
        ? `#${input.hashtag}`
        : input.source === 'keyword'
          ? `"${input.keyword}"`
          : 'explore'
    const job = jobManager.runJob<DiscoverJobResult>(
      {
        kind: 'discover-competitors',
        label: `Discover · ${sourceLabel}`,
        projectId: input.projectId,
      },
      async (ctx) => {
        const result = await discoverInstagramCompetitors(withCrawlerProfileDefaults({
          ...input,
          chromePath: input.chromePath ?? cfg.chromePath,
          reporter: ctx.reporter,
        }, profile, cfg, getDataDir()))
        if (!result.ok) {
          throw new Error(result.error?.message ?? 'Discovery failed.')
        }
        for (const warning of result.meta.warnings ?? []) ctx.warn(warning)
        return { candidates: mapDiscoveredCandidates(result.output.profiles) }
      },
    )
    return c.json({ ok: true, jobId: job.id })
  }

  return c.json(
    await discoverInstagramCompetitors(withCrawlerProfileDefaults({
      ...input,
      chromePath: input.chromePath ?? cfg.chromePath,
      reporter: silentReporter(),
    }, profile, cfg, getDataDir())),
  )
})

/** Map the crawler's raw profile shape to the UI's DiscoveredCandidate. */
function mapDiscoveredCandidates(
  profiles: Array<{
    username: string
    fullName?: string
    bio?: string
    followers?: number
    profileImageUrl?: string
    profileUrl?: string
  }>,
): DiscoveredCandidate[] {
  return profiles.map((p) => ({
    username: p.username,
    fullName: p.fullName,
    bio: p.bio,
    followers: p.followers,
    profileImageUrl: p.profileImageUrl,
    profileUrl: p.profileUrl,
  }))
}

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
