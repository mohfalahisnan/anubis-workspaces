import assert from 'node:assert/strict'
import { test } from 'node:test'
import { launchBrowserManager, closeBrowserManager } from '../../src/core/browser/browser-lifecycle.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

function fakeFetch() {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => [] } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

function fakeConnection(): CdpConnection {
  let open = true
  return {
    async send() { return {} as never },
    on(_m: string, _h: CdpEventHandler) { return () => {} },
    onClose() {}, isOpen() { return open }, close() { open = false },
  }
}

test('launchBrowserManager launches Chrome then attaches a manager at its origin', async () => {
  const launched: Array<Record<string, unknown>> = []
  const manager = await launchBrowserManager({
    profile: 'public',
    fetchImpl: fakeFetch(),
    connect: async () => fakeConnection(),
    launchChromeImpl: async (input) => {
      launched.push(input)
      return { ok: true, pid: 1, reused: false, remoteDebuggingPort: 9223, profile: 'public', profileDir: 'd', url: 'u', headless: true, warnings: [] }
    },
  })
  assert.equal(manager.chromeOrigin, 'http://127.0.0.1:9223/')
  assert.equal(launched.length, 1)
  assert.equal(launched[0]!.profile, 'public')
})

test('closeBrowserManager closes the manager and kills Chrome when kill=true', async () => {
  let killedPort = 0
  const manager = await launchBrowserManager({
    profile: 'public',
    fetchImpl: fakeFetch(),
    connect: async () => fakeConnection(),
    launchChromeImpl: async () => ({ ok: true, pid: 1, reused: false, remoteDebuggingPort: 9223, profile: 'public', profileDir: 'd', url: 'u', headless: true, warnings: [] }),
  })
  await closeBrowserManager(manager, { kill: true, port: 9223, killChromeImpl: async (p) => { killedPort = p } })
  assert.equal(manager.isOpen(), false)
  assert.equal(killedPort, 9223)
})
