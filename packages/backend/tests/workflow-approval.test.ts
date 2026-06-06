import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-wf-approval-'))
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

type RunState = {
  run: { status: string }
  steps: Array<{ nodeId: string; status: string }>
}

async function pollRun(app: Awaited<ReturnType<typeof loadApp>>, runId: string, predicate: (s: RunState) => boolean): Promise<RunState> {
  for (let i = 0; i < 100; i++) {
    const s = await app.request(`/workflows/runs/${runId}`).then((r) => r.json()) as RunState
    if (predicate(s)) return s
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('pollRun timed out')
}

async function publishApprovalWorkflow(app: Awaited<ReturnType<typeof loadApp>>): Promise<string> {
  const wf = await app.request('/workflows', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Approval' }),
  }).then((r) => r.json())
  const draft = JSON.stringify({
    nodes: [
      { id: 'gate', type: 'humanApproval', position: { x: 0, y: 0 }, data: { title: 'Review' } },
      { id: 'ok', type: 'table', position: { x: 1, y: 0 }, data: { staticData: [{ k: 'v' }] } },
    ],
    edges: [{ id: 'e1', source: 'gate', target: 'ok', sourceHandle: 'approved' }],
  })
  await app.request(`/workflows/${wf.id}/draft`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftGraph: draft }),
  })
  await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })
  return wf.id as string
}

describe('workflow human approval', () => {
  it('pauses at the approval, then resumes and runs the approved branch', async () => {
    const app = await loadApp()
    const wfId = await publishApprovalWorkflow(app)

    const { runId } = await app.request(`/workflows/${wfId}/runs`, { method: 'POST' }).then((r) => r.json())

    // The run parks at the gate.
    const awaiting = await pollRun(app, runId, (s) => s.steps.some((st) => st.nodeId === 'gate' && st.status === 'awaiting'))
    expect(awaiting.run.status).toBe('awaiting_approval')

    // Decide → run resumes and finishes.
    const decided = await app.request(`/workflows/runs/${runId}/decisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'gate', decision: 'approved' }),
    })
    expect(decided.status).toBe(200)

    const done = await pollRun(app, runId, (s) => s.run.status === 'succeeded')
    expect(done.steps.find((st) => st.nodeId === 'ok')?.status).toBe('succeeded')
  })

  it('returns 404 when deciding a run with no pending approval', async () => {
    const app = await loadApp()
    const res = await app.request('/workflows/runs/does-not-exist/decisions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'gate', decision: 'approved' }),
    })
    expect(res.status).toBe(404)
  })
})
