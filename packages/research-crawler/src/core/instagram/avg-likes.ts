import type { PostData, ProfileData, StandardCrawlerOutput } from '../standard-output.js'

export type AvgLikesConfidence = 'ok' | 'low_sample'

export type AvgLikesSummary = {
  username: string
  avgLikes: number
  avgLikesRangeLow: number
  avgLikesRangeHigh: number
  avgLikesSampleSize: number
  avgLikesCentralSampleSize: number
  avgLikesConfidence: AvgLikesConfidence
  method: 'modal_cluster_mean'
}

export type AvgLikesOptions = {
  minPosts?: number
}

const DEFAULT_MIN_POSTS = 20
// Like counts within this ratio of their neighbour belong to the same cluster.
// A jump larger than this (e.g. a viral post) starts a new cluster.
const CLUSTER_RATIO = 2

export function applyAvgLikesToOutput(output: StandardCrawlerOutput, options: AvgLikesOptions = {}): StandardCrawlerOutput {
  const minPosts = normalizeMinPosts(options.minPosts)
  const postsByUsername = groupPostsByUsername(output.output.posts)
  const summaries: AvgLikesSummary[] = []
  const warnings = [...(output.meta.warnings ?? [])]

  const profiles = output.output.profiles.map((profile) => {
    const username = normalizeUsername(profile.username)
    const posts = postsByUsername.get(username) ?? []
    const summary = calculateAvgLikesSummary(profile.username, posts, minPosts)
    if (!summary) {
      warnings.push(`No post likes found for @${profile.username}; avgLikes was not set.`)
      return profile
    }

    summaries.push(summary)
    if (summary.avgLikesConfidence === 'low_sample') {
      warnings.push(`Only ${summary.avgLikesSampleSize} liked post(s) found for @${profile.username}; avgLikes prefers at least ${minPosts}.`)
    }

    return {
      ...profile,
      avgLikes: summary.avgLikes,
      avgLikesRangeLow: summary.avgLikesRangeLow,
      avgLikesRangeHigh: summary.avgLikesRangeHigh,
      avgLikesSampleSize: summary.avgLikesSampleSize,
      avgLikesMethod: summary.method,
      avgLikesConfidence: summary.avgLikesConfidence
    } satisfies ProfileData
  })

  return {
    ...output,
    output: {
      ...output.output,
      profiles
    },
    meta: {
      ...output.meta,
      warnings,
      avgLikes: {
        method: 'modal_cluster_mean',
        minPosts,
        perProfile: summaries
      }
    }
  }
}

export function calculateAvgLikesSummary(username: string, posts: PostData[], minPosts = DEFAULT_MIN_POSTS): AvgLikesSummary | null {
  const likes = posts
    .map((post) => post.likes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right)

  if (likes.length === 0) return null

  // Group the posts into clusters of similar engagement, then report the mean of
  // the largest cluster — i.e. the like count "most posts" land on — so a handful
  // of viral posts can't drag the figure up the way a plain average would.
  const dominant = dominantCluster(clusterByRatio(likes, CLUSTER_RATIO))

  return {
    username,
    avgLikes: Math.round(mean(dominant)),
    avgLikesRangeLow: dominant[0]!,
    avgLikesRangeHigh: dominant[dominant.length - 1]!,
    avgLikesSampleSize: likes.length,
    avgLikesCentralSampleSize: dominant.length,
    avgLikesConfidence: likes.length >= normalizeMinPosts(minPosts) ? 'ok' : 'low_sample',
    method: 'modal_cluster_mean'
  }
}

/** Splits ascending values into clusters, starting a new one on a jump larger than `ratio`x. */
function clusterByRatio(sortedValues: number[], ratio: number): number[][] {
  const clusters: number[][] = []
  let current: number[] = []
  let previous: number | undefined
  for (const value of sortedValues) {
    if (previous !== undefined && value > previous * ratio) {
      clusters.push(current)
      current = []
    }
    current.push(value)
    previous = value
  }
  if (current.length > 0) clusters.push(current)
  return clusters
}

/** Largest cluster wins; ties go to the lower-valued cluster (the more typical engagement). */
function dominantCluster(clusters: number[][]): number[] {
  let best = clusters[0]!
  for (const cluster of clusters.slice(1)) {
    if (cluster.length > best.length) best = cluster
  }
  return best
}

function groupPostsByUsername(posts: PostData[]): Map<string, PostData[]> {
  const grouped = new Map<string, PostData[]>()
  for (const post of posts) {
    const username = normalizeUsername(post.username ?? usernameFromProfileUrl(post.sourceProfileUrl) ?? '')
    if (!username) continue
    const existing = grouped.get(username) ?? []
    existing.push(post)
    grouped.set(username, existing)
  }
  return grouped
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

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeMinPosts(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : DEFAULT_MIN_POSTS
}
