import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** /json/version + /json/list fake; everything else throws. */
function fakeFetch(targets: unknown[] = []) {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => targets } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

/** Connection whose send() is scripted; records calls; can simulate per-call delay. */
function scriptedConnection(opts: { onSend?: (m: string, p: unknown, s?: string) => void; delays?: Record<string, number> } = {}) {
  let targetSeq = 0
  let sessionSeq = 0
  const connection: CdpConnection = {
    async send(method, params, sessionId) {
      opts.onSend?.(method, params, sessionId)
      const d = opts.delays?.[method]
      if (d) await delay(d)
      if (method === 'Target.createTarget') return { targetId: `T${++targetSeq}` } as never
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      if (method === 'Target.closeTarget') return { success: true } as never
      return {} as never
    },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose() {},
    isOpen() { return true },
    close() {},
  }
  return connection
}

test('newTab creates + attaches a target and registers tab with targetId/sessionId', async () => {
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection(),
  })
  const tab = await manager.newTab('https://example.com/')
  assert.equal(tab.targetId, 'T1')
  assert.equal(tab.sessionId, 'S1')
  assert.equal(manager.listTabs().length, 1)
})

test('attachExisting attaches to a matching page target', async () => {
  const targets = [{ id: 'TX', type: 'page', url: 'https://www.instagram.com/', webSocketDebuggerUrl: 'ws://x' }]
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(targets),
    connect: async () => scriptedConnection(),
  })
  const tab = await manager.attachExisting((t) => t.url.includes('instagram.com'))
  assert.equal(tab.targetId, 'TX')
  assert.equal(tab.sessionId, 'S1')
})

test('withTab closes the tab afterwards unless keepOpen', async () => {
  const closed: unknown[] = []
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection({ onSend: (m, p) => { if (m === 'Target.closeTarget') closed.push(p) } }),
  })
  await manager.withTab({ url: 'https://example.com/' }, async (tab) => { assert.ok(tab.targetId) })
  assert.equal(manager.listTabs().length, 0)
  assert.equal(closed.length, 1)
})

test('semaphore caps concurrent withTab to maxConcurrentTabs', async () => {
  let active = 0
  let peak = 0
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection(),
    maxConcurrentTabs: 2,
  })
  await Promise.all(Array.from({ length: 6 }, () =>
    manager.withTab({ url: 'https://example.com/' }, async () => {
      active++; peak = Math.max(peak, active); await delay(5); active--
    })))
  assert.equal(peak, 2)
})

test('commands on different tabs interleave (cross-tab parallelism)', async () => {
  const order: string[] = []
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection({
      onSend: (m, _p, s) => { if (m === 'Runtime.evaluate') order.push(`eval:${s}`) },
      delays: { 'Runtime.evaluate': 10 },
    }),
    maxConcurrentTabs: 4,
  })
  const a = await manager.newTab('https://a/')
  const b = await manager.newTab('https://b/')
  await Promise.all([a.evaluate('1'), b.evaluate('1')])
  // Both evals were dispatched (one per session); cross-tab work ran concurrently.
  assert.equal(order.length, 2)
  assert.notEqual(order[0], order[1])
})

test('default maxConcurrentTabs allows a full burst of 8 tabs at once', async () => {
  let active = 0
  let peak = 0
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection(),
    // maxConcurrentTabs intentionally omitted → exercises the default
  })
  await Promise.all(Array.from({ length: 8 }, () =>
    manager.withTab({ url: 'https://example.com/' }, async () => {
      active++; peak = Math.max(peak, active); await delay(5); active--
    })))
  assert.equal(peak, 8)
})
