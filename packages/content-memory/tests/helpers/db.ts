import Database from 'better-sqlite3'
import type { Db, Migration } from '../../src/db/types.js'

/** Open an in-memory DB and apply the given migrations in version order. */
export function freshDb(migrations: Migration[]): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    db.exec(m.sql)
  }
  return db
}
