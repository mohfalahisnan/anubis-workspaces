import {
  scanResponsesToStandardOutput,
  scanResponsesToCandidates,
  type ProfileData,
  type PostData,
  type DiscoveredCandidate,
} from './parsers.js'
import type { InstagramRawJsonResponse } from './ig-scanner.js'

interface ExecMessage {
  type: 'execute'
  jobId: string
  kind: 'capture-profile' | 'discover'
  input: {
    username?: string
    maxResponses?: number
    source?: 'explore' | 'hashtag' | 'keyword'
    hashtag?: string
    keyword?: string
    targetCompetitors?: number
  }
}

/* The content script is injected on every IG page (per manifest
   content_scripts). On load we announce readiness to the background
   service worker, which then sends an `execute` with the job
   details. We perform same-origin fetches against IG's web/REST
   endpoints; cookies + CSRF tokens + auth headers carry
   automatically because we're inside instagram.com.

   Anti-bot heuristic: a small jitter between sequential fetches.
*/

function whenReady(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }))
}

void whenReady().then(() => {
  chrome.runtime.sendMessage({ type: 'ready' })
})

chrome.runtime.onMessage.addListener((msg: ExecMessage, _sender, sendResponse) => {
  if (msg?.type !== 'execute') return
  void run(msg).catch((e) => {
    chrome.runtime.sendMessage({
      type: 'error',
      jobId: msg.jobId,
      code: 'CONTENT_THROW',
      message: e instanceof Error ? e.message : 'unknown content-script error',
    })
  })
  sendResponse({ ok: true })
  return true
})

async function run(msg: ExecMessage): Promise<void> {
  if (msg.kind === 'capture-profile') {
    await runCaptureProfile(msg)
  } else if (msg.kind === 'discover') {
    await runDiscover(msg)
  } else {
    throw new Error(`unknown job kind: ${(msg as { kind?: string }).kind}`)
  }
}

async function runCaptureProfile(msg: ExecMessage): Promise<void> {
  const username = msg.input.username?.trim()
  if (!username) throw new Error('username required for capture-profile')
  const maxResponses = msg.input.maxResponses ?? 30

  const profilePath = `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  const profileResp = await sameOriginJson(profilePath)
  const userId = extractUserId(profileResp.body)

  const responses: InstagramRawJsonResponse[] = [profileResp]
  if (userId) {
    await jitter()
    const feedPath = `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${maxResponses}`
    responses.push(await sameOriginJson(feedPath))
  }

  const data = scanResponsesToStandardOutput(responses) as { profiles: ProfileData[]; posts: PostData[] }
  chrome.runtime.sendMessage({ type: 'result', jobId: msg.jobId, data })
}

async function runDiscover(msg: ExecMessage): Promise<void> {
  const target = msg.input.targetCompetitors ?? 10
  const source = msg.input.source ?? 'explore'
  let responses: InstagramRawJsonResponse[] = []

  if (source === 'keyword') {
    const keyword = msg.input.keyword?.trim()
    if (!keyword) throw new Error('keyword required for discover (source=keyword)')
    const path = `/web/search/topsearch/?query=${encodeURIComponent(keyword)}`
    responses.push(await sameOriginJson(path))
  } else if (source === 'hashtag') {
    const tag = msg.input.hashtag?.trim().replace(/^#/, '')
    if (!tag) throw new Error('hashtag required for discover (source=hashtag)')
    const path = `/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`
    responses.push(await sameOriginJson(path))
  } else {
    // explore
    const path = `/api/v1/discover/web/explore_grid/?is_prefetch=false&omit_cover_media=true`
    responses.push(await sameOriginJson(path))
  }

  const candidates: DiscoveredCandidate[] = scanResponsesToCandidates(responses, target)
  chrome.runtime.sendMessage({
    type: 'result',
    jobId: msg.jobId,
    data: { profiles: candidates.map((c) => ({
      platform: 'instagram' as const,
      username: c.username,
      profileUrl: c.profileUrl ?? `https://www.instagram.com/${c.username}/`,
      fullName: c.fullName,
      bio: c.bio,
      followers: c.followers,
      profileImageUrl: c.profileImageUrl,
    })), posts: [] },
  })
}

async function sameOriginJson(path: string): Promise<InstagramRawJsonResponse> {
  const url = path.startsWith('http') ? path : `https://www.instagram.com${path}`
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      // Stable Web client app id IG has used for years.
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`IG returned ${res.status} for ${path}`)
  const body = await res.json()
  return { responseUrl: url, body }
}

function extractUserId(profileJson: unknown): string | null {
  const j = profileJson as { data?: { user?: { id?: string; pk?: string } } }
  return j.data?.user?.id ?? j.data?.user?.pk ?? null
}

function jitter(): Promise<void> {
  const ms = 800 + Math.random() * 700
  return new Promise((r) => setTimeout(r, ms))
}
