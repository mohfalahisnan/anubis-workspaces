import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureInstagramNetworkResponses } from '../src/core/network/network-listener.js'
import type { CdpSession } from '../src/core/chrome/cdp-session.js'

/** A session that resolves every command and never emits a network event — i.e.
 *  a login wall / empty / blocked page where no profile data ever loads. */
function silentSession(): CdpSession {
  return {
    async send() { return {} as never },
    on() {},
    close() {},
  }
}

test('bails out within the grace window when no matching responses arrive', async () => {
  const start = Date.now()
  const captured = await captureInstagramNetworkResponses(silentSession(), {
    timeoutMs: 60_000, // long — without the early bail this would scroll for a full minute
    maxResponses: 30,
    noDataGraceMs: 200,
    initialDelayMs: 0,
    scrollIntervalMs: 50,
    shouldStop: async () => false,
  })
  const elapsed = Date.now() - start
  assert.equal(captured.length, 0)
  assert.ok(elapsed < 3000, `expected an early bail well under timeoutMs, took ${elapsed}ms`)
})

test('still honours timeoutMs when it is shorter than the grace window', async () => {
  // A short capture (timeout < grace) must finish at the timeout, unchanged by the bail.
  const start = Date.now()
  const captured = await captureInstagramNetworkResponses(silentSession(), {
    timeoutMs: 150,
    maxResponses: 30,
    noDataGraceMs: 9000,
    initialDelayMs: 0,
    scrollIntervalMs: 50,
    shouldStop: async () => false,
  })
  const elapsed = Date.now() - start
  assert.equal(captured.length, 0)
  assert.ok(elapsed >= 100 && elapsed < 2000, `expected ~timeoutMs, took ${elapsed}ms`)
})
