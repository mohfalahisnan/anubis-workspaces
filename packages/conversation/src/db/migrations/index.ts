import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Migration } from '../migrate.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

function hasTable(db: Parameters<NonNullable<Migration['up']>>[0], table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { name: string } | undefined
  return Boolean(row)
}

function hasColumn(db: Parameters<NonNullable<Migration['up']>>[0], table: string, column: string): boolean {
  if (!hasTable(db, table)) return false
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function addProjectColumnIfMissing(
  db: Parameters<NonNullable<Migration['up']>>[0],
  table: string,
): void {
  if (!hasTable(db, table) || hasColumn(db, table, 'project_id')) return
  // SQLite cannot add a REFERENCES column with a non-null default to an existing table.
  db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`)
}

function createIndexIfColumnExists(
  db: Parameters<NonNullable<Migration['up']>>[0],
  table: string,
  column: string,
  indexName: string,
): void {
  if (!hasColumn(db, table, column)) return
  db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(${column})`)
}

const repairProjectsMigration: Migration = {
  version: 18,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        emoji       TEXT,
        color       TEXT,
        description TEXT,
        workdir     TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER
      );
      INSERT OR IGNORE INTO projects (id, name, created_at, updated_at)
        VALUES ('default', 'Default Project', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
    `)

    for (const table of [
      'competitors',
      'captured_posts',
      'conversations',
      'workflows',
      'workflow_runs',
      'workflow_triggers',
      'cron_jobs',
    ]) {
      addProjectColumnIfMissing(db, table)
    }

    createIndexIfColumnExists(db, 'competitors', 'project_id', 'idx_competitors_project')
    createIndexIfColumnExists(db, 'captured_posts', 'project_id', 'idx_captured_posts_project')
    createIndexIfColumnExists(db, 'conversations', 'project_id', 'idx_conversations_project')
    createIndexIfColumnExists(db, 'workflows', 'project_id', 'idx_workflows_project')
    createIndexIfColumnExists(db, 'cron_jobs', 'project_id', 'idx_cron_jobs_project')
  },
}

export const MIGRATIONS: Migration[] = [
  load(1, '001_init.sql'),
  load(2, '002_competitors.sql'),
  load(3, '003_captured_posts.sql'),
  load(4, '004_workflows.sql'),
  load(5, '005_competitors_bio_level.sql'),
  load(6, '006_workflow_triggers.sql'),
  load(7, '007_known_workspaces.sql'),
  load(8, '008_projects.sql'),
  // 017 widens workflow run/step status enums (pause/branch/loop engine).
  load(17, '017_workflow_runs_pause.sql'),
  // Repairs existing DBs where version 8 was consumed by the removed content-memory feature.
  repairProjectsMigration,
  load(19, '019_content_items.sql'),
  load(20, '020_content_item_reference_url.sql'),
  load(21, '021_tasks.sql'),
  load(22, '022_cron_job_actions.sql'),
  load(23, '023_competitor_research_fields.sql'),
  load(24, '024_research_tables.sql'),
  load(25, '025_markdown_canonical.sql'),
  load(26, '026_content_pipeline.sql'),
]
