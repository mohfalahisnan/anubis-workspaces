import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CompetitorsService } from '../../src/competitors/competitors-service.js'
import { CapturedPostsRepo, type CapturedPost } from '../../src/db/repositories/captured-posts-repo.js'

function post(competitorId: string, postUrl: string, likes: number, postedAt = '2026-06-01T00:00:00Z'): CapturedPost {
  return {
    id: `id-${postUrl}`,
    competitorId,
    username: 'someone',
    postUrl,
    caption: 'A caption',
    likes,
    comments: 12,
    postedAt,
    mediaKind: 'image',
    capturedAt: 1,
  }
}

describe('CapturedPostsRepo', () => {
  let db: Db
  let repo: CapturedPostsRepo
  let competitorId: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const svc = new CompetitorsService(new CompetitorsRepo(db))
    competitorId = svc.create({ handle: '@notion' }).id
    repo = new CapturedPostsRepo(db)
  })

  it('upsert is idempotent on (competitor_id, post_url) — second insert updates fields', () => {
    repo.upsert(post(competitorId, '/p/AAA', 100))
    repo.upsert(post(competitorId, '/p/AAA', 250))
    expect(repo.countForCompetitor(competitorId)).toBe(1)
    expect(repo.list({ competitorId })[0]!.likes).toBe(250)
  })

  it('normalises post URLs so query strings and trailing slashes do not duplicate posts', () => {
    repo.upsert(post(competitorId, 'https://instagram.com/p/AAA/?igsh=one', 100))
    repo.upsert(post(competitorId, 'https://instagram.com/p/AAA', 250))
    expect(repo.countForCompetitor(competitorId)).toBe(1)
    expect(repo.list({ competitorId })[0]).toMatchObject({
      postUrl: 'https://instagram.com/p/AAA',
      likes: 250,
    })
  })

  it('list ordered by recent uses posted_at first then captured_at', () => {
    repo.upsert(post(competitorId, '/p/A', 10, '2026-01-01T00:00:00Z'))
    repo.upsert(post(competitorId, '/p/B', 20, '2026-06-01T00:00:00Z'))
    repo.upsert(post(competitorId, '/p/C', 5, '2026-03-01T00:00:00Z'))
    const list = repo.list({ competitorId, orderBy: 'recent' })
    expect(list.map(p => p.postUrl)).toEqual(['/p/B', '/p/C', '/p/A'])
  })

  it('list ordered by engagement uses likes desc then comments', () => {
    repo.upsert(post(competitorId, '/p/A', 100))
    repo.upsert(post(competitorId, '/p/B', 50))
    repo.upsert(post(competitorId, '/p/C', 200))
    const list = repo.list({ competitorId, orderBy: 'engagement' })
    expect(list.map(p => p.postUrl)).toEqual(['/p/C', '/p/A', '/p/B'])
  })

  it('cascading delete: removing the competitor row drops their posts', () => {
    repo.upsert(post(competitorId, '/p/A', 100))
    repo.upsert(post(competitorId, '/p/B', 50))
    expect(repo.countForCompetitor(competitorId)).toBe(2)
    // Hard delete via raw SQL to test the FK cascade (the service soft-deletes).
    db.prepare('DELETE FROM competitors WHERE id = ?').run(competitorId)
    expect(repo.countForCompetitor(competitorId)).toBe(0)
  })

  it('upsertMany is wrapped in a single transaction (atomic)', () => {
    repo.upsertMany([
      post(competitorId, '/p/A', 1),
      post(competitorId, '/p/B', 2),
      post(competitorId, '/p/C', 3),
    ])
    expect(repo.countAll()).toBe(3)
  })

  it('update patches editable fields without changing ownership', () => {
    repo.upsert(post(competitorId, '/p/A', 1))
    const id = repo.list({ competitorId })[0]!.id
    const updated = repo.update(id, {
      caption: 'Edited',
      likes: 42,
      mediaKind: 'video',
    })
    expect(updated?.competitorId).toBe(competitorId)
    expect(updated?.caption).toBe('Edited')
    expect(updated?.likes).toBe(42)
    expect(updated?.mediaKind).toBe('video')
  })

  it('delete removes one captured post by id', () => {
    repo.upsert(post(competitorId, '/p/A', 1))
    repo.upsert(post(competitorId, '/p/B', 2))
    const id = repo.list({ competitorId }).find((p) => p.postUrl === '/p/A')!.id
    expect(repo.delete(id)?.postUrl).toBe('/p/A')
    expect(repo.countForCompetitor(competitorId)).toBe(1)
    expect(repo.delete(id)).toBeNull()
  })

  it('markRefreshedAt updates lastRefreshedAt without touching other fields', () => {
    const svc = new CompetitorsService(new CompetitorsRepo(db))
    svc.update(competitorId, { followers: 1_000 })
    svc.markRefreshedAt(competitorId, 12345)
    const c = svc.get(competitorId)!
    expect(c.lastRefreshedAt).toBe(12345)
    expect(c.followers).toBe(1_000)
  })
})
