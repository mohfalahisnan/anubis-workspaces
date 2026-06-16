import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-posts-delete-orphan-'))
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

describe('DELETE /posts/:id with an orphaned competitor', () => {
  it('deletes a post whose competitor has been (soft-)deleted without erroring', async () => {
    const app = await loadApp()

    const competitor = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@orphan', projectId: 'default', avgLikes: 100 }),
    }).then((r) => r.json()) as { competitor: { id: string } }
    const competitorId = competitor.competitor.id

    const imported = await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [{
          id: 'orphan-post-1',
          competitorId,
          username: 'orphan',
          postUrl: 'https://www.instagram.com/p/orphan-1/',
          likes: 10,
          comments: 1,
        }],
      }),
    })
    expect(imported.status).toBe(200)

    // Soft-delete the competitor. The post row remains and still references it,
    // so competitors.get()/findById() no longer return the owner — the post is
    // now orphaned, mirroring the production state behind the bug report.
    const removed = await app.request(`/competitors/${competitorId}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)

    // Deleting the orphaned post must succeed: the post is gone and the
    // post-count refresh is best-effort when the competitor is missing.
    const res = await app.request('/posts/orphan-post-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Idempotent: the post really was removed, so a second delete is a 404.
    const again = await app.request('/posts/orphan-post-1', { method: 'DELETE' })
    expect(again.status).toBe(404)
  })
})
