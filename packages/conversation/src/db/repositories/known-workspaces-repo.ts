import type { Db } from '../client.js'

export interface KnownWorkspace {
  path: string
  lastUsedAt: number
  createdAt: number
}

interface Row {
  path: string
  last_used_at: number
  created_at: number
}

function toWorkspace(r: Row): KnownWorkspace {
  return { path: r.path, lastUsedAt: r.last_used_at, createdAt: r.created_at }
}

export class KnownWorkspacesRepo {
  constructor(private db: Db) {}

  /** Insert a path on first sight, otherwise bump its last_used_at. */
  remember(path: string, now: number = Date.now()): void {
    this.db.prepare(`
      INSERT INTO known_workspaces (path, last_used_at, created_at)
      VALUES (@path, @now, @now)
      ON CONFLICT(path) DO UPDATE SET last_used_at = @now
    `).run({ path, now })
  }

  list(): KnownWorkspace[] {
    const rows = this.db.prepare(
      'SELECT * FROM known_workspaces ORDER BY last_used_at DESC',
    ).all() as Row[]
    return rows.map(toWorkspace)
  }

  remove(path: string): void {
    this.db.prepare('DELETE FROM known_workspaces WHERE path = ?').run(path)
  }
}
