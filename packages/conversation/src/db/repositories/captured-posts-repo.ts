import type { Db } from '../client.js'

export interface CapturedPost {
  id: string
  competitorId: string
  projectId?: string
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
  assetPaths?: {
    absolute: string[]
    relative: string[]
  }
  failedAssets?: string[]
}

interface Row {
  id: string
  competitor_id: string
  project_id: string | null
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
  const raw = r.raw ? (JSON.parse(r.raw) as Record<string, unknown>) : undefined
  return {
    id: r.id,
    competitorId: r.competitor_id,
    projectId: r.project_id ?? undefined,
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
    raw,
    assetPaths: raw?.assetPaths as any,
    failedAssets: raw?.failedAssets as any,
  }
}

function normalisePostUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function postKey(post: Pick<CapturedPost, 'competitorId' | 'postUrl'>): string {
  return `${post.competitorId}\u0000${normalisePostUrl(post.postUrl)}`
}

export interface ListPostsOpts {
  competitorId?: string
  projectId?: string
  limit?: number
  orderBy?: 'recent' | 'engagement'
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
    const postUrl = normalisePostUrl(p.postUrl)
    this.db
      .prepare(`
        INSERT INTO captured_posts (
          id, competitor_id, project_id, username, post_url, caption, likes, comments,
          posted_at, media_kind, media_url, carousel_count, captured_at, raw
        ) VALUES (
          @id, @competitorId, @projectId, @username, @postUrl, @caption, @likes, @comments,
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
        projectId: p.projectId ?? 'default',
        username: p.username,
        postUrl,
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
    const unique = new Map<string, CapturedPost>()
    for (const p of posts) unique.set(postKey(p), p)
    const tx = this.db.transaction((items: CapturedPost[]) => {
      for (const p of items) this.upsert(p)
    })
    const items = [...unique.values()]
    tx(items)
    return { inserted: items.length }
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
    if (opts.projectId) { where.push('cp.project_id = ?'); params.push(opts.projectId) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sql = `SELECT cp.* FROM captured_posts cp ${whereSql} ORDER BY ${order}`
    // Stream rows instead of materializing the whole table: `.iterate()` lets us
    // stop pulling (and JSON.parsing the potentially-large `raw` blob) as soon as
    // we have `limit` deduped posts.
    const rows = this.db.prepare(sql).iterate(...params) as IterableIterator<Row>
    const seen = new Set<string>()
    const out: CapturedPost[] = []
    for (const row of rows) {
      const post = toPost(row)
      const key = opts.competitorId ? postKey(post) : normalisePostUrl(post.postUrl)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(post)
      if (out.length >= limit) break
    }
    return out
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
    // Exact equivalent of the old list()-based dedup count: the unique index
    // uq_captured_posts_url(competitor_id, post_url) plus upsert()'s URL
    // normalisation guarantee no per-competitor duplicates exist in the DB.
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM captured_posts WHERE competitor_id = ?')
      .get(competitorId) as { n: number }
    return row.n
  }

  countAll(): number {
    // Cross-competitor dedup by post URL. Stored post_url values are already
    // normalised by upsert(), so DISTINCT post_url matches the old JS dedup
    // (without the old 10_000-row cap, which silently undercounted).
    const row = this.db
      .prepare('SELECT COUNT(DISTINCT post_url) AS n FROM captured_posts')
      .get() as { n: number }
    return row.n
  }
}
