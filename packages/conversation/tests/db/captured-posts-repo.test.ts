import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CompetitorsService } from '../../src/competitors/competitors-service.js'
import { CapturedPostsRepo, type CapturedPost } from '../../src/db/repositories/captured-posts-repo.js'
import { createTestDocuments } from '../helpers/documents.js'
import type { MarkdownDocumentStore } from '../../src/documents/document-store.js'

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
  let documents: MarkdownDocumentStore
  let cleanup: () => void

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const context = createTestDocuments(db)
    documents = context.documents
    cleanup = context.cleanup
    const svc = new CompetitorsService(new CompetitorsRepo(db, documents))
    competitorId = svc.create({ handle: '@notion' }).id
    repo = new CapturedPostsRepo(db)
  })

  afterEach(() => cleanup())

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

  it('list respects limit and returns the top rows of the requested order', () => {
    for (let i = 1; i <= 10; i++) {
      repo.upsert(post(competitorId, `/p/P${i}`, i * 10))
    }
    const top = repo.list({ competitorId, orderBy: 'engagement', limit: 3 })
    expect(top).toHaveLength(3)
    expect(top.map((p) => p.postUrl)).toEqual(['/p/P10', '/p/P9', '/p/P8'])
  })

  it('list without competitorId dedups the same URL across competitors before applying limit', () => {
    const svc = new CompetitorsService(new CompetitorsRepo(db, documents))
    const otherId = svc.create({ handle: '@linear' }).id
    repo.upsert(post(competitorId, '/p/SHARED', 100))
    repo.upsert({ ...post(otherId, '/p/SHARED', 50), id: 'id-shared-other' })
    repo.upsert(post(competitorId, '/p/ONLY-A', 80))
    repo.upsert(post(otherId, '/p/ONLY-B', 60))
    const list = repo.list({ orderBy: 'engagement', limit: 10 })
    expect(list.map((p) => p.postUrl).sort()).toEqual(['/p/ONLY-A', '/p/ONLY-B', '/p/SHARED'])
    // First in ORDER BY wins: the higher-engagement copy of the shared post.
    expect(list.find((p) => p.postUrl === '/p/SHARED')?.competitorId).toBe(competitorId)
  })

  it('countForCompetitor counts only that competitor', () => {
    const svc = new CompetitorsService(new CompetitorsRepo(db, documents))
    const otherId = svc.create({ handle: '@linear' }).id
    repo.upsert(post(competitorId, '/p/A', 1))
    repo.upsert(post(competitorId, '/p/B', 2))
    repo.upsert(post(otherId, '/p/C', 3))
    expect(repo.countForCompetitor(competitorId)).toBe(2)
    expect(repo.countForCompetitor(otherId)).toBe(1)
    expect(repo.countForCompetitor('missing')).toBe(0)
  })

  it('countAll dedups the same post URL captured under two competitors', () => {
    const svc = new CompetitorsService(new CompetitorsRepo(db, documents))
    const otherId = svc.create({ handle: '@linear' }).id
    repo.upsert(post(competitorId, '/p/SHARED', 100))
    repo.upsert(post(otherId, 'https://instagram.com/p/SHARED', 50))
    repo.upsert({ ...post(otherId, '/p/SHARED', 50), id: 'id-shared-other' })
    repo.upsert(post(competitorId, '/p/ONLY-A', 80))
    expect(repo.countAll()).toBe(3) // /p/SHARED (x2 competitors), instagram URL, /p/ONLY-A
    expect(repo.countAll()).toBe(repo.list({ limit: 1_000 }).length)
  })

  it('markRefreshedAt updates lastRefreshedAt without touching other fields', () => {
    const svc = new CompetitorsService(new CompetitorsRepo(db, documents))
    svc.update(competitorId, { followers: 1_000 })
    svc.markRefreshedAt(competitorId, 12345)
    const c = svc.get(competitorId)!
    expect(c.lastRefreshedAt).toBe(12345)
    expect(c.followers).toBe(1_000)
  })
})
