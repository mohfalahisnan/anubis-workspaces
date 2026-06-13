import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'

describe('markdown canonical schema', () => {
  it('keeps only operational content state in SQLite', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const tables = new Set((db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as Array<{ name: string }>).map((row) => row.name))

    expect(tables.has('tasks')).toBe(false)
    expect(tables.has('content_items')).toBe(false)
    expect(tables.has('content_item_runtime')).toBe(true)
    expect(tables.has('competitors')).toBe(true)
    expect(tables.has('research_sessions')).toBe(true)
    expect(tables.has('research_candidates')).toBe(true)
    db.close()
  })
})
