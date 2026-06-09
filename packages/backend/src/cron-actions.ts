import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  calculateAvgLikesSummary,
  captureInstagramData,
  discoverInstagramCompetitors,
  silentReporter,
  type PostData,
  type ProfileData,
  type StandardCrawlerOutput,
} from '@anubis/research-crawler'
import type {
  CapturePostsCronConfig,
  CompetitorDiscoveryCronConfig,
  CronActionConfig,
} from '@anubis/shared'
import type { ConversationStack, CronJob, CapturedPost } from '@anubis/conversation'
import { withCrawlerProfileDefaults } from './chrome-defaults.js'

interface CronRunSummary {
  newCompetitors: number
  postsCaptured: number
  errors: string[]
}

interface CronRunOutput {
  jobId: string
  actionType: CronJob['actionType']
  ranAt: string
  result: Record<string, unknown>
  summary: CronRunSummary
}

export async function runCronActionJob(
  job: CronJob,
  stack: ConversationStack,
  dataDir: string,
): Promise<void> {
  const ranAt = new Date().toISOString()
  const output: CronRunOutput = {
    jobId: job.id,
    actionType: job.actionType,
    ranAt,
    result: {},
    summary: { newCompetitors: 0, postsCaptured: 0, errors: [] },
  }

  try {
    if (job.actionType === 'competitor-discovery') {
      const config = asCompetitorDiscoveryConfig(job.actionConfig)
      if (!config) {
        output.summary.errors.push('invalid competitor-discovery config')
      } else {
        const run = await runCompetitorDiscovery(config, stack, dataDir)
        output.result = run.result
        output.summary = run.summary
      }
    } else if (job.actionType === 'capture-posts') {
      const config = asCapturePostsConfig(job.actionConfig)
      if (!config) {
        output.summary.errors.push('invalid capture-posts config')
      } else {
        const run = await runCapturePosts(config, stack, dataDir)
        output.result = run.result
        output.summary = run.summary
      }
    } else {
      output.summary.errors.push(`unsupported cron action type: ${job.actionType}`)
    }
  } catch (err) {
    output.summary.errors.push(err instanceof Error ? err.message : String(err))
  }

  await writeCronRunOutput(job, stack, output).catch((err) => {
    console.warn('[cron] failed to write run output', job.id, err)
  })
}

function asCompetitorDiscoveryConfig(config: CronActionConfig | undefined): CompetitorDiscoveryCronConfig | null {
  if (!config) return null
  if ('query' in config && 'projectId' in config && 'captureProfile' in config) return config
  return null
}

function asCapturePostsConfig(config: CronActionConfig | undefined): CapturePostsCronConfig | null {
  if (!config) return null
  if ('handles' in config && 'projectId' in config && 'captureProfile' in config) return config
  return null
}

async function runCompetitorDiscovery(
  config: CompetitorDiscoveryCronConfig,
  stack: ConversationStack,
  dataDir: string,
): Promise<{ result: Record<string, unknown>; summary: CronRunSummary }> {
  const cfg = stack.appConfig.get()
  const query = config.query.trim()
  const source = resolveDiscoverySource(query)
  const crawlerResult = await discoverInstagramCompetitors(withCrawlerProfileDefaults({
    ...source,
    profile: config.captureProfile,
    chromePath: cfg.chromePath,
    reporter: silentReporter(),
  }, config.captureProfile, cfg, dataDir))

  const summary: CronRunSummary = { newCompetitors: 0, postsCaptured: 0, errors: [] }
  if (!crawlerResult.ok) {
    summary.errors.push(crawlerResult.error?.message ?? 'discovery failed')
    return {
      result: {
        query,
        source: source.source,
        warnings: crawlerResult.meta.warnings,
      },
      summary,
    }
  }

  const existing = new Set(
    stack.competitors.list(config.projectId).map((competitor) => normalizeHandle(competitor.handle)),
  )
  const seen = new Set<string>()
  const candidates: Array<Record<string, unknown>> = []

  for (const profile of crawlerResult.output.profiles) {
    const username = normalizeUsername(profile.username)
    if (!username || seen.has(username)) continue
    seen.add(username)

    if (existing.has(username)) {
      candidates.push({
        username,
        added: false,
        skipped: 'already-tracked',
      })
      continue
    }

    try {
      stack.competitors.create({
        handle: username,
        projectId: config.projectId,
        displayName: profile.fullName?.trim() || undefined,
        followers: profile.followers,
        bio: profile.bio?.trim() || undefined,
        level: config.defaultLevel,
      })
      existing.add(username)
      summary.newCompetitors += 1
      candidates.push({
        username,
        fullName: profile.fullName,
        followers: profile.followers,
        added: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      summary.errors.push(`@${username}: ${message}`)
      candidates.push({
        username,
        added: false,
        error: message,
      })
    }
  }

  return {
    result: {
      query,
      source: source.source,
      warnings: crawlerResult.meta.warnings,
      discoveredCount: seen.size,
      candidates,
    },
    summary,
  }
}

async function runCapturePosts(
  config: CapturePostsCronConfig,
  stack: ConversationStack,
  dataDir: string,
): Promise<{ result: Record<string, unknown>; summary: CronRunSummary }> {
  const handles = resolveCaptureHandles(config, stack)
  const summary: CronRunSummary = { newCompetitors: 0, postsCaptured: 0, errors: [] }
  const perHandle: Array<Record<string, unknown>> = []

  for (const handle of handles) {
    const competitor = stack.competitors.list(config.projectId).find((item) => normalizeHandle(item.handle) === normalizeHandle(handle))
    if (!competitor) {
      const message = `@${normalizeHandle(handle).replace(/^@/, '')}: competitor not found in project ${config.projectId}`
      summary.errors.push(message)
      perHandle.push({ handle: normalizeHandle(handle), ok: false, error: message })
      continue
    }

    const run = await captureTrackedCompetitor(competitor.id, config.captureProfile, config.postLimit, stack, dataDir)
    summary.postsCaptured += run.capturedCount
    summary.errors.push(...run.errors)
    perHandle.push({
      handle: competitor.handle,
      ok: run.errors.length === 0,
      capturedCount: run.capturedCount,
      warnings: run.warnings,
      errors: run.errors,
    })
  }

  return {
    result: {
      projectId: config.projectId,
      handles: handles.map((handle) => normalizeHandle(handle)),
      postLimit: config.postLimit ?? 30,
      perHandle,
    },
    summary,
  }
}

function resolveCaptureHandles(
  config: CapturePostsCronConfig,
  stack: ConversationStack,
): string[] {
  if (config.handles === 'all') {
    return stack.competitors.list(config.projectId).map((competitor) => competitor.handle)
  }
  return config.handles
}

async function captureTrackedCompetitor(
  competitorId: string,
  profile: 'public' | 'login',
  postLimit: number | undefined,
  stack: ConversationStack,
  dataDir: string,
): Promise<{ capturedCount: number; warnings: string[]; errors: string[] }> {
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) {
    return { capturedCount: 0, warnings: [], errors: [`competitor ${competitorId} not found`] }
  }

  const cfg = stack.appConfig.get()
  const username = competitor.handle.replace(/^@/, '')
  const targetPosts = postLimit ?? 30
  let result: StandardCrawlerOutput

  try {
    result = await captureInstagramData(withCrawlerProfileDefaults({
      username,
      profile,
      chromePath: cfg.chromePath,
      maxResponses: targetPosts,
      timeoutMs: 90_000,
      reporter: silentReporter(),
    }, profile, cfg, dataDir))
  } catch (err) {
    return {
      capturedCount: 0,
      warnings: [],
      errors: [`${competitor.handle}: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  if (!result.ok) {
    return {
      capturedCount: 0,
      warnings: result.meta.warnings,
      errors: [`${competitor.handle}: ${result.error?.message ?? 'capture failed'}`],
    }
  }

  const now = Date.now()
  const posts: CapturedPost[] = uniqueCapturedPosts(result.output.posts
    .filter((post) => Boolean(post.postUrl))
    .slice(0, targetPosts)
    .map((post) => postDataToCapturedPost(competitor.id, username, post, now, competitor.projectId)))

  stack.capturedPosts.upsertMany(posts)
  const profileEntry =
    result.output.profiles.find((entry) => normalizeUsername(entry.username) === normalizeUsername(username)) ??
    result.output.profiles[0]
  const avgLikesEntry =
    result.meta.avgLikes?.perProfile.find((entry) => normalizeUsername(entry.username) === normalizeUsername(username)) ??
    result.meta.avgLikes?.perProfile[0]
  const avgLikesSummary =
    avgLikesEntry ?? calculateAvgLikesSummary(username, posts.map(capturedPostToPostData))

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
    capturedCount: posts.length,
    warnings: result.meta.warnings,
    errors: [],
  }
}

async function writeCronRunOutput(
  job: CronJob,
  stack: ConversationStack,
  output: CronRunOutput,
): Promise<void> {
  const workspaceRoot = stack.conversation.get(job.conversationId)?.workspacePath ?? process.cwd()
  const dir = join(workspaceRoot, '.anubis', 'tmp')
  const timestamp = output.ranAt.replace(/[:.]/g, '-')
  const path = join(dir, `cron-${job.id}-${timestamp}.json`)
  await mkdir(dir, { recursive: true })
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
}

function resolveDiscoverySource(query: string): { source: 'explore' | 'hashtag' | 'keyword'; hashtag?: string; keyword?: string } {
  const trimmed = query.trim()
  if (trimmed.toLowerCase() === 'explore') return { source: 'explore' }
  if (trimmed.startsWith('#')) return { source: 'hashtag', hashtag: trimmed.replace(/^#+/, '') }
  return { source: 'keyword', keyword: trimmed }
}

function normalizeUsername(raw: string | undefined): string {
  return raw?.trim().replace(/^@/, '').toLowerCase() ?? ''
}

function normalizeHandle(raw: string): string {
  const username = normalizeUsername(raw)
  return username ? `@${username}` : ''
}

function postDataToCapturedPost(
  competitorId: string,
  username: string,
  post: PostData,
  capturedAt: number,
  projectId?: string,
): CapturedPost {
  const kind = post.media?.kind
  const urls = post.media?.urls ?? []
  return {
    id: randomUUID(),
    competitorId,
    projectId,
    username: post.username ?? username,
    postUrl: post.postUrl,
    caption: post.caption,
    likes: post.likes,
    comments: post.comments,
    postedAt: post.timestamp,
    mediaKind: kind,
    mediaUrl: urls[0],
    carouselCount: kind === 'carousel' ? urls.length : undefined,
    capturedAt,
    raw: post as unknown as Record<string, unknown>,
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
