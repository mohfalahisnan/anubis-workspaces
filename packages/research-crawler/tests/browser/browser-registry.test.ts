import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserRegistry } from '../../src/core/browser/browser-registry.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => [] } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

function connectionFactory() {
  let open = true
  const closeHandlers: Array<() => void> = []
  const connection: CdpConnection = {
    async send() { return {} as never },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose(h) { closeHandlers.push(h) },
    isOpen() { return open },
    close() { open = false; for (const h of closeHandlers) h() },
  }
  return { connection, drop: () => connection.close() }
}

test('returns the same manager for the same origin (cached)', async () => {
  const registry = createBrowserRegistry()
  const opts = { chromeOrigin: 'http://127.0.0.1:9222', fetchImpl: fakeFetch(), connect: async () => connectionFactory().connection }
  const a = await registry.get(opts)
  const b = await registry.get(opts)
  assert.equal(a, b)
})

test('recreates the manager after its connection closes', async () => {
  const registry = createBrowserRegistry()
  let made = 0
  const opts = {
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => { made++; return connectionFactory().connection },
  }
  const a = await registry.get(opts)
  await a.close()
  const b = await registry.get(opts)
  assert.notEqual(a, b)
  assert.equal(made, 2)
})
