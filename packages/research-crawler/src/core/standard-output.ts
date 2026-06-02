import type { InstagramCompetitorCandidate, InstagramCompetitorDiscoveryResult } from './services/instagram-competitor-discovery.service.js'
import type { InstagramCdpCaptureResult } from './services/instagram-cdp-capture.service.js'

export type StandardCrawlerInput = {
  target: 'instagram'
  mode: 'profile_capture' | 'competitor_discovery' | 'avg_likes_setup'
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
}

export type StandardCrawlerOutputType = 'Profile Data List' | 'Post Data List'

export type StandardCrawlerOutput = {
  ok: boolean
  schemaVersion: '1.0'
  outputTypes: StandardCrawlerOutputType[]
  input: StandardCrawlerInput
  output: {
    profiles: ProfileData[]
    posts: PostData[]
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
  }
  error?: {
    code: string
    message: string
  }
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
      postCount: posts.length
    })
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

function stripEmpty<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as T
}
