import { describe, it, expect } from 'vitest'
import { toBlob, fromBlob, cosine } from '../../src/embedding/vector.js'

describe('vector utils', () => {
  it('round-trips a Float32Array through a BLOB', () => {
    const v = Float32Array.from([0.1, -0.2, 0.3, 0.4])
    const back = fromBlob(toBlob(v))
    expect(Array.from(back)).toHaveLength(4)
    for (let i = 0; i < v.length; i++) {
      expect(back[i]).toBeCloseTo(v[i]!, 6)
    }
  })

  it('cosine of identical vectors is 1', () => {
    const v = Float32Array.from([1, 2, 3])
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })

  it('cosine of orthogonal vectors is 0', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6)
  })

  it('cosine returns 0 when either vector is all zeros', () => {
    expect(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0)
  })
})
