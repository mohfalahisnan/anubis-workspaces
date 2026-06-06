import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-wf-scope-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch { /* */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})
async function loadApp() { return (await import('../src/app.js')).default }

describe('workflows workspace scoping', () => {
  it('lists only workflows in the requested workspace', async () => {
    const app = await loadApp()
    const wsB = (await (await app.request('/content-memory/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Brand B' }),
    })).json()).workspace.id

    await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Default WF' }),
    })
    await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B WF', workspaceId: wsB }),
    })

    const inB = await (await app.request(`/workflows?workspaceId=${wsB}`)).json()
    expect(inB.items.map((w: { name: string }) => w.name)).toEqual(['B WF'])
  })
})
