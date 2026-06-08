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

  it('exports a workflow and re-imports it as a new unpublished workflow', async () => {
    const app = await loadApp()
    const created = await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Exportable', description: 'desc' }),
    })
    const wf = await created.json()
    const draft = JSON.stringify({
      nodes: [{ id: 'n1', type: 'table', position: { x: 1, y: 2 }, data: { staticData: [{ k: 'v' }] } }],
      edges: [],
    })
    await app.request(`/workflows/${wf.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftGraph: draft }),
    })

    const exportResp = await app.request(`/workflows/${wf.id}/export`)
    expect(exportResp.status).toBe(200)
    const exported = await exportResp.json()
    expect(exported.anubisWorkflowExport).toBe(1)
    expect(exported.name).toBe('Exportable')
    expect(exported.graph.nodes[0].id).toBe('n1')

    const importResp = await app.request('/workflows/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exported),
    })
    expect(importResp.status).toBe(201)
    const imported = await importResp.json()
    expect(imported.id).not.toBe(wf.id)
    expect(imported.name).toBe('Exportable')
    expect(imported.publishedGraph).toBeUndefined()
    expect(JSON.parse(imported.draftGraph).nodes[0].id).toBe('n1')
  })

  it('rejects an import with an invalid graph', async () => {
    const app = await loadApp()
    const resp = await app.request('/workflows/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', graph: { nodes: 'nope', edges: [] } }),
    })
    expect(resp.status).toBe(400)
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

  it('starts a run with node data overrides persisted in the graph snapshot', async () => {
    const app = await loadApp()
    const created = await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Override run' }),
    })
    const wf = await created.json()
    const draft = JSON.stringify({
      nodes: [{ id: 't1', type: 'table', position: { x: 0, y: 0 }, data: { staticData: [{ k: 'old' }] } }],
      edges: [],
    })
    await app.request(`/workflows/${wf.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftGraph: draft }),
    })
    await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })

    const runResp = await app.request(`/workflows/${wf.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeDataOverrides: { t1: { staticData: [{ k: 'fresh' }] } } }),
    })
    expect(runResp.status).toBe(201)
    const { runId } = await runResp.json()
    await new Promise((r) => setTimeout(r, 10))
    const runState = await app.request(`/workflows/runs/${runId}`).then((r) => r.json())
    expect(JSON.parse(runState.run.graphSnapshot).nodes[0].data).toEqual({ staticData: [{ k: 'fresh' }] })
  })

  it('fails an Instagram post node when the selected post is outside the workflow project', async () => {
    const app = await loadApp()
    const project = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Workflow scoped project' }),
    }).then((r) => r.json()) as { project: { id: string } }

    const competitor = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@othercreator', projectId: 'default' }),
    }).then((r) => r.json()) as { competitor: { id: string } }

    await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [{
          id: 'cross-project-post',
          competitorId: competitor.competitor.id,
          username: 'othercreator',
          postUrl: 'https://www.instagram.com/p/cross-project-post/',
        }],
      }),
    })

    const created = await app.request('/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Scoped IG', projectId: project.project.id }),
    })
    const wf = await created.json()
    const draft = JSON.stringify({
      nodes: [{ id: 'ig1', type: 'instagramPost', position: { x: 0, y: 0 }, data: { source: 'existing', postId: 'cross-project-post' } }],
      edges: [],
    })
    await app.request(`/workflows/${wf.id}/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftGraph: draft }),
    })
    await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })

    const runResp = await app.request(`/workflows/${wf.id}/runs`, { method: 'POST' })
    expect(runResp.status).toBe(201)
    const { runId } = await runResp.json()
    await new Promise((r) => setTimeout(r, 10))

    const runState = await app.request(`/workflows/runs/${runId}`).then((r) => r.json())
    expect(runState.run.status).toBe('failed')
    expect(runState.run.projectId).toBe(project.project.id)
    expect(runState.run.error).toContain('does not belong to workflow project')
  })

  it('SSE events are replayed even when the subscriber attaches after the run finishes', async () => {
    const app = await loadApp()
    // Create + publish a workflow that finishes instantly (single Table node).
    const created = await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Fast' }),
    })
    const wf = await created.json()
    const draft = JSON.stringify({
      nodes: [{ id: 't1', type: 'table', position: { x: 0, y: 0 }, data: { staticData: [{ k: 'v' }] } }],
      edges: [],
    })
    await app.request(`/workflows/${wf.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftGraph: draft }),
    })
    await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })

    // Start the run. The Table executor returns synchronously, so by the time
    // we get back to this code the run is already finished.
    const runResp = await app.request(`/workflows/${wf.id}/runs`, { method: 'POST' })
    expect(runResp.status).toBe(201)
    const { runId } = await runResp.json()

    // Yield to let the in-process runner promise actually flush its emit() calls
    // and persist run-finished before we subscribe.
    await new Promise((r) => setTimeout(r, 10))

    // Late subscribe — should still receive the buffered events incl. run-finished.
    const sseResp = await app.request(`/workflows/runs/${runId}/events`)
    expect(sseResp.status).toBe(200)
    expect(sseResp.headers.get('content-type')).toContain('text/event-stream')
    const text = await sseResp.text()
    expect(text).toContain('"kind":"run-started"')
    expect(text).toContain('"kind":"node-started"')
    expect(text).toContain('"kind":"node-succeeded"')
    expect(text).toContain('"kind":"run-finished"')
    expect(text).toContain('"status":"succeeded"')

    // Run row in the DB reflects the final status.
    const runState = await app.request(`/workflows/runs/${runId}`).then((r) => r.json())
    expect(runState.run.status).toBe('succeeded')
    expect(runState.steps.length).toBe(1)
    expect(runState.steps[0].status).toBe('succeeded')
  })
})
