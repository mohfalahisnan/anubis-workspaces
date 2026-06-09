import type { Db } from '../client.js'
import type { CronActionConfig, CronActionType } from '@anubis/shared'

export interface CronJob {
  id: string
  conversationId: string
  projectId?: string
  name: string
  schedule: string
  scheduleDescription?: string
  actionType: CronActionType
  actionConfig?: CronActionConfig
  prompt: string
  enabled: boolean
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  conversation_id: string
  project_id: string | null
  name: string
  schedule: string
  schedule_desc: string | null
  action_type: CronActionType | null
  action_config: string | null
  prompt: string
  enabled: number
  last_run_at: number | null
  created_at: number
  updated_at: number
}

function toJob(r: Row): CronJob {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    projectId: r.project_id ?? undefined,
    name: r.name,
    schedule: r.schedule,
    scheduleDescription: r.schedule_desc ?? undefined,
    actionType: r.action_type ?? 'message',
    actionConfig: r.action_config ? (JSON.parse(r.action_config) as CronActionConfig) : undefined,
    prompt: r.prompt,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class CronJobsRepo {
  constructor(private db: Db) {}

  insert(j: CronJob): void {
    this.db.prepare(`
      INSERT INTO cron_jobs (id, conversation_id, project_id, name, schedule, schedule_desc, action_type, action_config, prompt, enabled, last_run_at, created_at, updated_at)
      VALUES (
        @id, @conversationId,
        COALESCE(@projectId, (SELECT project_id FROM conversations WHERE id = @conversationId), 'default'),
        @name, @schedule, @scheduleDescription, @actionType, @actionConfig, @prompt, @enabled, @lastRunAt, @createdAt, @updatedAt
      )
    `).run({
      id: j.id, conversationId: j.conversationId, projectId: j.projectId ?? null,
      name: j.name, schedule: j.schedule,
      scheduleDescription: j.scheduleDescription ?? null,
      actionType: j.actionType,
      actionConfig: j.actionConfig ? JSON.stringify(j.actionConfig) : null,
      prompt: j.prompt,
      enabled: j.enabled ? 1 : 0, lastRunAt: j.lastRunAt ?? null,
      createdAt: j.createdAt, updatedAt: j.updatedAt,
    })
  }

  update(id: string, patch: Partial<Pick<CronJob, 'name' | 'schedule' | 'scheduleDescription' | 'actionType' | 'actionConfig' | 'prompt' | 'enabled'>>): CronJob | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: CronJob = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE cron_jobs SET name = ?, schedule = ?, schedule_desc = ?, action_type = ?, action_config = ?, prompt = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.schedule,
      next.scheduleDescription ?? null,
      next.actionType,
      next.actionConfig ? JSON.stringify(next.actionConfig) : null,
      next.prompt,
      next.enabled ? 1 : 0,
      next.updatedAt,
      id,
    )
    return next
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
  }

  findById(id: string): CronJob | null {
    const r = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as Row | undefined
    return r ? toJob(r) : null
  }

  list(conversationId?: string, projectId?: string): CronJob[] {
    const where: string[] = []
    const params: unknown[] = []
    if (conversationId) { where.push('conversation_id = ?'); params.push(conversationId) }
    if (projectId) { where.push('project_id = ?'); params.push(projectId) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT * FROM cron_jobs ${whereSql} ORDER BY created_at DESC`).all(...params) as Row[]
    return rows.map(toJob)
  }

  touchLastRun(id: string, atMs: number): void {
    this.db.prepare('UPDATE cron_jobs SET last_run_at = ? WHERE id = ?').run(atMs, id)
  }
}
