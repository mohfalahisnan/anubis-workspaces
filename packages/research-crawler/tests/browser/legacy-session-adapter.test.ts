import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLegacySession } from '../../src/core/browser/legacy-session-adapter.js'
import type { Tab } from '../../src/core/browser/tab.js'
import type { CdpSession } from '../../src/core/chrome/cdp-session.js'

function fakeTab() {
  const calls: Array<{ method: string; params?: unknown }> = []
  const subs: Array<{ method: string }> = []
  let closed = 0
  const tab = {
    tabId: 't', targetId: 'T', sessionId: 'S',
    async navigate() {}, async evaluate() { return undefined as never },
    async click() {}, async type() {}, async screenshot() { return '' },
    async send(method: string, params?: Record<string, unknown>) { calls.push({ method, params }); return {} as never },
    on(method: string) { subs.push({ method }); return () => {} },
    async close() { closed++ },
  } as unknown as Tab
  return { tab, calls, subs, closed: () => closed }
}

test('adapter satisfies the CdpSession shape and forwards send/on/close to the tab', async () => {
  const { tab, calls, subs, closed } = fakeTab()
  const session: CdpSession = createLegacySession(tab)
  await session.send('Network.enable')
  session.on('Network.responseReceived', () => {})
  session.close()
  assert.deepEqual(calls, [{ method: 'Network.enable', params: undefined }])
  assert.deepEqual(subs, [{ method: 'Network.responseReceived' }])
  // close() is fire-and-forget; allow the microtask to run.
  await new Promise<void>((r) => setTimeout(r, 1))
  assert.equal(closed(), 1)
})
