import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withCdpCaptureSession } from '../../src/core/chrome/cdp-capture-session.js'
import { fakeGetManager } from './fake-browser.js'
import type { ChromeTarget } from '../../src/core/chrome/chrome-connector.js'

test('openNewTab path: opens a tab, runs body with a session, reports openedTabId', async () => {
  const getManager = fakeGetManager()
  const seen: { hasSession: boolean; openedTabId?: string; targetId: string } = { hasSession: false, targetId: '' }
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'http://127.0.0.1:9222',
      navigateUrl: 'https://www.instagram.com/p/Abc/',
      openNewTab: true,
      keepTabOpen: false,
      getManager,
      resolveTarget: async () => { throw new Error('should not resolve when opening a new tab') },
      noSocketMessage: 'no socket',
    },
    async ({ session, target, openedTabId }) => {
      seen.hasSession = typeof session.send === 'function'
      seen.openedTabId = openedTabId
      seen.targetId = target.id
      await session.send('Runtime.evaluate', { expression: '1' })
      return 'done'
    },
  )
  assert.deepEqual(result, { ok: true, result: 'done' })
  assert.equal(seen.hasSession, true)
  assert.equal(seen.openedTabId, seen.targetId)
})

test('reuse path: attaches to the target returned by resolveTarget', async () => {
  const getManager = fakeGetManager()
  const target: ChromeTarget = { id: 'EXIST', type: 'page', url: 'https://www.instagram.com/', webSocketDebuggerUrl: 'ws://e' }
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'http://127.0.0.1:9222',
      navigateUrl: undefined,
      openNewTab: false,
      keepTabOpen: false,
      getManager,
      resolveTarget: async () => target,
      noSocketMessage: 'no socket',
    },
    async ({ target: t, openedTabId }) => {
      assert.equal(t.id, 'EXIST')
      assert.equal(openedTabId, undefined)
      return 'ok'
    },
  )
  assert.deepEqual(result, { ok: true, result: 'ok' })
})

test('invalid chromeOrigin returns invalid-input', async () => {
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'not-a-url',
      navigateUrl: 'https://x/',
      openNewTab: true,
      keepTabOpen: false,
      getManager: fakeGetManager(),
      resolveTarget: async () => { throw new Error('x') },
      noSocketMessage: 'no socket',
    },
    async () => 'unused',
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'invalid-input')
})

test('resolveTarget failure on reuse path returns tab-not-found', async () => {
  const result = await withCdpCaptureSession<string>(
    {
      chromeOrigin: 'http://127.0.0.1:9222',
      navigateUrl: undefined,
      openNewTab: false,
      keepTabOpen: false,
      getManager: fakeGetManager(),
      resolveTarget: async () => { throw new Error('No Chrome tab') },
      noSocketMessage: 'open the browser',
    },
    async () => 'unused',
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'tab-not-found')
})
