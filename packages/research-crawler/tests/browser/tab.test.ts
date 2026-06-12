import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTab } from '../../src/core/browser/tab.js'
import { createCommandQueue } from '../../src/core/browser/command-queue.js'
import type { TabRecord } from '../../src/core/browser/tab-registry.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

type Call = { method: string; params?: Record<string, unknown>; sessionId?: string }

function fakeConnection(responder: (c: Call) => unknown): {
  connection: CdpConnection
  calls: Call[]
  emit: (method: string, params: unknown, sessionId?: string) => void
} {
  const calls: Call[] = []
  const handlers: Array<{ key: string; handler: CdpEventHandler }> = []
  const connection: CdpConnection = {
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId })
      return responder({ method, params, sessionId }) as never
    },
    on(method, handler, sessionId) {
      const key = `${sessionId ?? ''}:${method}`
      handlers.push({ key, handler })
      return () => {}
    },
    onClose() {},
    isOpen() { return true },
    close() {},
  }
  const emit = (method: string, params: unknown, sessionId?: string) => {
    for (const h of handlers) if (h.key === `${sessionId ?? ''}:${method}`) void h.handler(params)
  }
  return { connection, calls, emit }
}

const makeRecord = (): TabRecord => ({
  tabId: 'tab-1', targetId: 'T1', sessionId: 'S1', url: 'https://example.com/',
  state: 'open', queue: createCommandQueue(),
})

test('navigate enables Page then navigates, all carrying the sessionId', async () => {
  const { connection, calls } = fakeConnection(() => ({}))
  const tab = createTab({ record: makeRecord(), connection, onClose: async () => {} })
  await tab.navigate('https://example.com/x')
  assert.deepEqual(calls.map((c) => c.method), ['Page.enable', 'Page.navigate'])
  assert.equal(calls[1]!.params!.url, 'https://example.com/x')
  assert.ok(calls.every((c) => c.sessionId === 'S1'))
})

test('evaluate unwraps Runtime.evaluate result value', async () => {
  const { connection } = fakeConnection((c) =>
    c.method === 'Runtime.evaluate' ? { result: { value: 7 } } : {})
  const tab = createTab({ record: makeRecord(), connection, onClose: async () => {} })
  assert.equal(await tab.evaluate<number>('1+6'), 7)
})

test('on() subscribes scoped to this tab session', async () => {
  const { connection, emit } = fakeConnection(() => ({}))
  const tab = createTab({ record: makeRecord(), connection, onClose: async () => {} })
  const seen: unknown[] = []
  tab.on('Network.responseReceived', (p) => seen.push(p))
  emit('Network.responseReceived', { requestId: '9' }, 'S1')
  emit('Network.responseReceived', { requestId: 'other' }, 'SX')
  assert.deepEqual(seen, [{ requestId: '9' }])
})

test('close delegates to onClose once and flips state', async () => {
  const { connection } = fakeConnection(() => ({}))
  const record = makeRecord()
  const closed: string[] = []
  const tab = createTab({ record, connection, onClose: async (id) => { closed.push(id) } })
  await tab.close()
  await tab.close()
  assert.deepEqual(closed, ['tab-1'])
  assert.equal(record.state, 'closed')
})
