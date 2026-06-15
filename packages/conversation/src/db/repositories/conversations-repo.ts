import type { Db } from '../client.js'
import {
  ConversationExtraSchema, type Conversation, type ConversationStatus,
} from '../../conversations/types.js'

interface Row {
  id: string
  title: string
  agent: string
  status: string
  profile_id: string | null
  project_id: string | null
  workspace_path: string
  extra: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toConv(r: Row): Conversation {
  return {
    id: r.id,
    title: r.title,
    agent: r.agent as Conversation['agent'],
    status: r.status as ConversationStatus,
    profileId: r.profile_id ?? undefined,
    projectId: r.project_id ?? undefined,
    workspacePath: r.workspace_path,
    extra: ConversationExtraSchema.parse(JSON.parse(r.extra)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ConversationsRepo {
  constructor(private db: Db) {}

  insert(c: Conversation): void {
    this.db.prepare(`
      INSERT INTO conversations (id, title, agent, status, profile_id, project_id, workspace_path, extra, created_at, updated_at, deleted_at)
      VALUES (@id, @title, @agent, @status, @profileId, @projectId, @workspacePath, @extra, @createdAt, @updatedAt, @deletedAt)
    `).run({
      id: c.id, title: c.title, agent: c.agent, status: c.status,
      profileId: c.profileId ?? null, projectId: c.projectId ?? 'default',
      workspacePath: c.workspacePath,
      extra: JSON.stringify(c.extra), createdAt: c.createdAt, updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    })
  }

  findById(id: string): Conversation | null {
    const r = this.db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    return r ? toConv(r) : null
  }

  list(opts: { limit: number; archived?: boolean; source?: 'manual' | 'workflow' | 'content-generation'; projectId?: string }): Conversation[] {
    const where: string[] = ['deleted_at IS NULL']
    const params: unknown[] = []
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId) }
    const rows = this.db.prepare(`
      SELECT * FROM conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC
    `).all(...params) as Row[]
    let convs = rows.map(toConv)
    if (opts.archived !== undefined) {
      convs = convs.filter(c => (c.extra.archived ?? false) === opts.archived)
    }
    if (opts.source !== undefined) {
      convs = convs.filter(c => (c.extra.source ?? 'manual') === opts.source)
    } else {
      // Keep generation logs out of the default list; they're reachable via an
      // explicit source filter or a direct link from Content Studio.
      convs = convs.filter(c => c.extra.source !== 'content-generation')
    }
    return convs.slice(0, opts.limit)
  }

  updateStatus(id: string, status: ConversationStatus): void {
    this.db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  updateFields(
    id: string,
    patch: {
      title?: string
      extra?: Conversation['extra']
      profileId?: string | null
      workspacePath?: string
    },
  ): void {
    const cur = this.findById(id)
    if (!cur) return
    const profileId = patch.profileId === undefined ? cur.profileId ?? null : patch.profileId
    this.db.prepare(`
      UPDATE conversations SET
        title = @title,
        extra = @extra,
        profile_id = @profileId,
        workspace_path = @workspacePath,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      title: patch.title ?? cur.title,
      extra: JSON.stringify(patch.extra ?? cur.extra),
      profileId,
      workspacePath: patch.workspacePath ?? cur.workspacePath,
      updatedAt: Date.now(),
    })
  }

  softDelete(id: string): void {
    this.db.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
  }
}
