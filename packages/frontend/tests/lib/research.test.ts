import { describe, it, expect } from 'vitest'
import type { CompetitorSummary, ResearchCandidateSummary } from '@anubis/shared'
import { summarizeLibrary, formatScore, candidateValidationReason } from '@/lib/research'

function competitor(partial: Partial<CompetitorSummary>): CompetitorSummary {
  return {
    id: partial.id ?? 'c1',
    handle: partial.handle ?? '@c1',
    postCount: 0,
    addedAt: 0,
    updatedAt: 0,
    platform: partial.platform ?? 'instagram',
    status: partial.status ?? 'active',
    favorite: partial.favorite ?? false,
    niche: partial.niche,
    ...partial,
  }
}

function candidate(partial: Partial<ResearchCandidateSummary>): ResearchCandidateSummary {
  return {
    id: 'r1',
    sessionId: 's1',
    competitorId: 'c1',
    competitorLevel: 'green',
    postId: 'p1',
    candidateLevel: 'green',
    validationStatus: 'valid',
    validationFailures: [],
    decision: 'none',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('summarizeLibrary', () => {
  it('counts totals, favorites, and groups by platform/niche/status', () => {
    const s = summarizeLibrary([
      competitor({ id: 'a', favorite: true, platform: 'instagram', niche: 'Fitness', status: 'active' }),
      competitor({ id: 'b', platform: 'instagram', niche: 'Fitness', status: 'paused' }),
      competitor({ id: 'c', platform: 'tiktok', niche: 'Food', status: 'active' }),
    ])
    expect(s.total).toBe(3)
    expect(s.favorites).toBe(1)
    expect(s.byPlatform).toEqual({ instagram: 2, tiktok: 1 })
    expect(s.byNiche).toEqual({ Fitness: 2, Food: 1 })
    expect(s.byStatus).toEqual({ active: 2, paused: 1 })
  })

  it('buckets a missing niche under "Uncategorized"', () => {
    const s = summarizeLibrary([competitor({ niche: undefined })])
    expect(s.byNiche).toEqual({ Uncategorized: 1 })
  })
})

describe('formatScore', () => {
  it('formats a finite score as a multiplier', () => {
    expect(formatScore(20)).toBe('20.0×')
  })
  it('shows an em dash for missing/non-finite', () => {
    expect(formatScore(undefined)).toBe('—')
    expect(formatScore(null)).toBe('—')
  })
})

describe('candidateValidationReason', () => {
  it('explains a valid candidate', () => {
    expect(candidateValidationReason(candidate({ validationStatus: 'valid' }))).toMatch(/passes/i)
  })
  it('explains a pending candidate', () => {
    expect(candidateValidationReason(candidate({ validationStatus: 'pending' }))).toMatch(/niche/i)
  })
  it('lists failed rules for an invalid candidate', () => {
    const reason = candidateValidationReason(candidate({ validationStatus: 'invalid', validationFailures: ['recency', 'score'] }))
    expect(reason).toMatch(/old/i)
    expect(reason).toMatch(/score/i)
  })
})
