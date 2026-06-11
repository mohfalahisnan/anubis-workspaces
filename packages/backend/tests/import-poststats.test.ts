import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-import-poststats-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch {}
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('POST /posts/import stats', () => {
  it('bumps postCount but leaves capture-owned avgLikes untouched', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()

    const competitor = stack.competitors.create({ handle: '@importme', projectId: 'default' })
    // Capture owns avgLikes — set a value the import must NOT overwrite.
    stack.competitors.update(competitor.id, { avgLikes: 999 })

    const res = await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [
          { competitorId: competitor.id, username: 'importme', postUrl: 'https://www.instagram.com/p/x1/', likes: 10 },
          { competitorId: competitor.id, username: 'importme', postUrl: 'https://www.instagram.com/p/x2/', likes: 20 },
        ],
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, importedCount: 2 })

    const after = stack.competitors.get(competitor.id)!
    expect(after.postCount).toBe(2)     // updated from saved posts
    expect(after.avgLikes).toBe(999)    // capture-owned, NOT recomputed from the subset
  })
})
