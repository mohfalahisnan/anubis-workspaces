import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTab } from '../../src/core/browser/tab.js'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'
import type { TabRecord } from '../../src/core/browser/tab-registry.js'
import type { CdpConnection } from '../../src/core/browser/cdp-connection.js'

const record = (): TabRecord => ({
  tabId: 'tab-1', targetId: 'T1', sessionId: 'S1', url: 'https://x/', state: 'open', queue: createCommandQueue(),
})

function hangingConnection(): CdpConnection {
  return {
    send() { return new Promise(() => {}) }, // never resolves
    on() { return () => {} }, onClose() {}, isOpen() { return true }, close() {},
  }
}

test('send rejects after commandTimeoutMs when the command hangs', async () => {
  const tab = createTab({ record: record(), connection: hangingConnection(), onClose: async () => {}, commandTimeoutMs: 20 })
  await assert.rejects(tab.send('Runtime.evaluate', { expression: '1' }), /timed out/i)
})

test('no timeout when commandTimeoutMs is omitted (resolves normally)', async () => {
  const connection: CdpConnection = {
    async send() { return { ok: true } as never },
    on() { return () => {} }, onClose() {}, isOpen() { return true }, close() {},
  }
  const tab = createTab({ record: record(), connection, onClose: async () => {} })
  assert.deepEqual(await tab.send('X'), { ok: true })
})
