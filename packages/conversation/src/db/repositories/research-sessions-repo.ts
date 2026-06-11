import type {
  ResearchControls,
  ResearchSessionCounts,
  ResearchSessionStatus,
} from '@anubis/shared'
import type { Db } from '../client.js'

export interface ResearchSession {
  id: string
  projectId?: string
  controls: ResearchControls
  status: ResearchSessionStatus
  counts?: ResearchSessionCounts
  error?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface Row {
  id: string
  project_id: string | null
  controls: string
  status: string
  counts: string | null
  error: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toSession(r: Row): ResearchSession {
  return {
    id: r.id,
    projectId: r.project_id ?? undefined,
    controls: JSON.parse(r.controls) as ResearchControls,
    status: r.status as ResearchSessionStatus,
    counts: r.counts ? (JSON.parse(r.counts) as ResearchSessionCounts) : undefined,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ResearchSessionsRepo {
  constructor(private db: Db) {}

  insert(s: ResearchSession): void {
    this.db.prepare(`
      INSERT INTO research_sessions (id, project_id, controls, status, counts, error, created_at, updated_at, deleted_at)
      VALUES (@id, @projectId, @controls, @status, @counts, @error, @createdAt, @updatedAt, @deletedAt)
    `).run({
      id: s.id,
      projectId: s.projectId ?? 'default',
      controls: JSON.stringify(s.controls),
      status: s.status,
      counts: s.counts ? JSON.stringify(s.counts) : null,
      error: s.error ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      deletedAt: s.deletedAt ?? null,
    })
  }

  findById(id: string): ResearchSession | null {
    const r = this.db
      .prepare('SELECT * FROM research_sessions WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return r ? toSession(r) : null
  }

  list(projectId?: string): ResearchSession[] {
    const sql = projectId
      ? 'SELECT * FROM research_sessions WHERE deleted_at IS NULL AND project_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM research_sessions WHERE deleted_at IS NULL ORDER BY created_at DESC'
    const rows = (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as Row[]
    return rows.map(toSession)
  }

  update(id: string, patch: Partial<Pick<ResearchSession, 'status' | 'counts' | 'error'>>): ResearchSession | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: ResearchSession = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE research_sessions SET status = ?, counts = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(
      next.status,
      next.counts ? JSON.stringify(next.counts) : null,
      next.error ?? null,
      next.updatedAt,
      id,
    )
    return next
  }
}
