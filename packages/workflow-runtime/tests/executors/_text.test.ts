import { describe, it, expect } from 'vitest'
import { firstUpstreamText } from '../../src/executors/_text.js'

describe('firstUpstreamText', () => {
  it('returns a direct string upstream value', () => {
    expect(firstUpstreamText({ a: 'hello' })).toBe('hello')
  })
  it('returns the `text` field of an object upstream value', () => {
    expect(firstUpstreamText({ a: { kind: 'agent', text: 'drafted' } })).toBe('drafted')
  })
  it('returns null when no text is present', () => {
    expect(firstUpstreamText({ a: { kind: 'x', count: 3 } })).toBeNull()
    expect(firstUpstreamText({})).toBeNull()
  })
})
