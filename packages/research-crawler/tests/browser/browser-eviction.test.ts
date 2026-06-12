import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

/** Connection that lets the test emit browser-level events (no sessionId). */
function eventConnection() {
  let targetSeq = 0
  let sessionSeq = 0
  const browserHandlers: Array<{ method: string; handler: CdpEventHandler }> = []
  const connection: CdpConnection = {
    async send(method) {
      if (method === 'Target.createTarget') return { targetId: `T${++targetSeq}` } as never
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      return {} as never
    },
    on(method, handler, sessionId) {
      if (!sessionId) browserHandlers.push({ method, handler })
      return () => {}
    },
    onClose() {}, isOpen() { return true }, close() {},
  }
  const emit = (method: string, params: unknown) => {
    for (const h of browserHandlers) if (h.method === method) void h.handler(params)
  }
  return { connection, emit }
}

test('targetDestroyed evicts the tab from the registry', async () => {
  const ev = eventConnection()
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222', fetchImpl: fakeFetch(), connect: async () => ev.connection,
  })
  const tab = await manager.newTab('https://example.com/')
  assert.equal(manager.listTabs().length, 1)
  ev.emit('Target.targetDestroyed', { targetId: tab.targetId })
  assert.equal(manager.listTabs().length, 0)
})

test('detachedFromTarget evicts the tab by sessionId', async () => {
  const ev = eventConnection()
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222', fetchImpl: fakeFetch(), connect: async () => ev.connection,
  })
  const tab = await manager.newTab('https://example.com/')
  ev.emit('Target.detachedFromTarget', { sessionId: tab.sessionId })
  assert.equal(manager.listTabs().length, 0)
})
