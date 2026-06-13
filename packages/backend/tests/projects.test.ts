import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
})
