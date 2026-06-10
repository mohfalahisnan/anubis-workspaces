import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-posts-list-'))
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

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('GET /posts response shape', () => {
  it('omits the raw capture blob but keeps derived asset fields', async () => {
    const app = await loadApp()
    const competitor = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@rawtest', projectId: 'default', avgLikes: 100 }),
    }).then((r) => r.json()) as { competitor: { id: string } }

    const imported = await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [{
          id: 'raw-1',
          competitorId: competitor.competitor.id,
          username: 'rawtest',
          postUrl: 'https://www.instagram.com/p/raw-1/',
          caption: 'Has a big raw blob',
          likes: 500,
          comments: 20,
          raw: {
            assetPaths: { absolute: ['/abs/a.jpg'], relative: ['a.jpg'] },
            failedAssets: ['b.jpg'],
            // Stand-in for the megabytes of scraped fields the UI never reads.
            bloat: 'x'.repeat(10_000),
          },
        }],
      }),
    })
    expect(imported.status).toBe(200)

    const listed = await app.request('/posts?projectId=default').then((r) => r.json()) as {
      ok: boolean
      items: Array<Record<string, unknown> & {
        raw?: unknown
        assetPaths?: { absolute: string[]; relative: string[] }
        failedAssets?: string[]
      }>
    }
    expect(listed.ok).toBe(true)
    expect(listed.items).toHaveLength(1)

    const item = listed.items[0]!
    // The raw blob must not be shipped.
    expect(item).not.toHaveProperty('raw')
    expect(JSON.stringify(listed)).not.toContain('bloat')
    // Derived fields the UI actually consumes survive.
    expect(item.assetPaths).toEqual({ absolute: ['/abs/a.jpg'], relative: ['a.jpg'] })
    expect(item.failedAssets).toEqual(['b.jpg'])
    expect(item.caption).toBe('Has a big raw blob')
  })
})
