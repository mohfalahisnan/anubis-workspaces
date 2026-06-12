import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInstagramCdpCaptureService } from '../src/core/services/instagram-cdp-capture.service.js'
import { fakeGetManager } from './browser/fake-browser.js'

// The fake browser emits no network data and returns {} for every page eval,
// so capture completes empty — but the tab open/close lifecycle is exercised.

test('capture resolves ok over BrowserManager (openNewTab path)', async () => {
  const service = createInstagramCdpCaptureService({ getManager: fakeGetManager() })
  const result = await service.capture({
    url: 'https://www.instagram.com/p/Abc/', openNewTab: true, keepTabOpen: false, timeoutMs: 30, initialDelayMs: 0,
  })
  assert.equal(result.ok, true)
})

test('keepTabOpen=true leaves the opened tab registered after capture', async () => {
  const getManager = fakeGetManager()
  const service = createInstagramCdpCaptureService({ getManager })
  await service.capture({ url: 'https://www.instagram.com/p/Abc/', openNewTab: true, keepTabOpen: true, timeoutMs: 30, initialDelayMs: 0 })
  assert.equal((await getManager()).listTabs().length, 1)
})

test('keepTabOpen=false closes the opened tab after capture', async () => {
  const getManager = fakeGetManager()
  const service = createInstagramCdpCaptureService({ getManager })
  await service.capture({ url: 'https://www.instagram.com/p/Abc/', openNewTab: true, keepTabOpen: false, timeoutMs: 30, initialDelayMs: 0 })
  assert.equal((await getManager()).listTabs().length, 0)
})
