import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'

function hasColumn(db: ReturnType<typeof openDatabase>, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function hasTable(db: ReturnType<typeof openDatabase>, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
  return Boolean(row)
}

describe('migrations - legacy DB with under-recorded schema_migrations', () => {
  // Reproduces the real production state found on a DB created by an older
  // build: `schema_migrations` only records [1,2,3], yet migration 4's
  // `workflows` tables already exist physically. Re-running the bare
  // `CREATE TABLE workflows` in 004 throws "table workflows already exists",
  // which aborts the whole migration run and bricks the backend (every HTTP
  // request 500s because getStack() can never initialise).
  it('catches up instead of aborting when later tables exist but were never recorded', () => {
    const db = openDatabase(':memory:')

    // Old build: 1-3 recorded; migration 4's tables physically created but
    // its version never written to the ledger.
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 3))
    runMigrations(db, MIGRATIONS.filter((m) => m.version === 4))
    db.prepare('DELETE FROM schema_migrations WHERE version = 4').run()

    // Real DBs have rows. Migration 008 adds a `REFERENCES` column with a
    // non-NULL default, which SQLite rejects on a populated table while
    // foreign-key enforcement is on — so this row makes the test exercise that
    // path, not just the empty-table happy path a fresh install hits.
    db.prepare(
      'INSERT INTO competitors (id, handle, added_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('cmp1', 'someone', 1, 1)

    // Must not throw on the duplicate `CREATE TABLE workflows`.
    expect(() => runMigrations(db, MIGRATIONS)).not.toThrow()

    // And the schema must end up fully migrated, not stuck at version 3.
    expect(hasColumn(db, 'conversations', 'project_id')).toBe(true)
    expect(hasColumn(db, 'cron_jobs', 'project_id')).toBe(true)
    expect(hasColumn(db, 'cron_jobs', 'action_type')).toBe(true)
    expect(hasColumn(db, 'cron_jobs', 'action_config')).toBe(true)
    expect(hasColumn(db, 'competitors', 'bio')).toBe(true)
    expect(hasColumn(db, 'competitors', 'level')).toBe(true)
    expect(hasTable(db, 'projects')).toBe(true)
    expect(hasTable(db, 'tasks')).toBe(true)
    expect(hasTable(db, 'content_items')).toBe(true)

    db.close()
  })
})
