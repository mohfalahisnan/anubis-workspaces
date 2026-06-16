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

  // Insert a research session + a candidate scoring `postId`. The candidate's
  // post_id / competitor_id are NOT NULL FKs back to captured_posts/competitors.
  function seedCandidate(candidateId: string, sessionId: string, postId: string): void {
    db.prepare(`
      INSERT OR IGNORE INTO research_sessions (id, project_id, controls, status, created_at, updated_at)
      VALUES (@sessionId, 'default', '{}', 'done', 1, 1)
    `).run({ sessionId })
    db.prepare(`
      INSERT INTO research_candidates (
        id, project_id, session_id, competitor_id, post_id,
        validation_status, decision, created_at, updated_at
      ) VALUES (@id, 'default', @sessionId, @competitorId, @postId, 'valid', 'none', 1, 1)
    `).run({ id: candidateId, sessionId, competitorId, postId })
  }

  function candidateCount(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM research_candidates').get() as { n: number }).n
  }

  it('FK cascade: deleting a captured post row drops its research candidates (DB-level)', () => {
    repo.upsert(post(competitorId, '/p/A', 100))
    const id = repo.list({ competitorId })[0]!.id
    seedCandidate('cand-A', 'sess-1', id)
    expect(candidateCount()).toBe(1)
    // Raw delete bypasses the repo's transaction — proves the migration's
    // ON DELETE CASCADE, not just the repo-level cleanup.
    db.prepare('DELETE FROM captured_posts WHERE id = ?').run(id)
    expect(candidateCount()).toBe(0)
  })

  it('FK cascade: deleting a competitor drops posts AND their research candidates', () => {
    repo.upsert(post(competitorId, '/p/A', 100))
    const id = repo.list({ competitorId })[0]!.id
    seedCandidate('cand-A', 'sess-1', id)
    expect(candidateCount()).toBe(1)
    // competitor -> captured_posts -> research_candidates must all cascade.
    db.prepare('DELETE FROM competitors WHERE id = ?').run(competitorId)
    expect(repo.countForCompetitor(competitorId)).toBe(0)
    expect(candidateCount()).toBe(0)
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

  it('delete cascades to research candidates that reference the post', () => {
    // The Research Phase scores every captured post into a research_candidate
    // row whose post_id is a NOT NULL FK back to captured_posts. Deleting the
    // post used to fail with "FOREIGN KEY constraint failed" because the
    // candidate (a self-contained snapshot) still pinned the row.
    repo.upsert(post(competitorId, '/p/A', 100))
    const id = repo.list({ competitorId })[0]!.id

    db.prepare(`
      INSERT INTO research_sessions (id, project_id, controls, status, created_at, updated_at)
      VALUES ('sess-1', 'default', '{}', 'done', 1, 1)
    `).run()
    db.prepare(`
      INSERT INTO research_candidates (
        id, project_id, session_id, competitor_id, post_id,
        validation_status, decision, created_at, updated_at
      ) VALUES ('cand-1', 'default', 'sess-1', @competitorId, @postId, 'valid', 'none', 1, 1)
    `).run({ competitorId, postId: id })

    expect(repo.delete(id)?.postUrl).toBe('/p/A')
    expect(repo.countForCompetitor(competitorId)).toBe(0)
    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM research_candidates WHERE post_id = ?')
      .get(id) as { n: number }
    expect(remaining.n).toBe(0)
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
