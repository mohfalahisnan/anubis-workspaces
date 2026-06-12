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
  method: 'simple_mean'
}

const DEFAULT_MIN_POSTS = 20

/**
 * Average likes = the plain mean of every captured post's like count (rounded).
 *
 * Earlier builds used a "dominant cluster" mean that tried to suppress viral
 * outliers, but it proved unintuitive and could land on an unrepresentative
 * band. A simple average is predictable and matches what "average likes" means
 * to a user. `baselineLikes` (computed separately, as a median) remains the
 * outlier-resistant figure.
 */
export function calculateAvgLikesSummary(username: string, posts: PostData[], minPosts = DEFAULT_MIN_POSTS): AvgLikesSummary | null {
  const likes = posts
    .map((post) => post.likes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right)

  if (likes.length === 0) return null

  return {
    username,
    avgLikes: Math.round(mean(likes)),
    avgLikesRangeLow: likes[0]!,
    avgLikesRangeHigh: likes[likes.length - 1]!,
    avgLikesSampleSize: likes.length,
    avgLikesCentralSampleSize: likes.length,
    avgLikesConfidence: likes.length >= normalizeMinPosts(minPosts) ? 'ok' : 'low_sample',
    method: 'simple_mean'
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeMinPosts(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : DEFAULT_MIN_POSTS
}
