import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/services.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services.js')>('../../src/services.js')
  return {
    ...actual,
    ensureExtensionStarted: async () => undefined,
    getJobQueue: () => ({
      dispatch: () => Promise.resolve({
        profiles: [
          { platform: 'instagram' as const, username: 'coffeelover', profileUrl: 'https://www.instagram.com/coffeelover/', followers: 5000 },
          { platform: 'instagram' as const, username: 'morningbrew', profileUrl: 'https://www.instagram.com/morningbrew/', followers: 8000 },
        ],
        posts: [],
      }),
    }),
  }
})

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-disc-ext-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('POST /research-crawler/instagram/discover with profile=login dispatches via extension', () => {
  it('returns the dispatched profiles wrapped in the StandardCrawlerOutput shape', async () => {
    const { default: app } = await import('../../src/app.js')
    const res = await app.request('/research-crawler/instagram/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'keyword', keyword: 'coffee', profile: 'login', targetCompetitors: 5 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; output: { profiles: { username: string }[] } }
    expect(body.ok).toBe(true)
    expect(body.output.profiles.map((p) => p.username).sort()).toEqual(['coffeelover', 'morningbrew'])
  })

  it('chrome/open with profile=login returns NOT_APPLICABLE_FOR_LOGIN', async () => {
    const { default: app } = await import('../../src/app.js')
    const res = await app.request('/research-crawler/chrome/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'login' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_APPLICABLE_FOR_LOGIN')
  })
})
