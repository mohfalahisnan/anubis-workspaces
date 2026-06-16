import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-artifacts-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
  await mkdir(join(tmpDir, 'workflow-runs', 'run-1'), { recursive: true })
  await writeFile(join(tmpDir, 'workflow-runs', 'run-1', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* swallow */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('GET /workflows/artifacts', () => {
  it('streams a file inside the artifact root', async () => {
    const app = await loadApp()
    const valid = join(tmpDir, 'workflow-runs', 'run-1', 'pic.png')
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(valid)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('400s on missing path query', async () => {
    const app = await loadApp()
    const res = await app.request('/workflows/artifacts')
    expect(res.status).toBe(400)
  })

  it('403s on path-traversal attempt', async () => {
    const app = await loadApp()
    const escape = join(tmpDir, '..', 'etc-passwd')
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(escape)}`)
    expect(res.status).toBe(403)
  })

  it('404s on missing file inside root', async () => {
    const app = await loadApp()
    const missing = join(tmpDir, 'workflow-runs', 'run-1', 'nope.png')
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(missing)}`)
    expect(res.status).toBe(404)
  })

  it('streams captured media that lives inside a project workdir', async () => {
    const app = await loadApp()
    const workdir = join(tmpDir, 'capture-project')
    const created = await app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Capture project', workdir }),
    })
    expect(created.status).toBe(201)

    // Mirror where the crawler writes Instagram carousel media:
    // {workdir}/runtime/cache/instagram/{handle}/{shortcode}/{i}.jpg
    const media = join(workdir, 'runtime', 'cache', 'instagram', 'someuser', 'ABC123', '0.jpg')
    await mkdir(dirname(media), { recursive: true })
    await writeFile(media, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))

    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(media)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/jpeg')
  })

  it('403s on a data-dir path that is neither a run artifact nor a project workdir', async () => {
    const app = await loadApp()
    const stray = join(tmpDir, 'unrelated', 'secret.png')
    await mkdir(dirname(stray), { recursive: true })
    await writeFile(stray, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(stray)}`)
    expect(res.status).toBe(403)
  })
})
