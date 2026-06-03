import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-config-route-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('/config route', () => {
  it('GET /config returns an empty config initially', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/config')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; config: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.config).toEqual({})
  })

  it('PATCH /config merges + persists; subsequent GET sees the value', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginProfileDir: 'C:\\Users\\Falah\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 3',
      }),
    })
    expect(patch.status).toBe(200)
    const patchBody = (await patch.json()) as { ok: boolean; config: { loginProfileDir?: string } }
    expect(patchBody.config.loginProfileDir).toMatch(/Profile 3$/)

    const get = await app.request('/config')
    const getBody = (await get.json()) as { config: { loginProfileDir?: string } }
    expect(getBody.config.loginProfileDir).toMatch(/Profile 3$/)
  })

  it('PATCH with empty string clears a value', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginProfileDir: '' }),
    })
    const body = (await patch.json()) as { config: { loginProfileDir?: string } }
    expect(body.config.loginProfileDir).toBeUndefined()
  })
})
