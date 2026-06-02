import type { Db } from '../client.js'

export interface Competitor {
  id: string
  handle: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount: number
  lastRefreshedAt?: number
  notes?: string
  addedAt: number
  updatedAt: number
  deletedAt?: number
}

interface Row {
  id: string
  handle: string
  display_name: string | null
  niche: string | null
  tint: string | null
  followers: number | null
  avg_likes: number | null
  post_count: number
  last_refreshed_at: number | null
  notes: string | null
  added_at: number
  updated_at: number
  deleted_at: number | null
}

function toCompetitor(r: Row): Competitor {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name ?? undefined,
    niche: r.niche ?? undefined,
    tint: r.tint ?? undefined,
    followers: r.followers ?? undefined,
    avgLikes: r.avg_likes ?? undefined,
    postCount: r.post_count,
    lastRefreshedAt: r.last_refreshed_at ?? undefined,
    notes: r.notes ?? undefined,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class CompetitorsRepo {
  constructor(private db: Db) {}

  insert(c: Competitor): void {
    this.db.prepare(`
      INSERT INTO competitors (
        id, handle, display_name, niche, tint, followers, avg_likes,
        post_count, last_refreshed_at, notes, added_at, updated_at, deleted_at
      ) VALUES (
        @id, @handle, @displayName, @niche, @tint, @followers, @avgLikes,
        @postCount, @lastRefreshedAt, @notes, @addedAt, @updatedAt, @deletedAt
      )
    `).run({
      id: c.id,
      handle: c.handle,
      displayName: c.displayName ?? null,
      niche: c.niche ?? null,
      tint: c.tint ?? null,
      followers: c.followers ?? null,
      avgLikes: c.avgLikes ?? null,
      postCount: c.postCount,
      lastRefreshedAt: c.lastRefreshedAt ?? null,
      notes: c.notes ?? null,
      addedAt: c.addedAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    })
  }

  findById(id: string): Competitor | null {
    const r = this.db
      .prepare('SELECT * FROM competitors WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return r ? toCompetitor(r) : null
  }

  findByHandle(handle: string): Competitor | null {
    const r = this.db
      .prepare('SELECT * FROM competitors WHERE handle = ? AND deleted_at IS NULL')
      .get(handle) as Row | undefined
    return r ? toCompetitor(r) : null
  }

  list(): Competitor[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM competitors WHERE deleted_at IS NULL ORDER BY added_at DESC',
      )
      .all() as Row[]
    return rows.map(toCompetitor)
  }

  update(
    id: string,
    patch: Partial<Omit<Competitor, 'id' | 'handle' | 'addedAt' | 'deletedAt'>>,
  ): Competitor | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: Competitor = { ...cur, ...patch, updatedAt: Date.now() }
    this.db
      .prepare(`
        UPDATE competitors SET
          display_name = ?, niche = ?, tint = ?, followers = ?,
          avg_likes = ?, post_count = ?, last_refreshed_at = ?, notes = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.displayName ?? null,
        next.niche ?? null,
        next.tint ?? null,
        next.followers ?? null,
        next.avgLikes ?? null,
        next.postCount,
        next.lastRefreshedAt ?? null,
        next.notes ?? null,
        next.updatedAt,
        id,
      )
    return next
  }

  softDelete(id: string): void {
    this.db
      .prepare('UPDATE competitors SET deleted_at = ? WHERE id = ?')
      .run(Date.now(), id)
  }
}
