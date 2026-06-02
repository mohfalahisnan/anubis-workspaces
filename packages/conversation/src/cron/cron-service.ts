import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { CronCommand } from '../conversations/cron-detect.js'
import type { CronJob, CronJobsRepo } from '../db/repositories/cron-jobs-repo.js'

export interface ScheduledHandle { stop(): void; start(): void }

export interface CronScheduler {
  schedule(expr: string, fn: () => void, opts?: { scheduled?: boolean }): ScheduledHandle
}

export interface CronServiceOpts {
  repo: CronJobsRepo
  fire: (conversationId: string, prompt: string) => Promise<void>
  scheduler: CronScheduler
}

export class CronService {
  private handles = new Map<string, ScheduledHandle>()

  constructor(private opts: CronServiceOpts) {}

  loadFromDb(): void {
    for (const job of this.opts.repo.list()) {
      if (job.enabled) this.scheduleJob(job)
    }
  }

  list(conversationId?: string): CronJob[] {
    return this.opts.repo.list(conversationId)
  }

  update(id: string, patch: Parameters<CronJobsRepo['update']>[1]): CronJob | null {
    const next = this.opts.repo.update(id, patch)
    if (next) this.rescheduleJob(next)
    return next
  }

  delete(id: string): void {
    this.handles.get(id)?.stop()
    this.handles.delete(id)
    this.opts.repo.delete(id)
  }

  handle(cmd: CronCommand, conversationId: string): string {
    if (cmd.kind === 'create') {
      const now = nowMs()
      const job: CronJob = {
        id: newId(),
        conversationId,
        name: cmd.params.name,
        schedule: cmd.params.schedule,
        scheduleDescription: cmd.params.scheduleDescription,
        prompt: cmd.params.message,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }
      this.opts.repo.insert(job)
      this.scheduleJob(job)
      return `Created cron job "${job.name}" (id=${job.id}) on schedule ${job.schedule}.`
    }
    if (cmd.kind === 'delete') {
      const existed = this.opts.repo.findById(cmd.id)
      if (!existed) return `Cron job ${cmd.id} not found.`
      this.delete(cmd.id)
      return `Removed cron job ${cmd.id}.`
    }
    if (cmd.kind === 'update') {
      const next = this.update(cmd.id, cmd.params)
      return next ? `Updated cron job ${cmd.id}.` : `Cron job ${cmd.id} not found.`
    }
    const all = this.opts.repo.list(conversationId)
    if (all.length === 0) return 'No cron jobs scheduled for this conversation.'
    return all.map(j => `- ${j.name} (${j.id}) — ${j.schedule}${j.scheduleDescription ? ` (${j.scheduleDescription})` : ''}`).join('\n')
  }

  shutdown(): void {
    for (const h of this.handles.values()) h.stop()
    this.handles.clear()
  }

  private scheduleJob(job: CronJob): void {
    const handle = this.opts.scheduler.schedule(job.schedule, () => {
      this.opts.repo.touchLastRun(job.id, nowMs())
      void this.opts.fire(job.conversationId, job.prompt)
    })
    handle.start()
    this.handles.set(job.id, handle)
  }

  private rescheduleJob(job: CronJob): void {
    this.handles.get(job.id)?.stop()
    this.handles.delete(job.id)
    if (job.enabled) this.scheduleJob(job)
  }
}
