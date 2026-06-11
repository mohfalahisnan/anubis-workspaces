import { describe, it, expect } from 'vitest'
import { scoreFor, getCandidateLevel, medianLikes } from '../src/index.js'

describe('scoreFor', () => {
  it('divides post likes by the baseline', () => {
    expect(scoreFor(1000, 50)).toBe(20)
  })
  it('returns null when baseline is missing or non-positive', () => {
    expect(scoreFor(1000, 0)).toBeNull()
    expect(scoreFor(1000, null)).toBeNull()
    expect(scoreFor(1000, undefined)).toBeNull()
  })
  it('returns null when likes are missing or non-finite', () => {
    expect(scoreFor(null, 50)).toBeNull()
    expect(scoreFor(Infinity, 50)).toBeNull()
  })
})

describe('getCandidateLevel — green competitor', () => {
  it('green at >=10, yellow at >=5, neutral below 5', () => {
    expect(getCandidateLevel(20, 'green')).toBe('green')
    expect(getCandidateLevel(10, 'green')).toBe('green')
    expect(getCandidateLevel(5, 'green')).toBe('yellow')
    expect(getCandidateLevel(4.9, 'green')).toBe('neutral')
  })
})

describe('getCandidateLevel — yellow competitor', () => {
  it('green at >=20, yellow at >=10, neutral below 10', () => {
    expect(getCandidateLevel(20, 'yellow')).toBe('green')
    expect(getCandidateLevel(10, 'yellow')).toBe('yellow')
    expect(getCandidateLevel(9.9, 'yellow')).toBe('neutral')
  })
})

describe('getCandidateLevel — red competitor (never green)', () => {
  it('caps at yellow at >=20, otherwise neutral', () => {
    expect(getCandidateLevel(100, 'red')).toBe('yellow')
    expect(getCandidateLevel(20, 'red')).toBe('yellow')
    expect(getCandidateLevel(19.9, 'red')).toBe('neutral')
  })
})

describe('getCandidateLevel — black/unknown competitor', () => {
  it('always neutral', () => {
    expect(getCandidateLevel(1000, 'black')).toBe('neutral')
    expect(getCandidateLevel(1000, 'unknown')).toBe('neutral')
  })
})

describe('medianLikes', () => {
  it('returns the middle value for odd counts', () => {
    expect(medianLikes([10, 100, 20])).toBe(20)
  })
  it('averages the two middle values for even counts (rounded)', () => {
    expect(medianLikes([10, 20, 30, 41])).toBe(25) // (20+30)/2
  })
  it('ignores non-finite/negative values', () => {
    expect(medianLikes([10, -5, NaN, 30])).toBe(20)
  })
  it('returns null for an empty set', () => {
    expect(medianLikes([])).toBeNull()
  })
})
