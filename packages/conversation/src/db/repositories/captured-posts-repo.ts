import type { Db } from '../client.js'

export interface CapturedPost {
  id: string
  competitorId: string
  username: string
  postUrl: string
  caption?: string
  likes?: number
  comments?: number
  postedAt?: string                  // ISO timestamp string from IG
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number
  capturedAt: number
  raw?: Record<string, unknown>
}

interface Row {
  id: string
  competitor_id: string
  username: string
  post_url: string
  caption: string | null
  likes: number | null
  comments: number | null
  posted_at: string | null
  media_kind: string | null
  media_url: string | null
  carousel_count: number | null
  captured_at: number
  raw: string | null
}

function toPost(r: Row): CapturedPost {
  return {
    id: r.id,
    competitorId: r.competitor_id,
    username: r.username,
    postUrl: r.post_url,
    caption: r.caption ?? undefined,
    likes: r.likes ?? undefined,
    comments: r.comments ?? undefined,
    postedAt: r.posted_at ?? undefined,
    mediaKind: (r.media_kind as CapturedPost['mediaKind']) ?? undefined,
    mediaUrl: r.media_url ?? undefined,
    carouselCount: r.carousel_count ?? undefined,
    capturedAt: r.captured_at,
    raw: r.raw ? (JSON.parse(r.raw) as Record<string, unknown>) : undefined,
  }
}

export interface ListPostsOpts {
  competitorId?: string
  limit?: number
  orderBy?: 'recent' | 'engagement'
  workspaceId?: string
}

export interface UpdateCapturedPostPatch {
  caption?: string
  likes?: number
  comments?: number
  postedAt?: string
  mediaKind?: CapturedPost['mediaKind']
  mediaUrl?: string
  carouselCount?: number
}

export class CapturedPostsRepo {
  constructor(private db: Db) {}

  upsert(p: CapturedPost): void {
    this.db
      .prepare(`
        INSERT INTO captured_posts (
          id, competitor_id, username, post_url, caption, likes, comments,
          posted_at, media_kind, media_url, carousel_count, captured_at, raw
        ) VALUES (
          @id, @competitorId, @username, @postUrl, @caption, @likes, @comments,
          @postedAt, @mediaKind, @mediaUrl, @carouselCount, @capturedAt, @raw
        )
        ON CONFLICT(competitor_id, post_url) DO UPDATE SET
          caption = excluded.caption,
          likes = excluded.likes,
          comments = excluded.comments,
          posted_at = excluded.posted_at,
          media_kind = excluded.media_kind,
          media_url = excluded.media_url,
          carousel_count = excluded.carousel_count,
          captured_at = excluded.captured_at,
          raw = excluded.raw
      `)
      .run({
        id: p.id,
        competitorId: p.competitorId,
        username: p.username,
        postUrl: p.postUrl,
        caption: p.caption ?? null,
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        postedAt: p.postedAt ?? null,
        mediaKind: p.mediaKind ?? null,
        mediaUrl: p.mediaUrl ?? null,
        carouselCount: p.carouselCount ?? null,
        capturedAt: p.capturedAt,
        raw: p.raw ? JSON.stringify(p.raw) : null,
      })
  }

  upsertMany(posts: CapturedPost[]): { inserted: number } {
    const tx = this.db.transaction((items: CapturedPost[]) => {
      for (const p of items) this.upsert(p)
    })
    tx(posts)
    return { inserted: posts.length }
  }

  list(opts: ListPostsOpts = {}): CapturedPost[] {
    const limit = opts.limit ?? 200
    const order =
      opts.orderBy === 'engagement'
        ? 'COALESCE(cp.likes, 0) DESC, COALESCE(cp.comments, 0) DESC'
        : 'COALESCE(cp.posted_at, \'\') DESC, cp.captured_at DESC'

    const where: string[] = []
    const params: unknown[] = []
    if (opts.competitorId) { where.push('cp.competitor_id = ?'); params.push(opts.competitorId) }
    const join = opts.workspaceId ? 'JOIN competitors c ON c.id = cp.competitor_id' : ''
    if (opts.workspaceId) { where.push('c.workspace_id = ?'); params.push(opts.workspaceId) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sql = `SELECT cp.* FROM captured_posts cp ${join} ${whereSql} ORDER BY ${order} LIMIT ?`
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as Row[]
    return rows.map(toPost)
  }

  findById(id: string): CapturedPost | null {
    const row = this.db
      .prepare('SELECT * FROM captured_posts WHERE id = ?')
      .get(id) as Row | undefined
    return row ? toPost(row) : null
  }

  update(id: string, patch: UpdateCapturedPostPatch): CapturedPost | null {
    const current = this.findById(id)
    if (!current) return null
    const next: CapturedPost = { ...current, ...patch }
    this.db
      .prepare(`
        UPDATE captured_posts SET
          caption = ?,
          likes = ?,
          comments = ?,
          posted_at = ?,
          media_kind = ?,
          media_url = ?,
          carousel_count = ?,
          raw = ?
        WHERE id = ?
      `)
      .run(
        next.caption ?? null,
        next.likes ?? null,
        next.comments ?? null,
        next.postedAt ?? null,
        next.mediaKind ?? null,
        next.mediaUrl ?? null,
        next.carouselCount ?? null,
        next.raw ? JSON.stringify(next.raw) : null,
        id,
      )
    return next
  }

  delete(id: string): CapturedPost | null {
    const current = this.findById(id)
    if (!current) return null
    this.db.prepare('DELETE FROM captured_posts WHERE id = ?').run(id)
    return current
  }

  countForCompetitor(competitorId: string): number {
    const r = this.db
      .prepare('SELECT count(*) AS n FROM captured_posts WHERE competitor_id = ?')
      .get(competitorId) as { n: number }
    return r.n
  }

  countAll(): number {
    const r = this.db
      .prepare('SELECT count(*) AS n FROM captured_posts')
      .get() as { n: number }
    return r.n
  }
}
