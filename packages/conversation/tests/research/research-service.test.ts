import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CompetitorsService } from '../../src/competitors/competitors-service.js'
import { CapturedPostsRepo } from '../../src/db/repositories/captured-posts-repo.js'
import { ResearchSessionsRepo } from '../../src/db/repositories/research-sessions-repo.js'
import { ResearchCandidatesRepo } from '../../src/db/repositories/research-candidates-repo.js'
import { ResearchService } from '../../src/research/research-service.js'
import { createTestDocuments } from '../helpers/documents.js'

describe('ResearchService', () => {
  let db: Db
  let competitors: CompetitorsService
  let posts: CapturedPostsRepo
  let svc: ResearchService
  let cleanup: () => void

  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const context = createTestDocuments(db)
    cleanup = context.cleanup
    competitors = new CompetitorsService(new CompetitorsRepo(db, context.documents))
    posts = new CapturedPostsRepo(db)
    svc = new ResearchService({
      competitors,
      capturedPosts: posts,
      sessions: new ResearchSessionsRepo(db),
      candidates: new ResearchCandidatesRepo(db),
    })
  })

  afterEach(() => cleanup())

  function seedGreenCompetitorWithPosts() {
    const c = competitors.create({ handle: '@green', followers: 25_000 }) // green tier
    // baseline pool: likes mostly ~50, one viral 1000 → median 50
    const likes = [40, 45, 50, 50, 55, 60, 1000]
    likes.forEach((n, i) => posts.upsert({
      id: `p${i}`,
      competitorId: c.id,
      username: 'green',
      postUrl: `https://www.instagram.com/p/g${i}/`,
      likes: n,
      postedAt: isoDaysAgo(1),
      capturedAt: Date.now(),
    }))
    return c
  }

  it('recomputes a median baseline and scores candidates by competitor level', async () => {
    const c = seedGreenCompetitorWithPosts()
    const { session, candidates } = await svc.createSession({ projectId: 'default', controls: {} })

    // baseline persisted on the competitor (median of the 7 likes = 50)
    expect(competitors.get(c.id)!.baselineLikes).toBe(50)
    expect(session.status).toBe('done')

    // the viral 1000-like post → score 20 on a green competitor → green candidate
    const viral = candidates.find((x) => x.likes === 1000)!
    expect(viral.score).toBe(20)
    expect(viral.candidateLevel).toBe('green')
    // niche unresolved in Phase A → pending (recency/score/source all pass)
    expect(viral.validationStatus).toBe('pending')

    // a typical 50-like post → score 1 → neutral
    const typical = candidates.find((x) => x.likes === 50)!
    expect(typical.candidateLevel).toBe('neutral')
  })

  it('marks old posts invalid on recency', async () => {
    const c = competitors.create({ handle: '@stale', followers: 25_000 })
    posts.upsert({ id: 'old1', competitorId: c.id, username: 'stale', postUrl: 'https://www.instagram.com/p/old1/', likes: 500, postedAt: isoDaysAgo(30), capturedAt: Date.now() })
    posts.upsert({ id: 'old2', competitorId: c.id, username: 'stale', postUrl: 'https://www.instagram.com/p/old2/', likes: 60, postedAt: isoDaysAgo(30), capturedAt: Date.now() })
    const { candidates } = await svc.createSession({ projectId: 'default', controls: { maxContentAgeDays: 7 } })
    expect(candidates.every((x) => x.validationStatus === 'invalid')).toBe(true)
    expect(candidates[0]!.validationFailures).toContain('recency')
  })

  it('updateCandidate sets the niche verdict and re-evaluates validation', async () => {
    seedGreenCompetitorWithPosts()
    const { candidates } = await svc.createSession({ projectId: 'default', controls: {} })
    const fresh = candidates.find((x) => x.validationStatus === 'pending')!
    const updated = svc.updateCandidate(fresh.id, { nicheAligned: true })!
    expect(updated.nicheAligned).toBe(true)
    expect(updated.validationStatus).toBe('valid')

    const rejected = svc.updateCandidate(fresh.id, { nicheAligned: false })!
    expect(rejected.validationStatus).toBe('invalid')
    expect(rejected.validationFailures).toContain('niche')
  })

  it('respects favoriteOnly and explicit competitorIds filters', async () => {
    const fav = competitors.create({ handle: '@fav', followers: 25_000, favorite: true })
    const other = competitors.create({ handle: '@other', followers: 25_000 })
    for (const c of [fav, other]) {
      posts.upsert({ id: `${c.handle}-1`, competitorId: c.id, username: c.handle, postUrl: `https://www.instagram.com/p/${c.id}/`, likes: 100, postedAt: isoDaysAgo(1), capturedAt: Date.now() })
    }
    const { candidates } = await svc.createSession({ projectId: 'default', controls: { favoriteOnly: true } })
    expect(candidates.every((x) => x.competitorId === fav.id)).toBe(true)
  })
})
