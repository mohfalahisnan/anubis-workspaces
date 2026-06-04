import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-wf-test-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* swallow — best-effort cleanup */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('workflow REST', () => {
  it('creates, saves draft, publishes, lists', async () => {
    const app = await loadApp()
    const created = await app.request('/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke' }),
    })
    expect(created.status).toBe(201)
    const wf = await created.json()
    expect(wf.id).toBeTruthy()

    const draft = JSON.stringify({
      nodes: [{ id: 'n1', type: 'table', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    const saved = await app.request(`/workflows/${wf.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftGraph: draft }),
    })
    expect(saved.status).toBe(200)

    const published = await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })
    expect(published.status).toBe(200)

    const list = await app.request('/workflows')
    const body = await list.json()
    const found = body.items.find((i: { id: string }) => i.id === wf.id)
    expect(found).toBeTruthy()
    expect(found.hasPublished).toBe(true)
  })

  it('rejects run with no published version', async () => {
    const app = await loadApp()
    const created = await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NoPub' }),
    })
    const wf = await created.json()
    const run = await app.request(`/workflows/${wf.id}/runs`, { method: 'POST' })
    expect(run.status).toBe(400)
  })
})
