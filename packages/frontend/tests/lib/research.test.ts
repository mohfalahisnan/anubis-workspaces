import { describe, it, expect } from 'vitest'
import type { CompetitorSummary, ResearchCandidateSummary } from '@anubis/shared'
import {
  summarizeLibrary,
  formatScore,
  candidateValidationReason,
  resolveDateBounds,
  filterCandidatesByDate,
  DEFAULT_DATE_FILTER,
} from '@/lib/research'

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

const NOW = Date.parse('2026-06-23T12:00:00Z')
const DAY = 86_400_000

describe('resolveDateBounds', () => {
  it('returns no bounds for the "all" preset', () => {
    expect(resolveDateBounds({ preset: 'all' }, NOW)).toEqual({ fromMs: null, toMs: null })
    expect(resolveDateBounds(DEFAULT_DATE_FILTER, NOW)).toEqual({ fromMs: null, toMs: null })
  })

  it('returns an N-day lower bound for the day presets', () => {
    expect(resolveDateBounds({ preset: '7d' }, NOW)).toEqual({ fromMs: NOW - 7 * DAY, toMs: null })
    expect(resolveDateBounds({ preset: '30d' }, NOW)).toEqual({ fromMs: NOW - 30 * DAY, toMs: null })
    expect(resolveDateBounds({ preset: '90d' }, NOW)).toEqual({ fromMs: NOW - 90 * DAY, toMs: null })
  })

  it('resolves a custom from/to to inclusive local day bounds', () => {
    const { fromMs, toMs } = resolveDateBounds({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' }, NOW)
    expect(fromMs).toBe(new Date('2026-06-01T00:00:00').getTime())
    expect(toMs).toBe(new Date('2026-06-30T23:59:59.999').getTime())
  })

  it('treats a missing custom bound as open-ended', () => {
    expect(resolveDateBounds({ preset: 'custom', from: '2026-06-01' }, NOW).toMs).toBeNull()
    expect(resolveDateBounds({ preset: 'custom', to: '2026-06-30' }, NOW).fromMs).toBeNull()
    expect(resolveDateBounds({ preset: 'custom' }, NOW)).toEqual({ fromMs: null, toMs: null })
  })
})

describe('filterCandidatesByDate', () => {
  it('returns every candidate (incl. those with no postedAt) when no bound is active', () => {
    const all = [
      candidate({ id: 'a', postedAt: '2020-01-01T00:00:00Z' }),
      candidate({ id: 'b', postedAt: undefined }),
    ]
    expect(filterCandidatesByDate(all, { preset: 'all' }, NOW)).toEqual(all)
  })

  it('keeps recent candidates and drops older ones for a day preset', () => {
    const recent = candidate({ id: 'recent', postedAt: new Date(NOW - 1 * DAY).toISOString() })
    const old = candidate({ id: 'old', postedAt: new Date(NOW - 100 * DAY).toISOString() })
    const kept = filterCandidatesByDate([recent, old], { preset: '7d' }, NOW)
    expect(kept.map((c) => c.id)).toEqual(['recent'])
  })

  it('hides candidates with a missing or unparseable postedAt while a filter is active', () => {
    const noDate = candidate({ id: 'no-date', postedAt: undefined })
    const badDate = candidate({ id: 'bad-date', postedAt: 'not-a-date' })
    const good = candidate({ id: 'good', postedAt: new Date(NOW - 1 * DAY).toISOString() })
    const kept = filterCandidatesByDate([noDate, badDate, good], { preset: '30d' }, NOW)
    expect(kept.map((c) => c.id)).toEqual(['good'])
  })

  it('applies inclusive custom from/to bounds', () => {
    const before = candidate({ id: 'before', postedAt: '2026-05-15T12:00:00Z' })
    const inside = candidate({ id: 'inside', postedAt: '2026-06-15T12:00:00Z' })
    const nearEnd = candidate({ id: 'near-end', postedAt: '2026-06-29T12:00:00Z' })
    const after = candidate({ id: 'after', postedAt: '2026-07-15T12:00:00Z' })
    const kept = filterCandidatesByDate(
      [before, inside, nearEnd, after],
      { preset: 'custom', from: '2026-06-01', to: '2026-06-30' },
      NOW,
    )
    expect(kept.map((c) => c.id)).toEqual(['inside', 'near-end'])
  })
})
