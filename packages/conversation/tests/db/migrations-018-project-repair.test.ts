import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'

function hasColumn(db: ReturnType<typeof openDatabase>, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

describe('migration 018 - project repair', () => {
  it('adds project tables/columns when version 8 was already consumed by an older migration', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS.filter((m) => m.version < 8))
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(8, 1)

    runMigrations(db, MIGRATIONS)

    expect(hasColumn(db, 'conversations', 'project_id')).toBe(true)
    expect(hasColumn(db, 'competitors', 'project_id')).toBe(true)
    expect(hasColumn(db, 'captured_posts', 'project_id')).toBe(true)
    expect(hasColumn(db, 'workflows', 'project_id')).toBe(true)
    expect(hasColumn(db, 'workflow_runs', 'project_id')).toBe(true)
    expect(hasColumn(db, 'cron_jobs', 'project_id')).toBe(true)

    const repo = new ConversationsRepo(db)
    expect(() => repo.insert({
      id: 'c1',
      title: 'Workflow lesson',
      agent: 'claude',
      status: 'pending',
      profileId: 'claude-research',
      projectId: 'default',
      workspacePath: 'C:/tmp/anubis',
      extra: {
        skills: [],
        source: 'workflow',
        workflow: { runId: 'run-1', nodeId: 'lesson-approved' },
      },
      createdAt: 1,
      updatedAt: 1,
    })).not.toThrow()

    db.close()
  })
})
