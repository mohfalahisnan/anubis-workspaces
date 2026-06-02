import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInstagramCdpCaptureService } from '../src/core/services/instagram-cdp-capture.service.js'
import type { CdpSession } from '../src/core/chrome/cdp-session.js'

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body }
}

function mockFetch(routes: Record<string, () => unknown>): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: unknown, init?: { method?: string }) => {
    const url = new URL(String(input))
    const key = url.pathname.startsWith('/json/close') ? '/json/close' : url.pathname
    calls.push(`${init?.method ?? 'GET'} ${key}`)
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected fetch ${key}`)
    return handler() as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** A CDP session that resolves every command and emits no events. */
function inertSession(): CdpSession {
  return {
    async send() {
      return {} as never
    },
    on() {},
    close() {}
  }
}

const newTabTarget = { id: 'NT', type: 'page', url: 'https://www.instagram.com/p/Abc/', webSocketDebuggerUrl: 'ws://nt' }

async function runCapture(keepTabOpen: boolean) {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const service = createInstagramCdpCaptureService({
    fetchImpl: impl,
    connectSession: async () => inertSession()
  })
  const result = await service.capture({
    url: 'https://www.instagram.com/p/Abc/',
    openNewTab: true,
    keepTabOpen,
    timeoutMs: 30,
    initialDelayMs: 0
  })
  return { result, calls }
}

test('keepTabOpen=true leaves the opened tab open after capture', async () => {
  const { result, calls } = await runCapture(true)

  assert.equal(result.ok, true)
  assert.ok(calls.includes('PUT /json/new'))
  assert.ok(!calls.includes('GET /json/close'), `expected no tab close, got ${calls.join(', ')}`)
})

test('keepTabOpen=false closes the opened tab after capture', async () => {
  const { result, calls } = await runCapture(false)

  assert.equal(result.ok, true)
  assert.ok(calls.includes('GET /json/close'), `expected tab close, got ${calls.join(', ')}`)
})
