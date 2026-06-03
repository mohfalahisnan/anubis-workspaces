import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TypedEmitter, type AgentEventMap } from '../../src/events/stream.js'

describe('TypedEmitter', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('does not throw when error is emitted with no listener', () => {
    const e = new TypedEmitter<AgentEventMap>()
    expect(() => e.emit('error', { error: new Error('boom') })).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(consoleSpy.mock.calls[0]?.[0]).toMatch(/swallowed error/)
  })

  it('delivers error to a registered listener and does not log', () => {
    const e = new TypedEmitter<AgentEventMap>()
    const handler = vi.fn()
    e.on('error', handler)
    e.emit('error', { error: new Error('real') })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]?.[0]).toEqual({ error: expect.any(Error) })
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('forwards non-error events normally even with no listener', () => {
    const e = new TypedEmitter<AgentEventMap>()
    expect(() => e.emit('partial', { deltaText: 'hi' })).not.toThrow()
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('off removes a previously registered listener', () => {
    const e = new TypedEmitter<AgentEventMap>()
    const handler = vi.fn()
    e.on('partial', handler)
    e.off('partial', handler)
    e.emit('partial', { deltaText: 'x' })
    expect(handler).not.toHaveBeenCalled()
  })
})
