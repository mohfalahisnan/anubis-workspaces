import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectCdpConnection } from '../../src/core/browser/cdp-connection.js'

/** Minimal scriptable fake WebSocket matching the connection's WebSocketLike. */
class FakeSocket {
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, Array<(e: any) => void>> = {}
  constructor(public url: string) {}
  addEventListener(type: string, listener: (e: any) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.emit('close', {}) }
  open() { this.readyState = 1; this.emit('open', {}) }
  emit(type: string, event: any) { for (const l of this.listeners[type] ?? []) l(event) }
  /** Push an inbound CDP message as if Chrome sent it. */
  inbound(message: unknown) { this.emit('message', { data: JSON.stringify(message) }) }
}

function makeConnection() {
  let socket!: FakeSocket
  const ctor = function (url: string) { socket = new FakeSocket(url); queueMicrotask(() => socket.open()); return socket } as any
  return { connect: connectCdpConnection('ws://browser', ctor), getSocket: () => socket }
}

test('send routes a command response back by id', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const pending = connection.send('Target.createTarget', { url: 'about:blank' })
  const sent = JSON.parse(socket.sent[0]!)
  assert.equal(sent.method, 'Target.createTarget')
  assert.equal(sent.params.url, 'about:blank')
  socket.inbound({ id: sent.id, result: { targetId: 'T1' } })
  assert.deepEqual(await pending, { targetId: 'T1' })
})

test('send includes sessionId when provided', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  void connection.send('Page.navigate', { url: 'x' }, 'S1')
  assert.equal(JSON.parse(socket.sent[0]!).sessionId, 'S1')
})

test('events are demuxed to the handler for the matching sessionId only', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const a: unknown[] = []
  const b: unknown[] = []
  connection.on('Network.responseReceived', (p) => a.push(p), 'SA')
  connection.on('Network.responseReceived', (p) => b.push(p), 'SB')
  socket.inbound({ method: 'Network.responseReceived', params: { requestId: '1' }, sessionId: 'SA' })
  socket.inbound({ method: 'Network.responseReceived', params: { requestId: '2' }, sessionId: 'SB' })
  assert.deepEqual(a, [{ requestId: '1' }])
  assert.deepEqual(b, [{ requestId: '2' }])
})

test('unsubscribe stops further event delivery', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const seen: unknown[] = []
  const off = connection.on('Target.targetCreated', (p) => seen.push(p))
  off()
  socket.inbound({ method: 'Target.targetCreated', params: { x: 1 } })
  assert.deepEqual(seen, [])
})

test('socket close rejects all pending commands', async () => {
  const { connect, getSocket } = makeConnection()
  const connection = await connect
  const socket = getSocket()
  const pending = connection.send('Target.createTarget')
  socket.close()
  await assert.rejects(pending, /closed/i)
  assert.equal(connection.isOpen(), false)
})
