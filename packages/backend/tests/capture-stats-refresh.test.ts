import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StandardCrawlerOutput } from '@anubis/research-crawler'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-stats-refresh-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* best-effort */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

function fakeResult(username: string): StandardCrawlerOutput {
  return {
    ok: true,
    schemaVersion: 1,
    output: {
      profiles: [{ username, fullName: 'Real Name', bio: 'real bio', followers: 1234, avgLikes: 50 }],
      posts: [
        { platform: 'instagram', postUrl: `https://www.instagram.com/p/aaa/`, username, likes: 100, comments: 5 },
        { platform: 'instagram', postUrl: `https://www.instagram.com/p/bbb/`, username, likes: 120, comments: 7 },
      ],
    },
    meta: { warnings: [], avgLikes: { perProfile: [{ username, avgLikes: 110, sampleSize: 2 }] } },
  } as unknown as StandardCrawlerOutput
}

describe('refreshCompetitorStats', () => {
  it('updates profile stats and returns candidates WITHOUT persisting any post', async () => {
    const { __testing } = await import('../src/captures.js')
    const { getStack } = await import('../src/services.js')
    const stack = getStack()

    const competitor = stack.competitors.create({ handle: '@statsme', projectId: 'default' })

    const refreshed = __testing.refreshCompetitorStats(competitor.id, fakeResult('statsme'), 12)

    // Stats updated from the crawl result.
    const updated = stack.competitors.get(competitor.id)!
    expect(updated.bio).toBe('real bio')
    expect(updated.followers).toBe(1234)
    expect(updated.avgLikes).toBe(110)
    expect(updated.lastRefreshedAt).toBeGreaterThan(0)

    // Candidates returned, enriched, raw stripped.
    expect(refreshed.candidates).toHaveLength(2)
    expect(refreshed.candidates[0]!.competitorHandle).toBe('@statsme')
    expect('raw' in (refreshed.candidates[0] as Record<string, unknown>)).toBe(false)

    // NOTHING persisted to captured_posts, and postCount untouched.
    expect(stack.capturedPosts.countForCompetitor(competitor.id)).toBe(0)
    expect(updated.postCount).toBe(0)
  })
})
