import type { Db } from '../client.js'
import { ProfileConfigSchema, type Profile, type ProfileOverride } from '../../profiles/types.js'

interface Row {
  id: string
  name: string
  description: string | null
  source: 'builtin' | 'user'
  agent: string
  config: string
  sort_order: number
  last_used_at: number | null
  created_at: number
  updated_at: number
}

function toProfile(r: Row): Profile {
  const config = ProfileConfigSchema.parse(JSON.parse(r.config))
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    source: r.source,
    config,
    sortOrder: r.sort_order,
    lastUsedAt: r.last_used_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ProfilesRepo {
  constructor(private db: Db) {}

  upsert(p: Profile): void {
    this.db.prepare(`
      INSERT INTO profiles (id, name, description, source, agent, config, sort_order, last_used_at, created_at, updated_at)
      VALUES (@id, @name, @description, @source, @agent, @config, @sortOrder, @lastUsedAt, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, source=excluded.source,
        agent=excluded.agent, config=excluded.config, sort_order=excluded.sort_order,
        last_used_at=excluded.last_used_at, updated_at=excluded.updated_at
    `).run({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      source: p.source,
      agent: p.config.agent,
      config: JSON.stringify(p.config),
      sortOrder: p.sortOrder,
      lastUsedAt: p.lastUsedAt ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })
  }

  findById(id: string): Profile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Row | undefined
    return row ? toProfile(row) : null
  }

  list(): Profile[] {
    const rows = this.db.prepare(
      'SELECT * FROM profiles ORDER BY sort_order ASC, COALESCE(last_used_at, 0) DESC',
    ).all() as Row[]
    return rows.map(toProfile)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  touchLastUsed(id: string, atMs: number): void {
    this.db.prepare('UPDATE profiles SET last_used_at = ? WHERE id = ?').run(atMs, id)
  }

  setOverride(profileId: string, patch: ProfileOverride, sortOrder: number | undefined): void {
    this.db.prepare(`
      INSERT INTO profile_overrides (profile_id, config_patch, sort_order, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        config_patch=excluded.config_patch,
        sort_order=excluded.sort_order,
        updated_at=excluded.updated_at
    `).run(profileId, JSON.stringify(patch), sortOrder ?? null, Date.now())
  }

  getOverride(profileId: string): { patch: ProfileOverride; sortOrder: number | null } | null {
    const row = this.db.prepare(
      'SELECT config_patch, sort_order FROM profile_overrides WHERE profile_id = ?',
    ).get(profileId) as { config_patch: string; sort_order: number | null } | undefined
    if (!row) return null
    return { patch: JSON.parse(row.config_patch) as ProfileOverride, sortOrder: row.sort_order }
  }

  deleteOverride(profileId: string): void {
    this.db.prepare('DELETE FROM profile_overrides WHERE profile_id = ?').run(profileId)
  }
}
