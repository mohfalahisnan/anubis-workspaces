import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { WSServer } from '../../src/extension/ws-server.js'

const SECRET = 'a'.repeat(32)

let server: WSServer
let port: number

beforeEach(async () => {
  server = new WSServer({ secret: SECRET, backendVersion: 'test-0.0.0', portRange: [47891, 47900] })
  port = await server.start()
})

afterEach(async () => {
  await server.stop()
})

function connect(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ext`)
}

function waitFor(ws: WebSocket, type: string, timeoutMs = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === type) {
        clearTimeout(timer)
        resolve(msg)
      }
    })
  })
}

describe('WSServer', () => {
  it('accepts a connect with the correct secret and replies with welcome', async () => {
    const ws = connect()
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.1.0' }))
    const welcome = (await waitFor(ws, 'welcome')) as { backendVersion: string }
    expect(welcome.backendVersion).toBe('test-0.0.0')
    expect(server.isConnected()).toBe(true)
    expect(server.connectedExtensionVersion()).toBe('0.1.0')
    ws.close()
  })

  it('rejects a bad secret by closing with 4401', async () => {
    const ws = connect()
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret: 'wrong-secret-1234567890123456', version: '0.1.0' }))
    const close = await new Promise<{ code: number }>((resolve) => {
      ws.on('close', (code) => resolve({ code }))
    })
    expect(close.code).toBe(4401)
    expect(server.isConnected()).toBe(false)
  })

  it('a second hello evicts the first connection (single-client)', async () => {
    const a = connect()
    await new Promise((r) => a.on('open', r))
    a.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.1.0' }))
    await waitFor(a, 'welcome')

    const aClosed = new Promise<number>((resolve) => a.on('close', (code) => resolve(code)))

    const b = connect()
    await new Promise((r) => b.on('open', r))
    b.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.2.0' }))
    await waitFor(b, 'welcome')

    expect(await aClosed).toBe(4409)
    expect(server.connectedExtensionVersion()).toBe('0.2.0')
    b.close()
  })

  it('falls back to a higher port if 47891 is taken', async () => {
    // beforeEach already bound 47891; a fresh server must land on 47892.
    expect(port).toBe(47891)
    const other = new WSServer({ secret: SECRET, backendVersion: 'other', portRange: [47891, 47900] })
    const otherPort = await other.start()
    expect(otherPort).toBe(47892)
    await other.stop()
  })

  it('routes inbound frames through onFrame after handshake completes', async () => {
    const seen: unknown[] = []
    server.onFrame = (frame) => { seen.push(frame) }

    const ws = connect()
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '0.1.0' }))
    await waitFor(ws, 'welcome')

    ws.send(JSON.stringify({ type: 'progress', jobId: 'j1', message: 'half done' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([{ type: 'progress', jobId: 'j1', message: 'half done' }])
    ws.close()
  })
})
