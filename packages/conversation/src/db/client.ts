import Database, { type Database as DbHandle } from 'better-sqlite3'

export type Db = DbHandle

export function openDatabase(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  return db
}

export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)()
}
