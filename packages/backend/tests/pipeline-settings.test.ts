import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-pipeline-settings-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('/pipeline-settings route', () => {
  it('PUT persists generationProfiles; GET returns them', async () => {
    const { default: app } = await import('../src/app.js')
    const put = await app.request('/pipeline-settings?projectId=p1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: {}, generationProfiles: { image: 'manual', video: 'codex-video' } }),
    })
    expect(put.status).toBe(200)

    const get = await app.request('/pipeline-settings?projectId=p1')
    const body = (await get.json()) as { settings: { generationProfiles?: { image?: string; video?: string } } }
    expect(body.settings.generationProfiles).toEqual({ image: 'manual', video: 'codex-video' })
  })
})
