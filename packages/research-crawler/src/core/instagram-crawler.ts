import { extractInstagramShortcode, filterRecordsToShortcode } from './instagram/instagram-json-scanner.js'
import { silentReporter, type ProgressReporter } from './progress/progress-reporter.js'
import { createInstagramCdpCaptureService } from './services/instagram-cdp-capture.service.js'
import type { InstagramCompetitorCandidate } from './services/instagram-discovery-types.js'
import { createInstagramCompetitorDiscoveryService } from './services/instagram-competitor-discovery.service.js'
import {
  standardizeInstagramCaptureResult,
  standardizeInstagramDiscoveryResult,
  type StandardCrawlerOutput
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
    ...(input.includeRaw ? { includeRaw: true } : {})
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
      if (parts.length > 0 && parts[0] !== 'p' && parts[0] !== 'reel') {
        targetUsername = parts[0].toLowerCase()
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
