import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-comp-scope-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch { /* */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})
async function loadApp() { return (await import('../src/app.js')).default }

describe('competitors workspace scoping', () => {
  it('lists only competitors in the requested workspace', async () => {
    const app = await loadApp()
    const ws = await (await app.request('/content-memory/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Brand B' }),
    })).json()
    const wsB = ws.workspace.id

    await app.request('/competitors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alpha' }), // defaults to default-workspace
    })
    await app.request('/competitors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'beta', workspaceId: wsB }),
    })

    const inB = await (await app.request(`/competitors?workspaceId=${wsB}`)).json()
    expect(inB.items.map((c: { handle: string }) => c.handle)).toEqual(['@beta'])

    const inDefault = await (await app.request('/competitors?workspaceId=default-workspace')).json()
    expect(inDefault.items.some((c: { handle: string }) => c.handle === '@alpha')).toBe(true)
    expect(inDefault.items.some((c: { handle: string }) => c.handle === '@beta')).toBe(false)
  })
})
