import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-bw-test-'))
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

describe('brand workspace REST', () => {
  it('lists the seeded default workspace', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/workspaces')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.some((w: { id: string }) => w.id === 'default-workspace')).toBe(true)
  })

  it('creates, then renames a workspace', async () => {
    const app = await loadApp()
    const created = await app.request('/content-memory/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })
    expect(created.status).toBe(201)
    const { workspace } = await created.json()
    expect(workspace.name).toBe('Acme')

    const patched = await app.request(`/content-memory/workspaces/${workspace.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Co' }),
    })
    expect(patched.status).toBe(200)
    expect((await patched.json()).workspace.name).toBe('Acme Co')
  })

  it('404s patching an unknown workspace', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/workspaces/nope', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects archiving the default workspace', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/workspaces/default-workspace', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })
    expect(res.status).toBe(400)
  })
})
