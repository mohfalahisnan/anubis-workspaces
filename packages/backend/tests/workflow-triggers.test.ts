import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchesGlob } from '../src/trigger-manager.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-trig-test-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const wf = await import('../src/workflow.js')
    wf.shutdownTriggers()
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

const SCHEDULE_GRAPH = JSON.stringify({
  nodes: [{ id: 'trig', type: 'scheduleTrigger', position: { x: 0, y: 0 }, data: { everyValue: 1, everyUnit: 'hour' } }],
  edges: [],
})

async function makePublished(app: Awaited<ReturnType<typeof loadApp>>, name: string, graph: string) {
  const created = await app.request('/workflows', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const wf = await created.json()
  await app.request(`/workflows/${wf.id}/draft`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftGraph: graph }),
  })
  await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })
  return wf.id as string
}

describe('matchesGlob', () => {
  it('matches everything when no glob', () => {
    expect(matchesGlob('/a/b/c.png', undefined)).toBe(true)
    expect(matchesGlob('/a/b/c.png', '')).toBe(true)
  })
  it('matches a simple extension glob against the basename', () => {
    expect(matchesGlob('/a/b/c.png', '*.png')).toBe(true)
    expect(matchesGlob('/a/b/c.jpg', '*.png')).toBe(false)
  })
  it('matches a prefix glob', () => {
    expect(matchesGlob('C:\\x\\report-2026.csv', 'report-*')).toBe(true)
  })
})

describe('trigger arm/disarm', () => {
  it('arms a schedule workflow and reflects armed in the summary', async () => {
    const app = await loadApp()
    const id = await makePublished(app, 'Sched', SCHEDULE_GRAPH)

    const arm = await app.request(`/workflows/${id}/arm`, { method: 'POST' })
    expect(arm.status).toBe(200)
    expect(await arm.json()).toEqual({ armed: true })

    const detail = await app.request(`/workflows/${id}`).then((r) => r.json())
    expect(detail.hasTrigger).toBe(true)
    expect(detail.armed).toBe(true)

    const disarm = await app.request(`/workflows/${id}/disarm`, { method: 'POST' })
    expect(disarm.status).toBe(200)
    expect(await disarm.json()).toEqual({ armed: false })

    const after = await app.request(`/workflows/${id}`).then((r) => r.json())
    expect(after.armed).toBe(false)
  })

  it('rejects arming a workflow with no trigger node', async () => {
    const app = await loadApp()
    const tableGraph = JSON.stringify({
      nodes: [{ id: 't1', type: 'table', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    const id = await makePublished(app, 'NoTrig', tableGraph)
    const arm = await app.request(`/workflows/${id}/arm`, { method: 'POST' })
    expect(arm.status).toBe(400)
  })
})
