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

function scriptedConnection(onSend?: (m: string, p: unknown) => void) {
  let sessionSeq = 0
  const connection: CdpConnection = {
    async send(method, params) {
      onSend?.(method, params)
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      return {} as never
    },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose() {}, isOpen() { return true }, close() {},
  }
  return connection
}

test('attach() attaches to the given target id and registers it', async () => {
  const sent: Array<{ m: string; p: any }> = []
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection((m, p) => sent.push({ m, p })),
  })
  const tab = await manager.attach({ id: 'TZ', type: 'page', url: 'https://www.instagram.com/', webSocketDebuggerUrl: 'ws://z' })
  assert.equal(tab.targetId, 'TZ')
  assert.equal(tab.sessionId, 'S1')
  assert.equal(manager.listTabs()[0]!.url, 'https://www.instagram.com/')
  const attachCall = sent.find((s) => s.m === 'Target.attachToTarget')
  assert.equal(attachCall!.p.targetId, 'TZ')
  assert.equal(attachCall!.p.flatten, true)
})
