import type { Db } from '../client.js'

export interface CronJob {
  id: string
  conversationId: string
  name: string
  schedule: string
  scheduleDescription?: string
  prompt: string
  enabled: boolean
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  conversation_id: string
  name: string
  schedule: string
  schedule_desc: string | null
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
    name: r.name,
    schedule: r.schedule,
    scheduleDescription: r.schedule_desc ?? undefined,
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
      INSERT INTO cron_jobs (id, conversation_id, name, schedule, schedule_desc, prompt, enabled, last_run_at, created_at, updated_at)
      VALUES (@id, @conversationId, @name, @schedule, @scheduleDescription, @prompt, @enabled, @lastRunAt, @createdAt, @updatedAt)
    `).run({
      id: j.id, conversationId: j.conversationId, name: j.name, schedule: j.schedule,
      scheduleDescription: j.scheduleDescription ?? null, prompt: j.prompt,
      enabled: j.enabled ? 1 : 0, lastRunAt: j.lastRunAt ?? null,
      createdAt: j.createdAt, updatedAt: j.updatedAt,
    })
  }

  update(id: string, patch: Partial<Pick<CronJob, 'name' | 'schedule' | 'scheduleDescription' | 'prompt' | 'enabled'>>): CronJob | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: CronJob = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE cron_jobs SET name = ?, schedule = ?, schedule_desc = ?, prompt = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.schedule, next.scheduleDescription ?? null, next.prompt, next.enabled ? 1 : 0, next.updatedAt, id)
    return next
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
  }

  findById(id: string): CronJob | null {
    const r = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as Row | undefined
    return r ? toJob(r) : null
  }

  list(conversationId?: string): CronJob[] {
    const rows = conversationId
      ? this.db.prepare('SELECT * FROM cron_jobs WHERE conversation_id = ? ORDER BY created_at DESC').all(conversationId) as Row[]
      : this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as Row[]
    return rows.map(toJob)
  }

  touchLastRun(id: string, atMs: number): void {
    this.db.prepare('UPDATE cron_jobs SET last_run_at = ? WHERE id = ?').run(atMs, id)
  }
}
