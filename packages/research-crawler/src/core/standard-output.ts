import type { InstagramCompetitorCandidate, InstagramCompetitorDiscoveryResult } from './services/instagram-competitor-discovery.service.js'
import type { InstagramCdpCaptureResult } from './services/instagram-cdp-capture.service.js'
import { calculateAvgLikesSummary } from './instagram/avg-likes.js'

export type StandardCrawlerInput = {
  target: 'instagram' | 'chatgpt' | 'qwen'
  mode: 'profile_capture' | 'competitor_discovery' | 'avg_likes_setup' | 'conversation_list' | 'conversation_details' | 'send_prompt'
  username?: string
  url?: string
  source?: 'explore' | 'hashtag' | 'keyword'
  hashtag?: string
  keyword?: string
  chromeOrigin?: string
  remoteDebuggingPort?: number
  maxResponses?: number
  targetCompetitors?: number
  postsPerProfile?: number
  minPosts?: number
  captureConcurrency?: number
  timeoutMs?: number
  includeRaw?: boolean
  conversationId?: string
  prompt?: string
  workspacePath?: string
}

export type ProfileData = {
  platform: 'instagram'
  username: string
  profileUrl: string
  fullName?: string
  bio?: string
  profileImageUrl?: string
  followers?: number
  following?: number
  postCount?: number
  isVerified?: boolean
  isPrivate?: boolean
  category?: string
  externalUrl?: string
  sourcePostUrl?: string
  avgLikes?: number
  avgLikesRangeLow?: number
  avgLikesRangeHigh?: number
  avgLikesSampleSize?: number
  avgLikesMethod?: 'modal_cluster_mean'
  avgLikesConfidence?: 'ok' | 'low_sample'
  collectedAt?: string
  sourceResponseUrl?: string
}

export type PostMedia = {
  kind: 'image' | 'video' | 'carousel'
  urls: string[]
  videoUrl?: string
}

export type PostData = {
  platform: 'instagram'
  postUrl: string
  username?: string
  likes?: number
  comments?: number
  timestamp?: string
  caption?: string
  media?: PostMedia
  sourceProfileUrl?: string
  status?: 'profile_found' | 'profile_not_found'
  assetPaths?: {
    absolute: string[]
    relative: string[]
  }
  failedAssets?: string[]
}

export type ChatGPTConversation = {
  id: string
  title: string
  createTime: string
  updateTime: string
}

export type ChatGPTMessage = {
  id: string
  role: string
  content: string
  createTime: string
}

/** Qwen output reuses the same conversation/message shapes as ChatGPT. */
export type QwenConversation = ChatGPTConversation
export type QwenMessage = ChatGPTMessage

export type StandardCrawlerOutputType =
  | 'Profile Data List'
  | 'Post Data List'
  | 'ChatGPT Conversation List'
  | 'ChatGPT Message List'
  | 'Qwen Conversation List'
  | 'Qwen Message List'

export type StandardCrawlerOutput = {
  ok: boolean
  schemaVersion: '1.0'
  outputTypes: StandardCrawlerOutputType[]
  input: StandardCrawlerInput
  output: {
    profiles: ProfileData[]
    posts: PostData[]
    conversations?: ChatGPTConversation[]
    chatMessages?: ChatGPTMessage[]
  }
  meta: {
    profileCount: number
    postCount: number
    startedAt?: string
    finishedAt?: string
    sourceUrl?: string
    warnings: string[]
    raw?: unknown
    discover?: {
      stopReason?: string
      rawItemCount?: number
      candidateCount?: number
      startedAt?: string
      finishedAt?: string
    }
    capture?: {
      perProfile: Array<{
        username: string
        postCount: number
        profileCount?: number
        ms: number
        stopReason?: string
        error?: { code: string; message: string }
      }>
      startedAt?: string
      finishedAt?: string
    }
    avgLikes?: {
      method: 'modal_cluster_mean'
      minPosts: number
      perProfile: Array<{
        username: string
        avgLikes: number
        avgLikesRangeLow: number
        avgLikesRangeHigh: number
        avgLikesSampleSize: number
        avgLikesCentralSampleSize: number
        avgLikesConfidence: 'ok' | 'low_sample'
        method: 'modal_cluster_mean'
      }>
    }
    loginAuthenticated?: boolean
    debug?: CdpDebugInfo
  }
  error?: {
    code: string
    message: string
  }
}

/** CDP capture diagnostics surfaced to the playground for debugging. */
export type CdpDebugInfo = {
  events: string[]
  responses: Array<{
    url: string
    status?: number
    contentType?: string
    matched: boolean
    bodySize?: number
    bodyOk?: boolean
  }>
}

export function standardizeInstagramCaptureResult(
  input: StandardCrawlerInput,
  result: InstagramCdpCaptureResult
): StandardCrawlerOutput {
  if (!result.ok) return failureOutput(input, result.error.code, result.error.message, input.includeRaw ? result : undefined)

  const profiles = result.profiles.map((profile) => stripEmpty({
    platform: 'instagram' as const,
    username: profile.username,
    profileUrl: profile.profileUrl,
    fullName: profile.fullName,
    bio: profile.bio,
    profileImageUrl: profile.profileImageUrl,
    followers: profile.followers,
    following: profile.following,
    postCount: profile.postCount,
    isVerified: profile.isVerified,
    isPrivate: profile.isPrivate,
    category: profile.category,
    externalUrl: profile.externalUrl,
    collectedAt: profile.collectedAt,
    sourceResponseUrl: profile.sourceResponseUrl
  }))
  const posts = result.media.map((post) => stripEmpty({
    platform: 'instagram' as const,
    postUrl: post.postUrl,
    username: post.username,
    likes: post.likes,
    comments: post.comment,
    timestamp: post.timestamp,
    caption: post.caption,
    media: post.media,
    sourceProfileUrl: post.username ? `https://www.instagram.com/${post.username}/` : undefined
  }))

  return successOutput(input, profiles, posts, {
    startedAt: result.meta.startedAt,
    finishedAt: result.meta.completedAt,
    sourceUrl: result.meta.tabUrl,
    warnings: profiles.length === 0 && posts.length === 0 ? ['No profile or post data was found in captured network responses.'] : [],
    raw: input.includeRaw ? result : undefined
  })
}

export function standardizeInstagramDiscoveryResult(
  input: StandardCrawlerInput,
  result: InstagramCompetitorDiscoveryResult
): StandardCrawlerOutput {
  if (!result.ok) return failureOutput(input, result.error.code, result.error.message, input.includeRaw ? result : undefined)

  const profiles = result.candidates.map((candidate) => candidateToProfile(candidate))
  const posts = [
    ...result.posts.map((post) => {
      const candidate = result.candidates.find((item) => normalizeUrl(item.sourcePostUrl) === normalizeUrl(post.postUrl))
      return stripEmpty({
        platform: 'instagram' as const,
        postUrl: post.postUrl,
        username: candidate?.username,
        timestamp: post.postDate,
        sourceProfileUrl: candidate?.profileUrl,
        status: candidate ? 'profile_found' as const : undefined
      })
    }),
    ...result.postOnly
      .filter((postOnly) => !result.posts.some((post) => normalizeUrl(post.postUrl) === normalizeUrl(postOnly.postUrl)))
      .map((postOnly) => stripEmpty({
        platform: 'instagram' as const,
        postUrl: postOnly.postUrl,
        timestamp: postOnly.postDate,
        status: postOnly.status
      }))
  ]

  return successOutput(input, profiles, posts, {
    startedAt: result.meta.startedAt,
    finishedAt: result.meta.finishedAt,
    sourceUrl: result.meta.sourceUrl,
    warnings: [
      ...(profiles.length === 0 ? ['No competitor profiles were found.'] : []),
      ...(result.postOnly.length > 0 ? [`${result.postOnly.length} post(s) did not expose profile data.`] : [])
    ],
    raw: input.includeRaw ? result : undefined
  })
}

function candidateToProfile(candidate: InstagramCompetitorCandidate): ProfileData {
  return stripEmpty({
    platform: 'instagram' as const,
    username: candidate.username,
    profileUrl: candidate.profileUrl,
    bio: candidate.bio,
    profileImageUrl: candidate.avatar,
    followers: candidate.followers,
    following: candidate.following,
    sourcePostUrl: candidate.sourcePostUrl,
    collectedAt: candidate.postDate
  })
}

function successOutput(
  input: StandardCrawlerInput,
  profiles: ProfileData[],
  posts: PostData[],
  meta: Omit<StandardCrawlerOutput['meta'], 'profileCount' | 'postCount'>
): StandardCrawlerOutput {
  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: getOutputTypes(profiles, posts),
    input,
    output: {
      profiles,
      posts
    },
    meta: stripEmpty({
      ...meta,
      profileCount: profiles.length,
      postCount: posts.length,
      avgLikes: buildAvgLikesMeta(input, profiles, posts)
    })
  }
}

function buildAvgLikesMeta(
  input: StandardCrawlerInput,
  profiles: ProfileData[],
  posts: PostData[],
): StandardCrawlerOutput['meta']['avgLikes'] | undefined {
  const minPosts = normalizePositiveInteger(input.minPosts, 20)
  const usernames = new Set<string>()
  if (input.username) usernames.add(normalizeUsername(input.username))
  for (const profile of profiles) usernames.add(normalizeUsername(profile.username))
  for (const post of posts) {
    const username = normalizeUsername(post.username ?? usernameFromProfileUrl(post.sourceProfileUrl) ?? '')
    if (username) usernames.add(username)
  }

  const perProfile = [...usernames]
    .map((username) => {
      const profilePosts = posts.filter((post) => {
        const postUsername = normalizeUsername(post.username ?? usernameFromProfileUrl(post.sourceProfileUrl) ?? '')
        return postUsername === username
      })
      return calculateAvgLikesSummary(username, profilePosts, minPosts)
    })
    .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))

  if (perProfile.length === 0) return undefined
  return {
    method: 'modal_cluster_mean',
    minPosts,
    perProfile,
  }
}

function failureOutput(input: StandardCrawlerInput, code: string, message: string, raw?: unknown): StandardCrawlerOutput {
  return {
    ok: false,
    schemaVersion: '1.0',
    outputTypes: ['Profile Data List', 'Post Data List'],
    input,
    output: {
      profiles: [],
      posts: []
    },
    meta: stripEmpty({
      profileCount: 0,
      postCount: 0,
      warnings: [message],
      raw
    }),
    error: {
      code,
      message
    }
  }
}

function getOutputTypes(profiles: ProfileData[], posts: PostData[]): StandardCrawlerOutputType[] {
  const outputTypes: StandardCrawlerOutputType[] = []
  if (profiles.length > 0) outputTypes.push('Profile Data List')
  if (posts.length > 0) outputTypes.push('Post Data List')
  return outputTypes.length > 0 ? outputTypes : ['Profile Data List', 'Post Data List']
}

function normalizeUrl(value: string | undefined): string {
  return value?.replace(/\/+$/, '') ?? ''
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase()
}

function usernameFromProfileUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.pathname.split('/').filter(Boolean)[0]
  } catch {
    return undefined
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback
}

function stripEmpty<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as T
}

export function standardizeChatGPTResult(
  input: StandardCrawlerInput,
  result: {
    ok: boolean;
    conversations?: Array<{
      id: string;
      title: string;
      createTime: any;
      updateTime: any;
    }>;
    error?: {
      code: string;
      message: string;
    };
    debug?: CdpDebugInfo;
    meta?: {
      startedAt: string;
      completedAt: string;
      tabUrl: string;
    };
  }
): StandardCrawlerOutput {
  if (!result.ok || !result.conversations || !result.meta) {
    return {
      ok: false,
      schemaVersion: '1.0',
      outputTypes: ['ChatGPT Conversation List'],
      input,
      output: {
        profiles: [],
        posts: [],
        conversations: []
      },
      meta: {
        profileCount: 0,
        postCount: 0,
        warnings: [result.error?.message ?? 'ChatGPT crawler failed.'],
        debug: result.debug,
        raw: input.includeRaw ? result : undefined
      },
      error: {
        code: result.error?.code ?? 'CHATGPT_CAPTURE_FAILED',
        message: result.error?.message ?? 'ChatGPT crawler failed.'
      }
    }
  }

  const conversations = result.conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createTime: parseSafeDate(c.createTime),
    updateTime: parseSafeDate(c.updateTime)
  }))

  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['ChatGPT Conversation List'],
    input,
    output: {
      profiles: [],
      posts: [],
      conversations
    },
    meta: {
      profileCount: 0,
      postCount: 0,
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.completedAt,
      sourceUrl: result.meta.tabUrl,
      warnings: conversations.length === 0 ? ['No conversation history found.'] : [],
      debug: result.debug,
      raw: input.includeRaw ? result : undefined
    }
  }
}

export function standardizeChatGPTDetailsResult(
  input: StandardCrawlerInput,
  result: {
    ok: boolean;
    messages?: ChatGPTMessage[];
    error?: { code: string; message: string };
    debug?: CdpDebugInfo;
    meta?: { startedAt: string; completedAt: string; tabUrl: string };
  }
): StandardCrawlerOutput {
  if (!result.ok || !result.messages || !result.meta) {
    return {
      ok: false,
      schemaVersion: '1.0',
      outputTypes: ['ChatGPT Message List'],
      input,
      output: { profiles: [], posts: [], conversations: [], chatMessages: [] },
      meta: {
        profileCount: 0,
        postCount: 0,
        warnings: [result.error?.message ?? 'ChatGPT details capture failed.'],
        debug: result.debug,
        raw: input.includeRaw ? result : undefined
      },
      error: {
        code: result.error?.code ?? 'CHATGPT_CAPTURE_FAILED',
        message: result.error?.message ?? 'ChatGPT details capture failed.'
      }
    }
  }
  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['ChatGPT Message List'],
    input,
    output: {
      profiles: [],
      posts: [],
      chatMessages: result.messages
    },
    meta: {
      profileCount: 0,
      postCount: 0,
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.completedAt,
      sourceUrl: result.meta.tabUrl,
      warnings: [],
      debug: result.debug,
      raw: input.includeRaw ? result : undefined
    }
  }
}

export function standardizeChatGPTPromptResult(
  input: StandardCrawlerInput,
  result: {
    ok: boolean;
    conversationId?: string;
    messages?: ChatGPTMessage[];
    error?: { code: string; message: string };
    debug?: CdpDebugInfo;
    meta?: { startedAt: string; completedAt: string; tabUrl: string };
  }
): StandardCrawlerOutput {
  if (!result.ok || !result.messages || !result.meta) {
    return {
      ok: false,
      schemaVersion: '1.0',
      outputTypes: ['ChatGPT Message List'],
      input,
      output: { profiles: [], posts: [], conversations: [], chatMessages: [] },
      meta: {
        profileCount: 0,
        postCount: 0,
        warnings: [result.error?.message ?? 'ChatGPT prompt submission failed.'],
        debug: result.debug,
        raw: input.includeRaw ? result : undefined
      },
      error: {
        code: result.error?.code ?? 'CHATGPT_PROMPT_FAILED',
        message: result.error?.message ?? 'ChatGPT prompt submission failed.'
      }
    }
  }
  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['ChatGPT Message List'],
    input: {
      ...input,
      conversationId: result.conversationId ?? input.conversationId
    },
    output: {
      profiles: [],
      posts: [],
      chatMessages: result.messages
    },
    meta: {
      profileCount: 0,
      postCount: 0,
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.completedAt,
      sourceUrl: result.meta.tabUrl,
      warnings: [],
      debug: result.debug,
      raw: input.includeRaw ? result : undefined
    }
  }
}

export function standardizeQwenResult(
  input: StandardCrawlerInput,
  result: {
    ok: boolean;
    conversations?: Array<{ id: string; title: string; createTime: any; updateTime: any }>;
    error?: { code: string; message: string };
    debug?: CdpDebugInfo;
    meta?: { startedAt: string; completedAt: string; tabUrl: string };
  }
): StandardCrawlerOutput {
  if (!result.ok || !result.conversations || !result.meta) {
    return {
      ok: false,
      schemaVersion: '1.0',
      outputTypes: ['Qwen Conversation List'],
      input,
      output: { profiles: [], posts: [], conversations: [] },
      meta: {
        profileCount: 0,
        postCount: 0,
        warnings: [result.error?.message ?? 'Qwen crawler failed.'],
        debug: result.debug,
        raw: input.includeRaw ? result : undefined
      },
      error: {
        code: result.error?.code ?? 'QWEN_CAPTURE_FAILED',
        message: result.error?.message ?? 'Qwen crawler failed.'
      }
    }
  }

  const conversations = result.conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createTime: parseSafeDate(c.createTime),
    updateTime: parseSafeDate(c.updateTime)
  }))

  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['Qwen Conversation List'],
    input,
    output: { profiles: [], posts: [], conversations },
    meta: {
      profileCount: 0,
      postCount: 0,
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.completedAt,
      sourceUrl: result.meta.tabUrl,
      warnings: conversations.length === 0 ? ['No conversation history found.'] : [],
      debug: result.debug,
      raw: input.includeRaw ? result : undefined
    }
  }
}

export function standardizeQwenDetailsResult(
  input: StandardCrawlerInput,
  result: {
    ok: boolean;
    messages?: ChatGPTMessage[];
    error?: { code: string; message: string };
    debug?: CdpDebugInfo;
    meta?: { startedAt: string; completedAt: string; tabUrl: string };
  }
): StandardCrawlerOutput {
  if (!result.ok || !result.messages || !result.meta) {
    return {
      ok: false,
      schemaVersion: '1.0',
      outputTypes: ['Qwen Message List'],
      input,
      output: { profiles: [], posts: [], conversations: [], chatMessages: [] },
      meta: {
        profileCount: 0,
        postCount: 0,
        warnings: [result.error?.message ?? 'Qwen details capture failed.'],
        debug: result.debug,
        raw: input.includeRaw ? result : undefined
      },
      error: {
        code: result.error?.code ?? 'QWEN_CAPTURE_FAILED',
        message: result.error?.message ?? 'Qwen details capture failed.'
      }
    }
  }
  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['Qwen Message List'],
    input,
    output: { profiles: [], posts: [], chatMessages: result.messages },
    meta: {
      profileCount: 0,
      postCount: 0,
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.completedAt,
      sourceUrl: result.meta.tabUrl,
      warnings: [],
      debug: result.debug,
      raw: input.includeRaw ? result : undefined
    }
  }
}

export function standardizeQwenPromptResult(
  input: StandardCrawlerInput,
  result: {
    ok: boolean;
    conversationId?: string;
    messages?: ChatGPTMessage[];
    error?: { code: string; message: string };
    debug?: CdpDebugInfo;
    meta?: { startedAt: string; completedAt: string; tabUrl: string };
  }
): StandardCrawlerOutput {
  if (!result.ok || !result.messages || !result.meta) {
    return {
      ok: false,
      schemaVersion: '1.0',
      outputTypes: ['Qwen Message List'],
      input,
      output: { profiles: [], posts: [], conversations: [], chatMessages: [] },
      meta: {
        profileCount: 0,
        postCount: 0,
        warnings: [result.error?.message ?? 'Qwen prompt submission failed.'],
        debug: result.debug,
        raw: input.includeRaw ? result : undefined
      },
      error: {
        code: result.error?.code ?? 'QWEN_PROMPT_FAILED',
        message: result.error?.message ?? 'Qwen prompt submission failed.'
      }
    }
  }
  return {
    ok: true,
    schemaVersion: '1.0',
    outputTypes: ['Qwen Message List'],
    input: { ...input, conversationId: result.conversationId ?? input.conversationId },
    output: { profiles: [], posts: [], chatMessages: result.messages },
    meta: {
      profileCount: 0,
      postCount: 0,
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.completedAt,
      sourceUrl: result.meta.tabUrl,
      warnings: [],
      debug: result.debug,
      raw: input.includeRaw ? result : undefined
    }
  }
}

function parseSafeDate(val: any): string {
  if (!val) return new Date().toISOString()

  // If it's a number (timestamp in seconds or ms)
  if (typeof val === 'number') {
    const isSeconds = val < 10000000000
    const date = new Date(isSeconds ? val * 1000 : val)
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  }

  // If it's a string
  if (typeof val === 'string') {
    // Check if it's a numeric string
    const num = Number(val)
    if (!isNaN(num)) {
      const isSeconds = num < 10000000000
      const date = new Date(isSeconds ? num * 1000 : num)
      return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
    }
    // Try to parse directly
    const date = new Date(val)
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  }

  return new Date().toISOString()
}
