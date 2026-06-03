import { describe, it, expect } from 'vitest'
import { PORT_RANGE } from '../src/wire.js'

describe('wire constants', () => {
  it('PORT_RANGE covers 47891..47900 inclusive', () => {
    expect(PORT_RANGE[0]).toBe(47891)
    expect(PORT_RANGE[PORT_RANGE.length - 1]).toBe(47900)
    expect(PORT_RANGE.length).toBe(10)
  })
})
