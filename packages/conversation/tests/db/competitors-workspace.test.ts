import { describe, it, expect } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '@anubis/content-memory'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'

function migUpTo(version: number) {
  return MIGRATIONS.filter((m) => m.version <= version)
}

describe('competitors workspace scoping', () => {
  it('a new competitor defaults to the default workspace', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new CompetitorsRepo(db)
    repo.insert({
      id: 'c1', handle: '@a', postCount: 0, addedAt: 1, updatedAt: 1,
    })
    expect(repo.findById('c1')?.workspaceId).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('backfills legacy competitor rows to the default workspace (migration 010)', () => {
    const db = openDatabase(':memory:')
    // Apply everything EXCEPT the competitors ALTER — simulates a legacy DB.
    runMigrations(db, migUpTo(9))
    db.prepare(`
      INSERT INTO competitors (id, handle, post_count, added_at, updated_at)
      VALUES ('legacy', '@old', 0, 1, 1)
    `).run()
    // Now apply migration 010.
    runMigrations(db, MIGRATIONS)
    const row = db.prepare('SELECT workspace_id FROM competitors WHERE id = ?').get('legacy') as
      | { workspace_id: string | null }
      | undefined
    expect(row?.workspace_id).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('preserves an explicitly set workspaceId', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new CompetitorsRepo(db)
    repo.insert({
      id: 'c2', handle: '@b', postCount: 0, addedAt: 1, updatedAt: 1,
      workspaceId: 'default-workspace',
    })
    expect(repo.findById('c2')?.workspaceId).toBe('default-workspace')
  })
})
