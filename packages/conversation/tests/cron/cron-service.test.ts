import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'
import { CronJobsRepo } from '../../src/db/repositories/cron-jobs-repo.js'
import { CronService } from '../../src/cron/cron-service.js'

function mkScheduler() {
  return { schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })) }
}

describe('CronService', () => {
  let db: Db
  let svc: CronService

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    new ConversationsRepo(db).insert({
      id: 'c1', title: 'X', agent: 'claude', status: 'pending',
      workspacePath: '/tmp', extra: { skills: [] }, createdAt: 1, updatedAt: 1,
    })
    svc = new CronService({
      repo: new CronJobsRepo(db),
      fire: async () => undefined,
      scheduler: mkScheduler(),
    })
  })

  it('handle(create) inserts a row and returns a confirmation', () => {
    const summary = svc.handle({ kind: 'create', params: { name: 'X', schedule: '* * * * *', message: 'go' } }, 'c1')
    expect(summary).toContain('Created')
    expect(svc.list('c1')).toHaveLength(1)
  })

  it('handle(delete) removes by id and returns a confirmation', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const id = svc.list('c1')[0]!.id
    const summary = svc.handle({ kind: 'delete', id }, 'c1')
    expect(summary).toMatch(/Removed|not found/i)
    expect(svc.list('c1')).toHaveLength(0)
  })

  it('handle(list) returns a human-readable summary', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const summary = svc.handle({ kind: 'list' }, 'c1')
    expect(summary).toMatch(/Y/)
  })

  it('handle(update) updates fields when present', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const id = svc.list('c1')[0]!.id
    svc.handle({ kind: 'update', id, params: { name: 'Z', message: 'updated prompt' } }, 'c1')
    expect(svc.list('c1')[0]!).toMatchObject({
      name: 'Z',
      prompt: 'updated prompt',
    })
  })

  it('handle(update) preserves prompt when message is omitted', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const id = svc.list('c1')[0]!.id
    svc.handle({ kind: 'update', id, params: { name: 'Z' } }, 'c1')
    expect(svc.list('c1')[0]!).toMatchObject({
      name: 'Z',
      prompt: 'go',
    })
  })

  it('loadFromDb schedules every enabled job', () => {
    svc.handle({ kind: 'create', params: { name: 'Y', schedule: '* * * * *', message: 'go' } }, 'c1')
    const scheduler = mkScheduler()
    const svc2 = new CronService({
      repo: new CronJobsRepo(db),
      fire: async () => undefined,
      scheduler,
    })
    svc2.loadFromDb()
    expect(scheduler.schedule).toHaveBeenCalledTimes(1)
  })
})
