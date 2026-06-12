import { describe, it, expect, vi } from 'vitest'
import type { JobProgress } from '@anubis/shared'
import {
  chunk,
  pickChunkDelayMs,
  interruptibleSleep,
  runBatchCapture,
  CAPTURE_CHUNK_SIZE,
  CAPTURE_CHUNK_DELAY_MIN_MS,
  CAPTURE_CHUNK_DELAY_MAX_MS,
  type BatchCaptureTarget,
} from '../src/capture-batch.js'

function targets(n: number): BatchCaptureTarget[] {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, handle: `@user${i}` }))
}

describe('chunk', () => {
  it('splits into max-size chunks (50 / 8 → 7 chunks of 8×6 + 2)', () => {
    const chunks = chunk(targets(50), CAPTURE_CHUNK_SIZE)
    expect(chunks).toHaveLength(7)
    expect(chunks.slice(0, 6).every((ch) => ch.length === 8)).toBe(true)
    expect(chunks[6]).toHaveLength(2)
    // No item is dropped or duplicated.
    expect(chunks.flat()).toHaveLength(50)
  })

  it('handles exact multiples and empty input', () => {
    expect(chunk(targets(16), 8)).toHaveLength(2)
    expect(chunk([], 8)).toHaveLength(0)
    expect(chunk(targets(1), 8)).toHaveLength(1)
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => chunk(targets(3), 0)).toThrow()
    expect(() => chunk(targets(3), -1)).toThrow()
  })
})

describe('pickChunkDelayMs', () => {
  it('maps the RNG across the [min, max] range', () => {
    expect(pickChunkDelayMs(() => 0)).toBe(CAPTURE_CHUNK_DELAY_MIN_MS)
    expect(pickChunkDelayMs(() => 1)).toBe(CAPTURE_CHUNK_DELAY_MAX_MS)
    expect(pickChunkDelayMs(() => 0.5)).toBe(
      Math.round((CAPTURE_CHUNK_DELAY_MIN_MS + CAPTURE_CHUNK_DELAY_MAX_MS) / 2),
    )
  })

  it('honours overridden bounds', () => {
    expect(pickChunkDelayMs(() => 0.5, 1000, 3000)).toBe(2000)
  })
})

describe('interruptibleSleep (mocked timers)', () => {
  it('resolves only after the full delay elapses', async () => {
    vi.useFakeTimers()
    try {
      const ac = new AbortController()
      let done = false
      const p = interruptibleSleep(1000, ac.signal).then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(999)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await p
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves early when the signal aborts before the timer fires', async () => {
    vi.useFakeTimers()
    try {
      const ac = new AbortController()
      let done = false
      const p = interruptibleSleep(60_000, ac.signal).then(() => {
        done = true
      })
      ac.abort()
      await p
      expect(done).toBe(true)
      // The pending timer was cleared — advancing time does nothing extra.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('runBatchCapture', () => {
  it('captures every profile, aggregates counts, and reports chunk/profile progress', async () => {
    const progress: JobProgress[] = []
    const order: string[] = []
    const res = await runBatchCapture({
      competitors: targets(5),
      signal: new AbortController().signal,
      captureOne: async (t) => {
        order.push(t.id)
        return { candidateCount: 2 }
      },
      reportProgress: (p) => progress.push(p),
      reportWarning: () => {},
      sleep: async () => {},
      random: () => 0,
      chunkSize: 2, // 5 → 3 chunks: [2, 2, 1]
      delayMinMs: 3000,
      delayMaxMs: 3000,
    })

    expect(order).toHaveLength(5)
    expect(res).toMatchObject({
      totalProfiles: 5,
      profilesCompleted: 5,
      candidateCount: 10,
      stopped: false,
    })
    expect(res.perCompetitor).toHaveLength(5)
    expect(res.perCompetitor.every((o) => o.ok)).toBe(true)

    // Progress surfaced the total chunk count and the live handle.
    expect(progress.some((p) => p.totalChunks === 3 && p.totalProfiles === 5)).toBe(true)
    expect(progress.some((p) => p.status === 'capturing' && p.chunkIndex === 1)).toBe(true)
    expect(progress.at(-1)?.profilesCompleted).toBe(5)
  })

  it('cools down between chunks with a per-second countdown, but never after the last chunk', async () => {
    const sleepMs: number[] = []
    const progress: JobProgress[] = []
    await runBatchCapture({
      competitors: targets(5), // 3 chunks → 2 cooldowns
      signal: new AbortController().signal,
      captureOne: async () => ({ candidateCount: 0 }),
      reportProgress: (p) => progress.push(p),
      reportWarning: () => {},
      sleep: async (ms) => {
        sleepMs.push(ms)
      },
      random: () => 0,
      chunkSize: 2,
      delayMinMs: 3000, // 3s → 3 one-second ticks per cooldown
      delayMaxMs: 3000,
    })

    // 2 cooldowns × 3 ticks, each a 1000ms sleep — and nothing after chunk 3.
    expect(sleepMs).toEqual([1000, 1000, 1000, 1000, 1000, 1000])
    const ticks = progress
      .filter((p) => p.status === 'delaying-between-chunks')
      .map((p) => p.delaySecondsRemaining)
    expect(ticks).toEqual([3, 2, 1, 3, 2, 1])
  })

  it('stops between chunks and preserves the already-captured chunk', async () => {
    const ac = new AbortController()
    const order: string[] = []
    const res = await runBatchCapture({
      competitors: targets(5), // [id-0,id-1] | [id-2,id-3] | [id-4]
      signal: ac.signal,
      captureOne: async (t) => {
        order.push(t.id)
        // Abort mid-way through the 2nd profile; it should still finish.
        if (t.id === 'id-1') ac.abort()
        return { candidateCount: 1 }
      },
      reportProgress: () => {},
      reportWarning: () => {},
      sleep: async () => {},
      chunkSize: 2,
      delayMinMs: 3000,
      delayMaxMs: 3000,
    })

    // The in-flight profile finished; no later chunk was started; no cooldown ran.
    expect(order).toEqual(['id-0', 'id-1'])
    expect(res.profilesCompleted).toBe(2)
    expect(res.candidateCount).toBe(2)
    expect(res.stopped).toBe(true)
    expect(res.perCompetitor).toHaveLength(2)
  })

  it('stops during the inter-chunk cooldown without starting the next chunk', async () => {
    const ac = new AbortController()
    const order: string[] = []
    let ticks = 0
    const res = await runBatchCapture({
      competitors: targets(4), // 2 chunks → 1 cooldown
      signal: ac.signal,
      captureOne: async (t) => {
        order.push(t.id)
        return { candidateCount: 1 }
      },
      reportProgress: () => {},
      reportWarning: () => {},
      sleep: async () => {
        if (++ticks === 2) ac.abort() // abort partway through the countdown
      },
      chunkSize: 2,
      delayMinMs: 5000,
      delayMaxMs: 5000,
    })

    expect(order).toEqual(['id-0', 'id-1'])
    expect(res.stopped).toBe(true)
    expect(res.profilesCompleted).toBe(2)
  })

  it('captures a chunk concurrently (all calls start before any finishes)', async () => {
    let started = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let maxConcurrentStarted = 0

    const run = runBatchCapture({
      competitors: targets(4), // chunkSize 4 → one burst of 4
      signal: new AbortController().signal,
      captureOne: async () => {
        started++
        maxConcurrentStarted = Math.max(maxConcurrentStarted, started)
        await gate // block until all 4 have started
        return { candidateCount: 1 }
      },
      reportProgress: () => {},
      reportWarning: () => {},
      sleep: async () => {},
      random: () => 0,
      chunkSize: 4,
      delayMinMs: 0,
      delayMaxMs: 0,
    })

    // Let the 4 callbacks reach the gate, then release them all.
    await new Promise((r) => setTimeout(r, 5))
    expect(maxConcurrentStarted).toBe(4) // all 4 in flight at once → parallel
    release()

    const res = await run
    expect(res.profilesCompleted).toBe(4)
    expect(res.candidateCount).toBe(4)
  })

  it('records a failed profile as a warning and continues the run', async () => {
    const warnings: string[] = []
    const res = await runBatchCapture({
      competitors: targets(3),
      signal: new AbortController().signal,
      captureOne: async (t) => {
        if (t.id === 'id-1') throw new Error('crawler boom')
        return { candidateCount: 4 }
      },
      reportProgress: () => {},
      reportWarning: (m) => warnings.push(m),
      sleep: async () => {},
      chunkSize: 8,
      delayMinMs: 0,
      delayMaxMs: 0,
    })

    expect(res.profilesCompleted).toBe(3)
    expect(res.candidateCount).toBe(8)
    expect(res.perCompetitor.find((o) => o.handle === '@user1')).toMatchObject({ ok: false })
    expect(warnings.some((w) => w.includes('crawler boom'))).toBe(true)
  })
})
