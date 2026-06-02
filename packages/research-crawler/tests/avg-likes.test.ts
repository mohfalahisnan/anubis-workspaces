import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateAvgLikesSummary } from '../src/core/instagram/avg-likes.js'
import type { PostData } from '../src/core/standard-output.js'

function posts(likesList: number[]): PostData[] {
  return likesList.map((likes, index) => ({
    platform: 'instagram',
    postUrl: `https://www.instagram.com/p/P${index}/`,
    likes
  }))
}

test('dominant-cluster mean ignores viral and minor high-engagement outliers', () => {
  // 7 posts in 100-200, 3 at 500, 2 at 3200 -> dominant cluster is the 100-200 group
  const summary = calculateAvgLikesSummary('nasa', posts([100, 120, 140, 150, 160, 180, 200, 500, 500, 500, 3200, 3200]))
  assert.ok(summary)
  assert.equal(summary.avgLikes, 150)
  assert.equal(summary.avgLikesRangeLow, 100)
  assert.equal(summary.avgLikesRangeHigh, 200)
  assert.equal(summary.avgLikesSampleSize, 12)
  assert.equal(summary.avgLikesCentralSampleSize, 7)
  assert.equal(summary.method, 'modal_cluster_mean')
})

test('single smooth cluster falls back to the mean of all posts', () => {
  const summary = calculateAvgLikesSummary('x', posts([100, 110, 120, 130, 140]))
  assert.equal(summary?.avgLikes, 120)
  assert.equal(summary?.avgLikesCentralSampleSize, 5)
})

test('rejects a single viral outlier', () => {
  const summary = calculateAvgLikesSummary('x', posts([100, 110, 120, 5000]))
  assert.equal(summary?.avgLikes, 110)
  assert.equal(summary?.avgLikesCentralSampleSize, 3)
})

test('tie on cluster size prefers the lower (typical) cluster', () => {
  const summary = calculateAvgLikesSummary('x', posts([10, 12, 1000, 1100]))
  assert.equal(summary?.avgLikes, 11)
})

test('values exactly 2x apart stay in the same cluster', () => {
  const summary = calculateAvgLikesSummary('x', posts([100, 150, 200]))
  assert.equal(summary?.avgLikes, 150)
  assert.equal(summary?.avgLikesCentralSampleSize, 3)
})

test('returns null when no likes are present', () => {
  assert.equal(calculateAvgLikesSummary('x', []), null)
})

test('flags low_sample confidence below minPosts', () => {
  const summary = calculateAvgLikesSummary('x', posts([100, 200]), 20)
  assert.equal(summary?.avgLikesConfidence, 'low_sample')
})
