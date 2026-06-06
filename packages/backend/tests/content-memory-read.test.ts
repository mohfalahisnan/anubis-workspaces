import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-cm-read-'))
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

describe('content-memory read routes', () => {
  it('lists agent runs for a workspace after saving one', async () => {
    const app = await loadApp()
    const save = await app.request('/content-memory/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default-workspace', agentId: 'a', taskType: 'generate_content',
        userInput: 'u', intent: 'i', output: 'o', validationStatus: 'passed',
      }),
    })
    expect(save.status).toBe(201)

    const res = await app.request('/content-memory/runs?workspaceId=default-workspace')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items[0].taskType).toBe('generate_content')
  })

  it('lists experience memories incl. candidates after bad feedback', async () => {
    const app = await loadApp()
    await app.request('/content-memory/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'r1', workspaceId: 'default-workspace', rating: 'bad',
        feedback: 'Avoid fear hooks for this brand.',
      }),
    })
    const res = await app.request('/content-memory/memories?workspaceId=default-workspace')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.some((m: { status: string }) => m.status === 'candidate')).toBe(true)
  })

  it('filters memories by status', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/memories?workspaceId=default-workspace&status=active')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.every((m: { status: string }) => m.status === 'active')).toBe(true)
  })

  it('400s on missing workspaceId', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/memories')
    expect(res.status).toBe(400)
  })
})
