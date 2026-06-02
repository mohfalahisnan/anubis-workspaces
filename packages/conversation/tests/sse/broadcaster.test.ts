import { describe, it, expect } from 'vitest'
import { SseBroadcaster, type SseEvent } from '../../src/sse/broadcaster.js'

describe('SseBroadcaster', () => {
  it('fans out events to all subscribers of a conversation', () => {
    const b = new SseBroadcaster()
    const received1: SseEvent[] = []
    const received2: SseEvent[] = []
    const unsub1 = b.subscribe('c1', e => received1.push(e))
    const unsub2 = b.subscribe('c1', e => received2.push(e))
    b.publish('c1', { name: 'partial', data: { deltaText: 'hi' } })
    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
    unsub1(); unsub2()
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
    const u = b.subscribe('c1', e => got.push(e))
    u()
    b.publish('c1', { name: 'done', data: { finishReason: 'stop' } })
    expect(got).toHaveLength(0)
  })

  it('subscriberCount reflects active subs', () => {
    const b = new SseBroadcaster()
    const u1 = b.subscribe('c1', () => undefined)
    const u2 = b.subscribe('c1', () => undefined)
    expect(b.subscriberCount('c1')).toBe(2)
    u1()
    expect(b.subscriberCount('c1')).toBe(1)
    u2()
    expect(b.subscriberCount('c1')).toBe(0)
  })
})
