import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-niche-'))
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
  return (await import('../src/app.js')).default
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('POST /research/sessions/:id/validate-niche', () => {
  it('404s for an unknown session', async () => {
    const app = await loadApp()
    const res = await app.request('/research/sessions/nope/validate-niche', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(404)
  })

  it('400s when the project has no workspace directory (default project)', async () => {
    const app = await loadApp()
    const comp = await app.request('/competitors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@nichetest', projectId: 'default', followers: 25_000 }),
    }).then((r) => r.json()) as { competitor: { id: string } }

    await app.request('/posts/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posts: [
        { id: 'np1', competitorId: comp.competitor.id, username: 'nichetest', postUrl: 'https://www.instagram.com/p/np1/', likes: 50, postedAt: isoDaysAgo(1) },
        { id: 'np2', competitorId: comp.competitor.id, username: 'nichetest', postUrl: 'https://www.instagram.com/p/np2/', likes: 1000, postedAt: isoDaysAgo(1) },
      ] }),
    })

    const created = await app.request('/research/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', controls: {} }),
    }).then((r) => r.json()) as { session: { id: string } }

    const res = await app.request(`/research/sessions/${created.session.id}/validate-niche`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('no_workdir')
  })
})
