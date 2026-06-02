import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'

const TABLES = [
  'conversations', 'messages', 'artifacts',
  'agent_sessions', 'profiles', 'profile_overrides', 'cron_jobs',
]

describe('001_init.sql', () => {
  it('creates every expected table', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as { name: string }[]
    const names = new Set(rows.map(r => r.name))
    for (const t of TABLES) expect(names.has(t), `missing table ${t}`).toBe(true)
    db.close()
  })
})
