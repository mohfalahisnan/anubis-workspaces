import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Regression test for the route-shadowing bug that made every batch capture
 * fail with `not_found`. Hono resolves overlapping routes by registration
 * order, so the dynamic `POST /competitors/:id` route used to swallow the
 * static `POST /competitors/batch` route (matching id="batch") and 404 every
 * batch request. The batch route must now be registered first.
 *
 * The discriminating signal: an *empty* body reaches the batch handler and
 * fails Zod validation (competitorIds required) → 400. If it were still routed
 * to the `:id` handler it would look up a competitor named "batch", find none,
 * and return 404 `not_found` — exactly the bug.
 */

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-capture-batch-route-'))
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

describe('POST /captures/competitors/batch routing', () => {
  it('reaches the batch handler (Zod 400 on empty body), not the :id handler (404)', async () => {
    const app = await loadApp()
    const res = await app.request('/captures/competitors/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    // The batch handler's BatchCaptureBody requires competitorIds → ZodError → 400.
    // The buggy `:id` shadowing returned 404 `not_found` here.
    expect(res.status).toBe(400)
  })

  it('returns not_found from the batch handler when no ids resolve', async () => {
    const app = await loadApp()
    const res = await app.request('/captures/competitors/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ competitorIds: ['does-not-exist'] }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_found' })
  })
})
