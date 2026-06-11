import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-research-'))
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

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('research routes', () => {
  it('runs a session, scores candidates, and updates a niche verdict', async () => {
    const app = await loadApp()

    const comp = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@routetest', projectId: 'default', followers: 25_000, favorite: true }),
    }).then((r) => r.json()) as { competitor: { id: string } }
    const competitorId = comp.competitor.id

    // Three typical posts (~50) + one viral (1000) → median baseline = 50,
    // so the viral post scores 1000/50 = 20.
    await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [
          { id: 'rp1', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp1/', likes: 50, postedAt: isoDaysAgo(1) },
          { id: 'rp2', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp2/', likes: 50, postedAt: isoDaysAgo(1) },
          { id: 'rp3', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp3/', likes: 50, postedAt: isoDaysAgo(1) },
          { id: 'rp4', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp4/', likes: 1000, postedAt: isoDaysAgo(1) },
        ],
      }),
    })

    const created = await app.request('/research/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', controls: { favoriteOnly: true } }),
    })
    expect(created.status).toBe(201)
    const body = await created.json() as {
      session: { id: string; status: string; counts: { candidates: number } }
      candidates: Array<{ id: string; likes: number; score?: number; candidateLevel: string; validationStatus: string }>
    }
    expect(body.session.status).toBe('done')
    expect(body.session.counts.candidates).toBe(4)

    const viral = body.candidates.find((x) => x.likes === 1000)!
    expect(viral.score).toBe(20)
    expect(viral.candidateLevel).toBe('green')
    expect(viral.validationStatus).toBe('pending')

    const patched = await app.request(`/research/candidates/${viral.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nicheAligned: true, decision: 'saved' }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = await patched.json() as { candidate: { validationStatus: string; decision: string } }
    expect(patchedBody.candidate.validationStatus).toBe('valid')
    expect(patchedBody.candidate.decision).toBe('saved')

    const listed = await app.request(`/research/sessions/${body.session.id}/candidates`).then((r) => r.json()) as { items: unknown[] }
    expect(listed.items).toHaveLength(4)

    const validOnly = await app.request('/research/candidates?projectId=default&validation=valid').then((r) => r.json()) as { items: unknown[] }
    expect(validOnly.items).toHaveLength(1)
  })
})
