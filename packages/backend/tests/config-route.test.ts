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
  it('GET /config returns the current config', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/config')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; config: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.config.chromePath).toBeUndefined()
  })

  it('PATCH /config merges + persists; subsequent GET sees the value', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      }),
    })
    expect(patch.status).toBe(200)
    const patchBody = (await patch.json()) as { ok: boolean; config: { chromePath?: string } }
    expect(patchBody.config.chromePath).toMatch(/chrome\.exe$/)

    const get = await app.request('/config')
    const getBody = (await get.json()) as { config: { chromePath?: string } }
    expect(getBody.config.chromePath).toMatch(/chrome\.exe$/)
  })

  it('PATCH with empty string clears a value', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chromePath: '' }),
    })
    const body = (await patch.json()) as { config: { chromePath?: string } }
    expect(body.config.chromePath).toBeUndefined()
  })

  it('PATCH /config round-trips generationProfiles', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generationProfiles: { image: 'codex-image', video: 'codex-video' } }),
    })
    expect(patch.status).toBe(200)
    const get = await app.request('/config')
    const body = (await get.json()) as { config: { generationProfiles?: { image?: string; video?: string } } }
    expect(body.config.generationProfiles).toEqual({ image: 'codex-image', video: 'codex-video' })
  })
})
