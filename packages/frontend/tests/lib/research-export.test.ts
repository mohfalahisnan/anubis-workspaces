import { describe, it, expect } from 'vitest'
import type { CompetitorSummary, ResearchCandidateSummary } from '@anubis/shared'
import { buildResearchExport } from '@/lib/research-export'

function competitor(p: Partial<CompetitorSummary>): CompetitorSummary {
  return {
    id: 'c1',
    handle: '@creator',
    postCount: 5,
    addedAt: 0,
    updatedAt: 0,
    platform: 'instagram',
    status: 'active',
    favorite: false,
    followers: 25_000,
    avgLikes: 1_200,
    baselineLikes: 800,
    ...p,
  }
}

function candidate(p: Partial<ResearchCandidateSummary>): ResearchCandidateSummary {
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
    likes: 4_000,
    baselineLikes: 800,
    score: 5,
    postUrl: 'https://www.instagram.com/p/x/',
    postedAt: '2026-06-15T12:00:00Z',
    caption: 'a detailed post',
    ...p,
  }
}

const competitorById = new Map<string, CompetitorSummary>([['c1', competitor({})]])
const project = { id: 'default', name: 'Default Project' }
const filters = { date: { preset: 'all' as const }, validation: 'all', level: 'all' }

describe('buildResearchExport', () => {
  it('wraps candidates in a tagged, versioned envelope with metadata', () => {
    const file = buildResearchExport({
      candidates: [candidate({})],
      competitorById,
      project,
      filters,
      exportedAt: 1_700_000_000_000,
    })
    expect(file.kind).toBe('anubis-research-export')
    expect(file.schemaVersion).toBe(1)
    expect(file.exportedAt).toBe(1_700_000_000_000)
    expect(file.project).toEqual(project)
    expect(file.filters).toEqual(filters)
    expect(file.count).toBe(1)
    expect(file.posts).toHaveLength(1)
  })

  it('exports each candidate as a detailed post with all candidate fields preserved', () => {
    const c = candidate({ caption: 'keep me', score: 12.5 })
    const file = buildResearchExport({ candidates: [c], competitorById, project, filters, exportedAt: 0 })
    const post = file.posts[0]!
    expect(post.id).toBe(c.id)
    expect(post.caption).toBe('keep me')
    expect(post.score).toBe(12.5)
    expect(post.postedAt).toBe(c.postedAt)
    expect(post.validationStatus).toBe('valid')
  })

  it('enriches each post with resolved competitor context', () => {
    const file = buildResearchExport({ candidates: [candidate({})], competitorById, project, filters, exportedAt: 0 })
    expect(file.posts[0]!.competitor).toMatchObject({
      handle: '@creator',
      followers: 25_000,
      avgLikes: 1_200,
      baselineLikes: 800,
    })
  })

  it('leaves competitor undefined when the competitor is not in the map', () => {
    const file = buildResearchExport({
      candidates: [candidate({ competitorId: 'missing' })],
      competitorById,
      project,
      filters,
      exportedAt: 0,
    })
    expect(file.posts[0]!.competitor).toBeUndefined()
  })

  it('exports exactly the candidates it is given (caller pre-filters)', () => {
    const file = buildResearchExport({
      candidates: [candidate({ id: 'a' }), candidate({ id: 'b' })],
      competitorById,
      project,
      filters,
      exportedAt: 0,
    })
    expect(file.count).toBe(2)
    expect(file.posts.map((p) => p.id)).toEqual(['a', 'b'])
  })
})
