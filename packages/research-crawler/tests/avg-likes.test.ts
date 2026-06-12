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

test('avgLikes is the plain mean of all like counts (rounded)', () => {
  // mean([100,110,120,130,140]) = 120
  const summary = calculateAvgLikesSummary('x', posts([100, 110, 120, 130, 140]))
  assert.ok(summary)
  assert.equal(summary.avgLikes, 120)
  assert.equal(summary.avgLikesRangeLow, 100)
  assert.equal(summary.avgLikesRangeHigh, 140)
  assert.equal(summary.avgLikesSampleSize, 5)
  assert.equal(summary.avgLikesCentralSampleSize, 5)
  assert.equal(summary.method, 'simple_mean')
})

test('viral posts ARE included in the mean (no outlier suppression)', () => {
  // mean([100,110,120,5000]) = 1332.5 -> 1333
  const summary = calculateAvgLikesSummary('x', posts([100, 110, 120, 5000]))
  assert.equal(summary?.avgLikes, 1333)
  assert.equal(summary?.avgLikesRangeLow, 100)
  assert.equal(summary?.avgLikesRangeHigh, 5000)
})

test('rounds to the nearest integer', () => {
  // mean([230,210,804,302,203,240]) = 331.5 -> 332
  const summary = calculateAvgLikesSummary('x', posts([230, 210, 804, 302, 203, 240]))
  assert.equal(summary?.avgLikes, 332)
})

test('ignores non-numeric / negative like counts', () => {
  const summary = calculateAvgLikesSummary('x', [
    { platform: 'instagram', postUrl: 'p1', likes: 100 },
    { platform: 'instagram', postUrl: 'p2', likes: -5 },
    { platform: 'instagram', postUrl: 'p3' },
    { platform: 'instagram', postUrl: 'p4', likes: 200 },
  ])
  assert.equal(summary?.avgLikes, 150)
  assert.equal(summary?.avgLikesSampleSize, 2)
})

test('returns null when no likes are present', () => {
  assert.equal(calculateAvgLikesSummary('x', []), null)
})

test('flags low_sample confidence below minPosts', () => {
  const summary = calculateAvgLikesSummary('x', posts([100, 200]), 20)
  assert.equal(summary?.avgLikes, 150)
  assert.equal(summary?.avgLikesConfidence, 'low_sample')
})

test('flags ok confidence at or above minPosts', () => {
  const summary = calculateAvgLikesSummary('x', posts([100, 200]), 2)
  assert.equal(summary?.avgLikesConfidence, 'ok')
})
