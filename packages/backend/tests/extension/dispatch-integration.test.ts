import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-ext-int-'))
  process.env.ANUBIS_DATA_DIR = dataDir
  const { default: app } = await import('../../src/app.js')
  await app.request('/extension/status')
})

afterAll(async () => {
  const { shutdownStack } = await import('../../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('end-to-end extension dispatch over real WS', () => {
  it('a paired client receives dispatched jobs and routes results back', async () => {
    const { default: app } = await import('../../src/app.js')
    const { getJobQueue, getStack } = await import('../../src/services.js')

    const port = getStack().appConfig.get().extensionPort!
    const secret = getStack().appConfig.get().extensionSecret!

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ext`)
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', secret, version: '0.0.0-test' }))
    await new Promise<void>((r) => ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'welcome') r()
    }))

    const queue = getJobQueue()!
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'dispatch') {
        ws.send(JSON.stringify({
          type: 'result',
          jobId: m.jobId,
          ok: true,
          data: { echoed: m.input },
        }))
      }
    })

    const result = await queue.dispatch({
      kind: 'capture-profile',
      input: { username: 'someone', maxResponses: 5 },
      timeoutMs: 3000,
    })
    expect(result).toEqual({ echoed: { username: 'someone', maxResponses: 5 } })

    ws.close()

    await new Promise((r) => setTimeout(r, 100))
    const res = await app.request('/extension/status')
    const body = (await res.json()) as { status: { connected: boolean } }
    expect(body.status.connected).toBe(false)
  })
})
