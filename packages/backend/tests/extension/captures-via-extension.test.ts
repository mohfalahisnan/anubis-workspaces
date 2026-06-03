import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* Verifies that POST /captures/competitors/:id with profile=login
   dispatches a capture-profile job to the extension queue, persists
   the returned posts, and updates competitor stats. Mocks
   getJobQueue + ensureExtensionStarted so we don't need a real WS. */

vi.mock('../../src/services.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services.js')>('../../src/services.js')
  return {
    ...actual,
    ensureExtensionStarted: async () => undefined,
    getJobQueue: () => ({
      dispatch: () => Promise.resolve({
        profiles: [{
          platform: 'instagram' as const,
          username: 'falah.isnan',
          profileUrl: 'https://www.instagram.com/falah.isnan/',
          followers: 1234,
          postCount: 50,
        }],
        posts: [
          { platform: 'instagram' as const, postUrl: 'https://www.instagram.com/p/abc/', username: 'falah.isnan', likes: 100, comments: 5, timestamp: '2026-01-01T00:00:00Z' },
          { platform: 'instagram' as const, postUrl: 'https://www.instagram.com/p/def/', username: 'falah.isnan', likes: 110, comments: 7, timestamp: '2026-01-02T00:00:00Z' },
        ],
      }),
    }),
  }
})

let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-cap-ext-'))
  process.env.ANUBIS_DATA_DIR = dataDir
  const { getStack } = await import('../../src/services.js')
  getStack().competitors.create({ handle: 'falah.isnan' })
})

afterAll(async () => {
  const { shutdownStack } = await import('../../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('POST /captures/competitors/:id with profile=login dispatches via extension', () => {
  it('persists returned posts and updates competitor stats', async () => {
    const { default: app } = await import('../../src/app.js')
    const { getStack } = await import('../../src/services.js')
    const id = getStack().competitors.list()[0]!.id
    const res = await app.request(`/captures/competitors/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'login' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; capturedCount: number; competitor: { followers?: number } }
    expect(body.ok).toBe(true)
    expect(body.capturedCount).toBe(2)
    expect(body.competitor.followers).toBe(1234)
    const posts = getStack().capturedPosts.list({ competitorId: id, limit: 10, orderBy: 'recent' })
    expect(posts.length).toBe(2)
  })
})
