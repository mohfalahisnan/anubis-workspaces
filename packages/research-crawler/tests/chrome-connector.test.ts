import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openChromeTab, closeChromeTab } from '../src/core/chrome/chrome-connector.js'
import type { CdpSession } from '../src/core/chrome/cdp-session.js'

type Handler = (init?: { method?: string }) => { ok: boolean; status: number; json: () => Promise<unknown> }

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body }
}

/** Route a mocked fetch by URL pathname. */
function mockFetch(routes: Record<string, Handler>): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: unknown, init?: { method?: string }) => {
    const url = new URL(String(input))
    const key = url.pathname.startsWith('/json/close') ? '/json/close' : url.pathname
    calls.push(`${init?.method ?? 'GET'} ${key}`)
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected fetch ${key}`)
    return handler(init) as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

function fakeSession(record: { sent: Array<{ method: string; params?: Record<string, unknown> }>; closed: boolean }, sendResult: unknown): CdpSession {
  return {
    async send(method: string, params?: Record<string, unknown>) {
      record.sent.push({ method, params })
      return sendResult as never
    },
    on() {},
    close() {
      record.closed = true
    }
  }
}

test('openChromeTab returns target from PUT /json/new when available', async () => {
  const target = { id: 'T1', type: 'page', url: 'https://x/', webSocketDebuggerUrl: 'ws://t1' }
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, target)
  })

  const result = await openChromeTab({ chromeOrigin: 'http://127.0.0.1:9222', url: 'https://x/', fetchImpl: impl })

  assert.deepEqual(result, target)
  assert.deepEqual(calls, ['PUT /json/new'])
})

test('openChromeTab falls back to Target.createTarget when PUT fails', async () => {
  const created = { id: 'NEW', type: 'page', url: 'https://x/', webSocketDebuggerUrl: 'ws://new' }
  const { impl } = mockFetch({
    '/json/new': () => jsonResponse(false, 404, {}),
    '/json/version': () => jsonResponse(true, 200, { webSocketDebuggerUrl: 'ws://browser' }),
    '/json/list': () => jsonResponse(true, 200, [created])
  })
  const rec = { sent: [] as Array<{ method: string; params?: Record<string, unknown> }>, closed: false }

  const result = await openChromeTab({
    chromeOrigin: 'http://127.0.0.1:9222',
    url: 'https://x/',
    fetchImpl: impl,
    connectSession: async () => fakeSession(rec, { targetId: 'NEW' })
  })

  assert.deepEqual(result, created)
  assert.equal(rec.sent[0]?.method, 'Target.createTarget')
  assert.equal(rec.closed, true)
})

test('closeChromeTab uses HTTP close when reachable', async () => {
  const { impl, calls } = mockFetch({
    '/json/close': () => jsonResponse(true, 200, {})
  })
  let connectCalled = false

  await closeChromeTab({
    chromeOrigin: 'http://127.0.0.1:9222',
    targetId: 'T1',
    fetchImpl: impl,
    connectSession: async () => {
      connectCalled = true
      return fakeSession({ sent: [], closed: false }, {})
    }
  })

  assert.deepEqual(calls, ['GET /json/close'])
  assert.equal(connectCalled, false)
})

test('closeChromeTab falls back to Target.closeTarget when HTTP close fails', async () => {
  const { impl } = mockFetch({
    '/json/close': () => jsonResponse(false, 500, {}),
    '/json/version': () => jsonResponse(true, 200, { webSocketDebuggerUrl: 'ws://browser' })
  })
  const rec = { sent: [] as Array<{ method: string; params?: Record<string, unknown> }>, closed: false }

  await closeChromeTab({
    chromeOrigin: 'http://127.0.0.1:9222',
    targetId: 'T9',
    fetchImpl: impl,
    connectSession: async () => fakeSession(rec, {})
  })

  assert.equal(rec.sent[0]?.method, 'Target.closeTarget')
  assert.deepEqual(rec.sent[0]?.params, { targetId: 'T9' })
  assert.equal(rec.closed, true)
})
