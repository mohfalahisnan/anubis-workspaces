import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-ext-routes-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('/extension routes', () => {
  it('GET /extension/status returns connected=false with no client', async () => {
    const { default: app } = await import('../../src/app.js')
    const res = await app.request('/extension/status')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; status: { connected: boolean; port: number; dataDirPath: string } }
    expect(body.ok).toBe(true)
    expect(body.status.connected).toBe(false)
    expect(body.status.port).toBeGreaterThanOrEqual(47891)
    expect(body.status.dataDirPath).toContain('extension')
  })

  it('POST /extension/secret/reveal returns the current secret', async () => {
    const { default: app } = await import('../../src/app.js')
    const res = await app.request('/extension/secret/reveal', { method: 'POST' })
    const body = (await res.json()) as { ok: boolean; secret: string }
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('POST /extension/secret/rotate returns a new secret different from the old', async () => {
    const { default: app } = await import('../../src/app.js')
    const before = await (await app.request('/extension/secret/reveal', { method: 'POST' })).json() as { secret: string }
    const after = await (await app.request('/extension/secret/rotate', { method: 'POST' })).json() as { secret: string }
    expect(after.secret).not.toBe(before.secret)
    const verify = await (await app.request('/extension/secret/reveal', { method: 'POST' })).json() as { secret: string }
    expect(verify.secret).toBe(after.secret)
  })
})
