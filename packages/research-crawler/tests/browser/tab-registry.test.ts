import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTabRegistry, type TabRecord } from '../../src/core/browser/tab-registry.js'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'

const record = (over: Partial<TabRecord> = {}): TabRecord => ({
  tabId: 'tab-1',
  targetId: 'T1',
  sessionId: 'S1',
  url: 'https://example.com/',
  state: 'open',
  queue: createCommandQueue(),
  ...over,
})

test('add/get/list/remove by tabId', () => {
  const reg = createTabRegistry()
  reg.add(record())
  assert.equal(reg.get('tab-1')?.targetId, 'T1')
  assert.equal(reg.list().length, 1)
  reg.remove('tab-1')
  assert.equal(reg.get('tab-1'), undefined)
  assert.equal(reg.list().length, 0)
})

test('lookup by targetId and sessionId', () => {
  const reg = createTabRegistry()
  reg.add(record({ tabId: 'tab-2', targetId: 'T2', sessionId: 'S2' }))
  assert.equal(reg.getByTargetId('T2')?.tabId, 'tab-2')
  assert.equal(reg.getBySessionId('S2')?.tabId, 'tab-2')
  assert.equal(reg.getByTargetId('nope'), undefined)
})
