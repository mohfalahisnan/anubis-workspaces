import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { extractInstagramShortcode, filterRecordsToShortcode } from './instagram/instagram-json-scanner.js'
import { silentReporter, type ProgressReporter } from './progress/progress-reporter.js'
import { createInstagramCdpCaptureService } from './services/instagram-cdp-capture.service.js'
import type { InstagramCompetitorCandidate } from './services/instagram-discovery-types.js'
import { createInstagramCompetitorDiscoveryService } from './services/instagram-competitor-discovery.service.js'
import {
  standardizeInstagramCaptureResult,
  standardizeInstagramDiscoveryResult,
  type StandardCrawlerOutput,
  type PostData
} from './standard-output.js'
import { launchChrome, killChrome } from './chrome/launch-chrome.js'
import { defaultPortFor, type ProfileName } from './chrome/profile-resolver.js'


export type CaptureInstagramInput = {
  username?: string
  url?: string
  chromeOrigin?: string
  remoteDebuggingPort?: number
  maxResponses?: number
  timeoutMs?: number
  includeRaw?: boolean
  reporter?: ProgressReporter
  openNewTab?: boolean
  scrollIntervalMs?: number
  initialDelayMs?: number
  profile?: ProfileName
  profileDir?: string
  /**
   * The --profile-directory subdir name to pass to Chrome. Use this
   * with profileDir set to the user-data root (the parent) so Chrome
   * loads the existing named profile (e.g. profileDir="C:/.../User Data",
   * profileDirectory="Profile 3") instead of treating profileDir as a
   * fresh user-data root.
   */
  profileDirectory?: string
  chromePath?: string
  headless?: boolean
  forceHeadless?: boolean
  keepChromeOpen?: boolean
  keepTabOpen?: boolean
  workspacePath?: string
}

export type DiscoverInstagramInput = {
  source?: 'explore' | 'hashtag' | 'keyword'
  hashtag?: string
  keyword?: string
  chromeOrigin?: string
  remoteDebuggingPort?: number
  targetCompetitors?: number
  timeoutMs?: number
  includeRaw?: boolean
  reporter?: ProgressReporter
  onCandidate?: (candidate: InstagramCompetitorCandidate) => void
  profile?: ProfileName
  profileDir?: string
  /** See CaptureInstagramInput.profileDirectory. */
  profileDirectory?: string
  chromePath?: string
  headless?: boolean
  forceHeadless?: boolean
  keepChromeOpen?: boolean
}

const DEFAULT_REMOTE_DEBUGGING_PORT = 9222
const DEFAULT_PUBLIC_REMOTE_DEBUGGING_PORT = 9223

export async function captureInstagramData(input: CaptureInstagramInput): Promise<StandardCrawlerOutput> {
  if (!input.username?.trim() && !input.url?.trim()) throw new Error('Pass username or url.')

  let port = input.remoteDebuggingPort
  if (!port && input.chromeOrigin) {
    try {
      const url = new URL(input.chromeOrigin.trim())
      const parsedPort = Number(url.port)
      if (parsedPort > 0) port = parsedPort
    } catch {}
  }
  const explicitProfile = input.profile
  const profile: ProfileName = explicitProfile ?? (port === DEFAULT_REMOTE_DEBUGGING_PORT ? 'login' : 'public')
  if (!port) port = explicitProfile ? defaultPortFor(explicitProfile) : DEFAULT_PUBLIC_REMOTE_DEBUGGING_PORT

  const launchResult = await launchChrome({
    remoteDebuggingPort: port,
    profile,
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    ...(input.profileDirectory ? { profileDirectory: input.profileDirectory } : {}),
    ...(input.chromePath ? { chromePath: input.chromePath } : {}),
    ...(typeof input.headless === 'boolean' ? { headless: input.headless } : {}),
    ...(input.forceHeadless ? { forceHeadless: true } : {})
  })

  const service = createInstagramCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()
  
  const targetPosts = normalizePositiveInteger(input.maxResponses, 30)
  const defaultTimeout = targetPosts > 12
    ? 10000 + Math.ceil((targetPosts - 12) / 12) * 8000
    : 10000

  const normalizedInput = {
    target: 'instagram' as const,
    mode: 'profile_capture' as const,
    ...(input.username?.trim() ? { username: normalizeInstagramUsername(input.username) } : {}),
    ...(input.url?.trim() ? { url: input.url.trim() } : {}),
    chromeOrigin,
    ...(input.remoteDebuggingPort ? { remoteDebuggingPort: normalizePositiveInteger(input.remoteDebuggingPort, DEFAULT_REMOTE_DEBUGGING_PORT) } : {}),
    maxResponses: targetPosts,
    ...(input.timeoutMs ? { timeoutMs: normalizePositiveInteger(input.timeoutMs, defaultTimeout) } : { timeoutMs: defaultTimeout }),
    ...(input.includeRaw ? { includeRaw: true } : {}),
    workspacePath: input.workspacePath
  }
  const result = await service.capture({
    ...(input.username?.trim() ? { username: normalizeInstagramUsername(input.username) } : {}),
    ...(input.url?.trim() ? { url: input.url.trim() } : {}),
    chromeOrigin,
    maxResponses: normalizedInput.maxResponses,
    ...(normalizedInput.timeoutMs ? { timeoutMs: normalizedInput.timeoutMs } : {}),
    ...(input.openNewTab ? { openNewTab: true } : {}),
    ...(input.keepTabOpen ? { keepTabOpen: true } : {}),
    ...(input.scrollIntervalMs ? { scrollIntervalMs: input.scrollIntervalMs } : {}),
    ...(input.initialDelayMs !== undefined ? { initialDelayMs: input.initialDelayMs } : {}),
    reporter
  })

  let targetUsername = input.username ? normalizeInstagramUsername(input.username).toLowerCase() : undefined
  if (!targetUsername && input.url) {
    try {
      const parsedUrl = new URL(input.url.trim())
      const parts = parsedUrl.pathname.split('/').filter(Boolean)
      const firstPart = parts[0]
      if (firstPart && firstPart !== 'p' && firstPart !== 'reel') {
        targetUsername = firstPart.toLowerCase()
      }
    } catch {}
  }

  const targetShortcode = input.url ? extractInstagramShortcode(input.url.trim()) : undefined

  if (result.ok && targetShortcode) {
    const filtered = filterRecordsToShortcode(result, targetShortcode)
    result.profiles = filtered.profiles
    result.media = filtered.media
  } else if (result.ok && targetUsername) {
    result.profiles = result.profiles.filter((p) => p.username.toLowerCase() === targetUsername)
    result.media = result.media.filter((m) => m.username.toLowerCase() === targetUsername)
  }

  const output = standardizeInstagramCaptureResult(normalizedInput, result)

  if (input.workspacePath && output.ok) {
    for (const post of output.output.posts) {
      const dl = await downloadPostAssets(post, input.workspacePath)
      post.assetPaths = dl.assetPaths
      post.failedAssets = dl.failedAssets
    }
  }

  if (!launchResult.reused && !input.keepChromeOpen) await killChrome(port)
  return output
}

export async function discoverInstagramCompetitors(input: DiscoverInstagramInput = {}): Promise<StandardCrawlerOutput> {
  const source: NonNullable<DiscoverInstagramInput['source']> = input.source === 'hashtag' ? 'hashtag' : input.source === 'keyword' ? 'keyword' : 'explore'
  const hashtag = normalizeHashtag(input.hashtag ?? '')
  if (source === 'hashtag' && !hashtag) throw new Error('Pass hashtag when source is hashtag.')

  const keyword = input.keyword?.trim() ?? ''
  if (source === 'keyword' && !keyword) throw new Error('Pass keyword when source is keyword.')

  let port = input.remoteDebuggingPort
  if (!port && input.chromeOrigin) {
    try {
      const url = new URL(input.chromeOrigin.trim())
      const parsedPort = Number(url.port)
      if (parsedPort > 0) port = parsedPort
    } catch {}
  }
  const explicitProfile = input.profile
  const profile: ProfileName = explicitProfile ?? (port === DEFAULT_REMOTE_DEBUGGING_PORT ? 'login' : 'public')
  if (!port) port = explicitProfile ? defaultPortFor(explicitProfile) : DEFAULT_REMOTE_DEBUGGING_PORT

  const launchResult = await launchChrome({
    remoteDebuggingPort: port,
    profile,
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    ...(input.profileDirectory ? { profileDirectory: input.profileDirectory } : {}),
    ...(input.chromePath ? { chromePath: input.chromePath } : {}),
    ...(typeof input.headless === 'boolean' ? { headless: input.headless } : {}),
    ...(input.forceHeadless ? { forceHeadless: true } : {})
  })

  const service = createInstagramCompetitorDiscoveryService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()
  const normalizedInput = {
    target: 'instagram' as const,
    mode: 'competitor_discovery' as const,
    source,
    ...(source === 'hashtag' ? { hashtag } : {}),
    ...(source === 'keyword' ? { keyword } : {}),
    chromeOrigin,
    ...(input.remoteDebuggingPort ? { remoteDebuggingPort: normalizePositiveInteger(input.remoteDebuggingPort, DEFAULT_REMOTE_DEBUGGING_PORT) } : {}),
    targetCompetitors: normalizePositiveInteger(input.targetCompetitors, 20),
    ...(input.timeoutMs ? { timeoutMs: normalizePositiveInteger(input.timeoutMs, 30000) } : {}),
    ...(input.includeRaw ? { includeRaw: true } : {})
  }
  const output = await service.discover({
    source,
    ...(source === 'hashtag' ? { hashtag } : {}),
    ...(source === 'keyword' ? { keyword } : {}),
    targetCompetitors: normalizedInput.targetCompetitors,
    chromeOrigin,
    ...(input.timeoutMs ? { timeoutMs: normalizePositiveInteger(input.timeoutMs, 30000) } : {}),
    reporter,
    ...(input.onCandidate ? { onCandidate: input.onCandidate } : {})
  })
  const standardized = standardizeInstagramDiscoveryResult(normalizedInput, output)
  if (!launchResult.reused && !input.keepChromeOpen) await killChrome(port)
  return standardized
}

function getChromeOrigin(input: { chromeOrigin?: string; remoteDebuggingPort?: number }, defaultPort: number): string {
  if (input.chromeOrigin?.trim()) return input.chromeOrigin.trim()
  return `http://127.0.0.1:${normalizePositiveInteger(input.remoteDebuggingPort, defaultPort)}`
}

export function normalizeInstagramUsername(value: string): string {
  return value.trim().replace(/^@/, '')
}

function normalizeHashtag(value: string): string {
  return value.trim().replace(/^#/, '')
}

export function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback
}

async function downloadPostAssets(
  post: PostData,
  workspacePath: string
): Promise<{ assetPaths: { absolute: string[]; relative: string[] }; failedAssets: string[] }> {
  const handle = (post.username || 'unknown').trim().replace(/^@/, '').toLowerCase()
  const shortcode = extractInstagramShortcode(post.postUrl) || 'unknown'
  const targetDir = join(workspacePath, 'instagram', handle, shortcode)

  await mkdir(targetDir, { recursive: true })

  const downloads: Array<{ url: string; filename: string }> = []
  if (post.media) {
    if (post.media.kind === 'video') {
      if (post.media.urls && post.media.urls[0]) {
        downloads.push({ url: post.media.urls[0], filename: '0.jpg' })
      }
      if (post.media.videoUrl) {
        downloads.push({ url: post.media.videoUrl, filename: 'video.mp4' })
      }
    } else if (post.media.kind === 'carousel') {
      if (post.media.urls) {
        for (let i = 0; i < post.media.urls.length; i++) {
          downloads.push({ url: post.media.urls[i]!, filename: `${i}.jpg` })
        }
      }
      if (post.media.videoUrl) {
        downloads.push({ url: post.media.videoUrl, filename: 'video.mp4' })
      }
    } else if (post.media.kind === 'image') {
      if (post.media.urls && post.media.urls[0]) {
        downloads.push({ url: post.media.urls[0], filename: '0.jpg' })
      }
    }
  }

  const absolutePaths: string[] = []
  const relativePaths: string[] = []
  const failedAssets: string[] = []

  for (const dl of downloads) {
    const filePath = join(targetDir, dl.filename)
    const relativePath = join('instagram', handle, shortcode, dl.filename).replace(/\\/g, '/')

    if (existsSync(filePath)) {
      absolutePaths.push(resolve(filePath).replace(/\\/g, '/'))
      relativePaths.push(relativePath)
      continue
    }

    try {
      const res = await fetch(dl.url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      await writeFile(filePath, buffer)
      absolutePaths.push(resolve(filePath).replace(/\\/g, '/'))
      relativePaths.push(relativePath)
    } catch (err) {
      console.error(`[Instagram Crawler] Failed to download asset ${dl.url} to ${filePath}:`, err)
      failedAssets.push(dl.url)
    }
  }

  // Write meta.json
  const metaPath = join(targetDir, 'meta.json')
  const metaData = {
    shortcode,
    caption: post.caption,
    likes: post.likes,
    timestamp: post.timestamp,
    mediaType: post.media?.kind,
    assetPaths: relativePaths,
    failedAssets,
  }

  try {
    await writeFile(metaPath, JSON.stringify(metaData, null, 2), 'utf8')
  } catch (err) {
    console.error(`[Instagram Crawler] Failed to write meta.json to ${metaPath}:`, err)
  }

  return {
    assetPaths: {
      absolute: absolutePaths,
      relative: relativePaths,
    },
    failedAssets,
  }
}
