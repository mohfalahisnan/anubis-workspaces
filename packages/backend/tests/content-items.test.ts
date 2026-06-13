import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-content-items-'))
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

describe('content item routes', () => {
  it('creates, lists, updates, and deletes project-scoped planner items', async () => {
    const app = await loadApp()
    const competitor = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@creator', projectId: 'default', avgLikes: 100 }),
    }).then((r) => r.json()) as { competitor: { id: string } }

    const imported = await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [{
          id: 'ref-1',
          competitorId: competitor.competitor.id,
          username: 'creator',
          postUrl: 'https://www.instagram.com/p/ref-1/',
          caption: 'Reference hook',
          likes: 500,
          comments: 20,
        }],
      }),
    })
    expect(imported.status).toBe(200)

    const created = await app.request('/content-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'default',
        referencePostId: 'ref-1',
        title: 'My content idea',
        rawBrief: 'Raw brief',
      }),
    })
    expect(created.status).toBe(201)
    const createdBody = await created.json() as { item: { id: string; status: string; referencePost?: { caption?: string } } }
    expect(createdBody.item.status).toBe('idea')
    expect(createdBody.item.referencePost?.caption).toBe('Reference hook')

    const patched = await app.request(`/content-items/${createdBody.item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'review',
        improvedDraft: 'Improved copy',
        analytics: { saves: 7 },
      }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = await patched.json() as { item: { status: string; improvedDraft?: string; analytics: { saves?: number } } }
    expect(patchedBody.item.status).toBe('review')
    expect(patchedBody.item.improvedDraft).toBe('Improved copy')
    expect(patchedBody.item.analytics.saves).toBe(7)

    const contentDir = join(tmpDir, 'workspaces', 'default', 'knowledge', 'content')
    const files = await readdir(contentDir)
    expect(files).toHaveLength(1)
    const contentPath = join(contentDir, files[0]!)
    const source = await readFile(contentPath, 'utf8')
    await writeFile(contentPath, `${source}\n## Custom Notes\n\nKeep this section.\n`.replace('Improved copy', 'Edited draft outside Anubis'), 'utf8')

    const manuallyEdited = await app.request(`/content-items/${createdBody.item.id}`).then((r) => r.json()) as {
      item: { improvedDraft?: string }
    }
    expect(manuallyEdited.item.improvedDraft).toBe('Edited draft outside Anubis')

    await app.request(`/content-items/${createdBody.item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed idea' }),
    })
    expect(await readFile(contentPath, 'utf8')).toContain('## Custom Notes\n\nKeep this section.')

    const listed = await app.request('/content-items?projectId=default').then((r) => r.json()) as { items: unknown[] }
    expect(listed.items).toHaveLength(1)

    const sync = await app.request(`/content-items/${createdBody.item.id}/sync-metrics`, { method: 'POST' })
    expect(sync.status).toBe(400)

    const deleted = await app.request(`/content-items/${createdBody.item.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    const listedAfter = await app.request('/content-items?projectId=default').then((r) => r.json()) as { items: unknown[] }
    expect(listedAfter.items).toHaveLength(0)
  })

  it('creates planner items from a reference URL without a captured post', async () => {
    const app = await loadApp()
    const created = await app.request('/content-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'default',
        referenceUrl: 'https://www.instagram.com/p/fresh-reference/',
        title: 'URL-backed planner item',
      }),
    })
    expect(created.status).toBe(201)
    const body = await created.json() as { item: { referenceUrl?: string; referencePostId?: string; referencePost?: unknown } }
    expect(body.item.referenceUrl).toBe('https://www.instagram.com/p/fresh-reference/')
    expect(body.item.referencePostId).toBeUndefined()
    expect(body.item.referencePost).toBeUndefined()
  })
})
