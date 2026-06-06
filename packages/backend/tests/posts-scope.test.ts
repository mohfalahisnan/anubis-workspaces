import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-posts-scope-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch { /* */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

describe('posts workspace scoping', () => {
  it('returns only posts whose competitor is in the workspace', async () => {
    const app = (await import('../src/app.js')).default
    const { getStack } = await import('../src/services.js')
    const stack = getStack()

    const wsB = stack.brandWorkspaces.create({ name: 'Brand B' }).id
    const a = stack.competitors.create({ handle: 'alpha' })                 // default-workspace
    const b = stack.competitors.create({ handle: 'beta', workspaceId: wsB }) // Brand B

    stack.capturedPosts.upsert({
      id: 'p-a', competitorId: a.id, username: 'alpha', postUrl: 'https://x/a',
      capturedAt: 1,
    })
    stack.capturedPosts.upsert({
      id: 'p-b', competitorId: b.id, username: 'beta', postUrl: 'https://x/b',
      capturedAt: 2,
    })

    const inB = await (await app.request(`/posts?workspaceId=${wsB}`)).json()
    expect(inB.items.map((p: { id: string }) => p.id)).toEqual(['p-b'])
  })
})
