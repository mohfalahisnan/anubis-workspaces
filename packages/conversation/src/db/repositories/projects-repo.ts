import type { Db } from '../client.js'

export interface Project {
  id: string
  name: string
  emoji?: string
  color?: string
  description?: string
  workdir?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface Row {
  id: string
  name: string
  emoji: string | null
  color: string | null
  description: string | null
  workdir: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toProject(r: Row): Project {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji ?? undefined,
    color: r.color ?? undefined,
    description: r.description ?? undefined,
    workdir: r.workdir ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ProjectsRepo {
  constructor(private db: Db) {}

  insert(p: Project): void {
    this.db.prepare(`
      INSERT INTO projects (id, name, emoji, color, description, workdir, created_at, updated_at, deleted_at)
      VALUES (@id, @name, @emoji, @color, @description, @workdir, @createdAt, @updatedAt, @deletedAt)
    `).run({
      id: p.id,
      name: p.name,
      emoji: p.emoji ?? null,
      color: p.color ?? null,
      description: p.description ?? null,
      workdir: p.workdir ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      deletedAt: p.deletedAt ?? null,
    })
  }

  findById(id: string): Project | null {
    const r = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return r ? toProject(r) : null
  }

  list(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at ASC')
      .all() as Row[]
    return rows.map(toProject)
  }

  update(
    id: string,
    patch: Partial<Omit<Project, 'id' | 'createdAt' | 'deletedAt'>>,
  ): Project | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: Project = { ...cur, ...patch, updatedAt: Date.now() }
    this.db
      .prepare(`
        UPDATE projects SET
          name = ?, emoji = ?, color = ?, description = ?, workdir = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.name,
        next.emoji ?? null,
        next.color ?? null,
        next.description ?? null,
        next.workdir ?? null,
        next.updatedAt,
        id,
      )
    return next
  }

  softDelete(id: string): void {
    if (id === 'default') throw new Error('Cannot delete the default project')
    this.db
      .prepare('UPDATE projects SET deleted_at = ? WHERE id = ?')
      .run(Date.now(), id)
  }
}
