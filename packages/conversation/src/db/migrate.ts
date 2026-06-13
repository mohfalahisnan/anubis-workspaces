import type { Db } from './client.js'

export interface Migration {
  version: number
  sql?: string
  up?: (db: Db) => void
}

/**
 * Errors that mean "this DDL object is already present" — safe to ignore when
 * a migration is replayed against a database whose `schema_migrations` ledger
 * under-records what physically exists.
 *
 * This happens to DBs created by older builds that used a different migration
 * scheme (e.g. the removed content-memory feature once consumed version 8, and
 * some early builds created tables without recording their versions at all).
 * One real production DB had `schema_migrations = [1,2,3]` while the migration-4
 * `workflows` tables already existed. Without tolerating these, the bare
 * `CREATE TABLE workflows` in 004 throws, which aborts the entire migration run
 * and bricks the backend — `createConversationService()` throws, so `getStack()`
 * throws on every request and all endpoints return 500 (the UI then hangs on an
 * endless loading state because the renderer never receives data).
 */
const ALREADY_APPLIED = /already exists|duplicate column name/i

function isAlreadyApplied(err: unknown): boolean {
  return err instanceof Error && ALREADY_APPLIED.test(err.message)
}

/**
 * Split a migration's SQL into individual statements, ignoring `;` that appear
 * inside single-quoted string literals or `--` / block comments (migration 017's
 * header comment contains a semicolon). Sufficient for the simple one-statement
 * DDL used by these migrations; compound statements such as
 * `CREATE TRIGGER ... BEGIN ...; ... END` are intentionally not used here.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let inString = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (inString) {
      cur += ch
      if (ch === "'") {
        if (next === "'") { cur += next; i++ } // escaped quote inside a string
        else inString = false
      }
      continue
    }
    if (ch === "'") { inString = true; cur += ch; continue }
    if (ch === '-' && next === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i++ // skip the '*'; the loop's increment skips the '/'
      continue
    }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * Run a migration's SQL statement-by-statement, tolerating only
 * "already applied" DDL errors so a legacy DB can catch its ledger up to the
 * real schema. Any other error is a genuine failure and aborts the migration.
 */
function execMigrationSql(db: Db, sql: string): void {
  for (const stmt of splitStatements(sql)) {
    try {
      db.exec(stmt)
    } catch (err) {
      if (isAlreadyApplied(err)) continue
      throw err
    }
  }
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

  // Disable foreign-key enforcement for the duration of the run. Some migrations
  // add a `REFERENCES` column with a non-NULL default (008) or rebuild a table
  // (017); SQLite rejects the former on an already-populated table and would fire
  // cascades on the latter while FK enforcement is on. The pragma is a no-op
  // inside a transaction, so it must be toggled here, outside the per-migration
  // transactions, and restored afterwards.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
  if (fkWasOn) db.pragma('foreign_keys = OFF')
  try {
    for (const m of ordered) {
      if (applied.has(m.version)) continue
      db.transaction(() => {
        if (m.sql) execMigrationSql(db, m.sql)
        if (m.up) m.up(db)
        insert.run(m.version, Date.now())
      })()
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }
}
