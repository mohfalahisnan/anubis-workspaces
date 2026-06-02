import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'

describe('runMigrations', () => {
  it('applies all migrations and records versions', () => {
    const db = openDatabase(':memory:')
    const m1 = { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' }
    const m2 = { version: 2, sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' }
    runMigrations(db, [m1, m2])
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
    expect(versions.map(r => r.version)).toEqual([1, 2])
    db.close()
  })

  it('is idempotent — running twice applies each migration once', () => {
    const db = openDatabase(':memory:')
    const m1 = { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' }
    runMigrations(db, [m1])
    runMigrations(db, [m1])
    const count = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }
    expect(count.n).toBe(1)
    db.close()
  })
})
