import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SseBroadcaster, type SseEvent } from '../../src/sse/broadcaster.js'

describe('SseBroadcaster', () => {
  it('fans out events to all subscribers of a conversation', () => {
    const b = new SseBroadcaster()
    const received1: SseEvent[] = []
    const received2: SseEvent[] = []
    const sub1 = b.subscribe('c1', e => received1.push(e))
    const sub2 = b.subscribe('c1', e => received2.push(e))
    b.publish('c1', { name: 'partial', data: { deltaText: 'hi' } })
    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
    sub1.unsubscribe(); sub2.unsubscribe()
  })

  it('isolates conversations', () => {
    const b = new SseBroadcaster()
    const got: SseEvent[] = []
    b.subscribe('c1', e => got.push(e))
    b.publish('c2', { name: 'done', data: { finishReason: 'stop' } })
    expect(got).toHaveLength(0)
  })

  it('unsubscribe stops delivery', () => {
    const b = new SseBroadcaster()
    const got: SseEvent[] = []
    const sub = b.subscribe('c1', e => got.push(e))
    sub.unsubscribe()
    b.publish('c1', { name: 'done', data: { finishReason: 'stop' } })
    expect(got).toHaveLength(0)
  })

  it('subscriberCount reflects active subs', () => {
    const b = new SseBroadcaster()
    const s1 = b.subscribe('c1', () => undefined)
    const s2 = b.subscribe('c1', () => undefined)
    expect(b.subscriberCount('c1')).toBe(2)
    s1.unsubscribe()
    expect(b.subscriberCount('c1')).toBe(1)
    s2.unsubscribe()
    expect(b.subscriberCount('c1')).toBe(0)
  })
})

describe('SseBroadcaster — buffering & replay', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('replays buffered events to late subscribers (mid-turn reconnect)', () => {
    const b = new SseBroadcaster()
    b.publish('c1', { name: 'partial', data: { deltaText: 'hel' } })
    b.publish('c1', { name: 'partial', data: { deltaText: 'lo' } })
    const seen: SseEvent[] = []
    const sub = b.subscribe('c1', (e) => seen.push(e))
    expect(sub.replay).toHaveLength(2)
    expect(sub.replay[0]!.data).toEqual({ deltaText: 'hel' })
    expect(sub.replay[1]!.data).toEqual({ deltaText: 'lo' })
    // Live events still fan out after subscribe
    b.publish('c1', { name: 'partial', data: { deltaText: '!' } })
    expect(seen).toHaveLength(1)
  })

  it('replay includes a just-finished turn within the grace window', () => {
    const b = new SseBroadcaster(60_000)
    b.publish('c1', { name: 'partial', data: { deltaText: 'a' } })
    b.publish('c1', { name: 'done', data: { finishReason: 'stop' } })
    vi.advanceTimersByTime(30_000)
    const sub = b.subscribe('c1', () => {})
    expect(sub.replay.map((e) => e.name)).toEqual(['partial', 'done'])
  })

  it('drops the buffer after the grace window expires', () => {
    const b = new SseBroadcaster(60_000)
    b.publish('c1', { name: 'partial', data: { deltaText: 'a' } })
    b.publish('c1', { name: 'done', data: { finishReason: 'stop' } })
    vi.advanceTimersByTime(60_001)
    const sub = b.subscribe('c1', () => {})
    expect(sub.replay).toEqual([])
  })

  it('starts a fresh buffer on a new turn after a terminal event', () => {
    const b = new SseBroadcaster(60_000)
    b.publish('c1', { name: 'partial', data: { deltaText: 'old' } })
    b.publish('c1', { name: 'done', data: { finishReason: 'stop' } })
    // New turn begins inside the grace window
    b.publish('c1', { name: 'partial', data: { deltaText: 'new' } })
    const sub = b.subscribe('c1', () => {})
    expect(sub.replay).toHaveLength(1)
    expect(sub.replay[0]!.data).toEqual({ deltaText: 'new' })
  })

  it('unsubscribe preserves the buffer for a subsequent reconnect', () => {
    const b = new SseBroadcaster()
    const seen: SseEvent[] = []
    const sub = b.subscribe('c1', (e) => seen.push(e))
    b.publish('c1', { name: 'partial', data: { deltaText: 'a' } })
    sub.unsubscribe()
    b.publish('c1', { name: 'partial', data: { deltaText: 'b' } })
    expect(seen).toHaveLength(1)
    const sub2 = b.subscribe('c1', () => {})
    expect(sub2.replay).toHaveLength(2)
  })
})
