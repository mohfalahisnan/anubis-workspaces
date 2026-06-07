import type { PostData } from '../standard-output.js'

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

const DEFAULT_MIN_POSTS = 20
// Like counts within this ratio of their neighbour belong to the same cluster.
// A jump larger than this (e.g. a viral post) starts a new cluster.
const CLUSTER_RATIO = 2
const GAP_SPLIT_MULTIPLIER = 3

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
  const typicalGap = median(
    sortedValues
      .slice(1)
      .map((value, index) => value - sortedValues[index]!)
      .filter((gap) => gap > 0),
  )
  for (const value of sortedValues) {
    const gap = previous === undefined ? 0 : value - previous
    const isRatioJump = previous !== undefined && previous > 0 && value > previous * ratio
    const isDensityJump =
      previous !== undefined &&
      typicalGap !== undefined &&
      gap > typicalGap * GAP_SPLIT_MULTIPLIER
    if (isRatioJump || isDensityJump) {
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

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

function normalizeMinPosts(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : DEFAULT_MIN_POSTS
}
