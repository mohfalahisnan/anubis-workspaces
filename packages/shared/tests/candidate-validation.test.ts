import { describe, it, expect } from 'vitest'
import { evaluateCandidateValidation } from '../src/index.js'

const NOW = 1_700_000_000_000 // fixed "now" for deterministic recency
const dayMs = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const base = {
  baselineLikes: 50,
  score: 20,
  competitorActive: true,
  nicheAligned: true as boolean | null,
  maxContentAgeDays: 7,
  nowMs: NOW,
}

describe('evaluateCandidateValidation', () => {
  it('is valid when every rule passes', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(2 * dayMs) })
    expect(r.status).toBe('valid')
    expect(r.failures).toEqual([])
  })

  it('fails recency when older than maxContentAgeDays', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(8 * dayMs) })
    expect(r.status).toBe('invalid')
    expect(r.failures).toContain('recency')
  })

  it('fails recency when postedAt is missing', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: undefined })
    expect(r.failures).toContain('recency')
  })

  it('fails score when baseline is non-positive or score missing', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), baselineLikes: 0, score: null })
    expect(r.failures).toContain('score')
  })

  it('fails source when the competitor is inactive', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), competitorActive: false })
    expect(r.failures).toContain('source')
  })

  it('fails niche when explicitly not aligned', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), nicheAligned: false })
    expect(r.status).toBe('invalid')
    expect(r.failures).toContain('niche')
  })

  it('is pending when only niche is unresolved (null) and all else passes', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), nicheAligned: null })
    expect(r.status).toBe('pending')
    expect(r.failures).toEqual([])
  })

  it('is invalid (not pending) when a hard rule fails even if niche is unresolved', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(99 * dayMs), nicheAligned: null })
    expect(r.status).toBe('invalid')
    expect(r.failures).toContain('recency')
  })
})
