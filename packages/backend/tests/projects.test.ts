import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const JSON_HEADERS = { 'content-type': 'application/json' }

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-projects-'))
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
  return (await import('../src/app.js')).default
}

describe('project workspace validation', () => {
  it('rejects an empty workspace instead of resolving it to the process directory', async () => {
    const app = await loadApp()
    const response = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Empty workspace', workdir: '   ' }),
    })

    expect(response.status).toBe(400)
  })

  it('rejects a workspace already assigned to another active project', async () => {
    const app = await loadApp()
    const shared = join(tmpDir, 'shared-workspace')
    const first = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'First project', workdir: shared }),
    })
    expect(first.status).toBe(201)

    const second = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Second project', workdir: join(shared, '.') }),
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'PROJECT_WORKSPACE_CONFLICT' }),
    }))
  })

  it('does not persist a project when workspace initialization fails', async () => {
    const app = await loadApp()
    const blocked = join(tmpDir, 'not-a-directory')
    await writeFile(blocked, 'file', 'utf8')

    const response = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Should not persist', workdir: blocked }),
    })
    expect(response.status).toBe(500)

    const projects = await app.request('/projects').then((result) => result.json()) as {
      items: Array<{ name: string }>
    }
    expect(projects.items.some((project) => project.name === 'Should not persist')).toBe(false)
  })

  it('maps an unknown project id to 404 when scanning its documents', async () => {
    const app = await loadApp()
    const response = await app.request('/content-items?projectId=does-not-exist')
    expect(response.status).toBe(404)
  })

  it('moves canonical documents when a project workdir changes', async () => {
    const app = await loadApp()
    const source = join(tmpDir, 'move-from')
    const created = await app.request('/projects', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Movable workspace', workdir: source }),
    })
    expect(created.status).toBe(201)
    const { project } = await created.json() as { project: { id: string } }

    const item = await app.request('/content-items', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        projectId: project.id,
        title: 'Keep me through the move',
        referenceUrl: 'https://www.instagram.com/p/keep-me/',
      }),
    })
    expect(item.status).toBe(201)
    const { item: content } = await item.json() as { item: { id: string } }

    const dest = join(tmpDir, 'move-to')
    const patched = await app.request(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ workdir: dest }),
    })
    expect(patched.status).toBe(200)

    // The document is readable at the new location through the API …
    const fetched = await app.request(`/content-items/${content.id}`)
    expect(fetched.status).toBe(200)

    // … present on disk under the new workdir …
    const movedFiles = await readdir(join(dest, 'knowledge', 'content'))
    expect(movedFiles.some((name) => name.endsWith('.md'))).toBe(true)

    // … and no longer stranded under the old one.
    const oldContentDir = join(source, 'knowledge', 'content')
    const strandedFiles = existsSync(oldContentDir) ? await readdir(oldContentDir) : []
    expect(strandedFiles.filter((name) => name.endsWith('.md'))).toHaveLength(0)
  })
})
