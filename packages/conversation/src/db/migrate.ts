import type { Db } from './client.js'

export interface Migration {
  version: number
  sql?: string
  up?: (db: Db) => void
}

export function runMigrations(db: Db, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const applied = new Set(appliedRows.map(r => r.version))
  const ordered = [...migrations].sort((a, b) => a.version - b.version)
  const insert = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
  for (const m of ordered) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      if (m.sql) db.exec(m.sql)
      if (m.up) m.up(db)
      insert.run(m.version, Date.now())
    })()
  }
}
