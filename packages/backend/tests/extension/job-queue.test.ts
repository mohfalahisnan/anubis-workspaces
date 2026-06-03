import { describe, it, expect, vi } from 'vitest'
import { JobQueue, EXTENSION_OFFLINE, EXTENSION_TIMEOUT, EXTENSION_ERROR } from '../../src/extension/job-queue.js'

function makeQueue() {
  const sent: unknown[] = []
  const queue = new JobQueue({
    send: (frame) => { sent.push(frame); return true },
    isConnected: () => true,
  })
  return { queue, sent }
}

describe('JobQueue', () => {
  it('dispatch resolves when a matching result arrives', async () => {
    const { queue, sent } = makeQueue()
    const p = queue.dispatch({ kind: 'capture-profile', input: { username: 'foo' }, timeoutMs: 5000 })
    const dispatched = sent[0] as { type: 'dispatch'; jobId: string }
    expect(dispatched.type).toBe('dispatch')
    queue.handleFrame({ type: 'result', jobId: dispatched.jobId, ok: true, data: { hello: 'world' } })
    expect(await p).toEqual({ hello: 'world' })
  })

  it('dispatch rejects with EXTENSION_ERROR on an error frame', async () => {
    const { queue, sent } = makeQueue()
    const p = queue.dispatch({ kind: 'discover', input: { source: 'explore' }, timeoutMs: 5000 })
    const dispatched = sent[0] as { type: 'dispatch'; jobId: string }
    queue.handleFrame({ type: 'error', jobId: dispatched.jobId, ok: false, code: 'IG_RATE_LIMIT', message: '429' })
    await expect(p).rejects.toMatchObject({ code: EXTENSION_ERROR, inner: { code: 'IG_RATE_LIMIT', message: '429' } })
  })

  it('dispatch rejects with EXTENSION_OFFLINE when no client connected', async () => {
    const queue = new JobQueue({ send: () => false, isConnected: () => false })
    await expect(queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 5000 }))
      .rejects.toMatchObject({ code: EXTENSION_OFFLINE })
  })

  it('dispatch rejects with EXTENSION_TIMEOUT after timeoutMs', async () => {
    vi.useFakeTimers()
    try {
      const { queue } = makeQueue()
      const p = queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 100 })
      vi.advanceTimersByTime(150)
      await expect(p).rejects.toMatchObject({ code: EXTENSION_TIMEOUT })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel(jobId) sends a cancel frame and rejects the pending promise', async () => {
    const { queue, sent } = makeQueue()
    const p = queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 5000 })
    const dispatched = sent[0] as { type: 'dispatch'; jobId: string }
    queue.cancel(dispatched.jobId)
    expect(sent[1]).toMatchObject({ type: 'cancel', jobId: dispatched.jobId })
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('disconnectAll() rejects every pending job with EXTENSION_OFFLINE', async () => {
    const { queue } = makeQueue()
    const a = queue.dispatch({ kind: 'discover', input: {}, timeoutMs: 5000 })
    const b = queue.dispatch({ kind: 'capture-profile', input: { username: 'x' }, timeoutMs: 5000 })
    queue.disconnectAll()
    await expect(a).rejects.toMatchObject({ code: EXTENSION_OFFLINE })
    await expect(b).rejects.toMatchObject({ code: EXTENSION_OFFLINE })
  })
})
