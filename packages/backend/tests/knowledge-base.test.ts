import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const JSON_HEADERS = { 'content-type': 'application/json' }

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-kb-'))
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

/** Create a new project via the API and return its id. */
async function createProject(name: string, workdir: string): Promise<string> {
  const app = await loadApp()
  await mkdir(workdir, { recursive: true })
  const res = await app.request('/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, workdir }),
  })
  expect(res.status).toBe(201)
  const body = await res.json() as { project: { id: string } }
  return body.project.id
}

describe('knowledge-base routes', () => {
  it('save then search returns a cited hit', async () => {
    const app = await loadApp()
    // 'default' is auto-created by createConversationService on init.
    const projectId = 'default'

    const saveRes = await app.request('/knowledge-base/save', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        projectId,
        path: 'brand/voice.md',
        content: '# Voice\n\nwarm confident concise\n',
      }),
    })
    expect(saveRes.status).toBe(200)
    const saveBody = await saveRes.json() as { ok: boolean; path: string }
    expect(saveBody.ok).toBe(true)
    expect(saveBody.path).toBe('brand/voice.md')

    const searchRes = await app.request('/knowledge-base/search', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, query: 'confident voice' }),
    })
    expect(searchRes.status).toBe(200)
    const searchBody = await searchRes.json() as {
      ok: boolean
      results: Array<{ source: string; excerpt: string }>
    }
    expect(searchBody.ok).toBe(true)
    expect(searchBody.results.length).toBeGreaterThan(0)
    expect(searchBody.results[0]!.source).toBe('brand/voice.md')
    expect(searchBody.results[0]!.excerpt).toMatch(/warm confident/i)
  })

  it('search on an empty corpus returns []', async () => {
    const app = await loadApp()
    // Create a brand-new project with an empty workspace so there are no docs.
    const workdir = join(tmpDir, 'empty-ws')
    const projectId = await createProject('Empty KB project', workdir)

    const searchRes = await app.request('/knowledge-base/search', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, query: 'anything' }),
    })
    expect(searchRes.status).toBe(200)
    const body = await searchRes.json() as { ok: boolean; results: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.results).toEqual([])
  })

  it('tree lists markdown files on disk and read returns content', async () => {
    const app = await loadApp()
    const projectId = 'default'

    await app.request('/knowledge-base/save', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, path: 'guides/setup.md', content: '# Setup\n\nstep one\n' }),
    })

    const treeRes = await app.request(`/knowledge-base/tree?projectId=${projectId}`)
    expect(treeRes.status).toBe(200)
    const treeBody = await treeRes.json() as {
      ok: boolean; items: Array<{ path: string; size: number; updatedAt: string }>
    }
    expect(treeBody.ok).toBe(true)
    expect(treeBody.items.some((i) => i.path === 'guides/setup.md')).toBe(true)

    const readRes = await app.request(
      `/knowledge-base/read?projectId=${projectId}&path=${encodeURIComponent('guides/setup.md')}`,
    )
    expect(readRes.status).toBe(200)
    const readBody = await readRes.json() as { ok: boolean; path: string; content: string }
    expect(readBody.ok).toBe(true)
    expect(readBody.path).toBe('guides/setup.md')
    expect(readBody.content).toContain('step one')
  })

  it('read rejects path traversal with 400', async () => {
    const app = await loadApp()
    const projectId = 'default'
    const res = await app.request(
      `/knowledge-base/read?projectId=${projectId}&path=${encodeURIComponent('../escape.md')}`,
    )
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(false)
  })

  it('save without force on an existing path returns 400', async () => {
    const app = await loadApp()
    const projectId = 'default'

    // First save — must succeed.
    const first = await app.request('/knowledge-base/save', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        projectId,
        path: 'brand/duplicate.md',
        content: '# Duplicate\n\noriginal content\n',
      }),
    })
    expect(first.status).toBe(200)

    // Second save on same path without force — must be rejected with 400.
    const second = await app.request('/knowledge-base/save', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        projectId,
        path: 'brand/duplicate.md',
        content: '# Duplicate\n\novewritten content\n',
      }),
    })
    expect(second.status).toBe(400)
    const body = await second.json() as { ok: boolean }
    expect(body.ok).toBe(false)
  })
})
