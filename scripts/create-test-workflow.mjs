#!/usr/bin/env node
// Inserts a self-contained test workflow into the Anubis SQLite so the
// "▶ Run published" button has something to chew on without needing AI Agent
// credentials, Chrome, or the crawler.
//
// Usage:  node scripts/create-test-workflow.mjs
//
// The created workflow:
//   - one Table node
//   - staticData carries some demo rows
//   - no edges, no upstream — runs instantly to the "succeeded" state
//
// After running, open Anubis → Workflows. The new workflow appears at the
// top of the list. Click "Run" to verify the live status banner + node
// glow + run inspector all work end-to-end.

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

function getDataDir() {
  if (process.env.ANUBIS_DATA_DIR) return process.env.ANUBIS_DATA_DIR
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'Anubis', 'anubis')
  }
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'anubis')
  const home = homedir()
  return home ? join(home, '.local', 'share', 'anubis') : join(tmpdir(), 'anubis')
}

const dataDir = getDataDir()
mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'anubis.db')

if (!existsSync(dbPath)) {
  console.error('[create-test-workflow] Anubis SQLite not found at', dbPath)
  console.error('[create-test-workflow] Open the Anubis app at least once so migrations run, then re-run this script.')
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

// Sanity: the workflow tables must exist (migration 004). If they don't, apply
// the migration ourselves so this script works against an older install.
const tableCount = db
  .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name IN ('workflows','workflow_runs','workflow_run_steps')`)
  .get().c
if (tableCount !== 3) {
  console.log('[create-test-workflow] Workflow tables missing — applying migration 004 inline.')
  // Mirror packages/conversation/src/db/migrations/004_workflows.sql verbatim.
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      draft_graph       TEXT NOT NULL,
      published_graph   TEXT,
      draft_updated_at  INTEGER NOT NULL,
      published_at      INTEGER,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id              TEXT PRIMARY KEY,
      workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
      graph_snapshot  TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      error           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS workflow_run_steps (
      id           TEXT PRIMARY KEY,
      run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      node_id      TEXT NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
      started_at   INTEGER,
      finished_at  INTEGER,
      output       TEXT,
      error        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run ON workflow_run_steps(run_id);
  `)
}

const id = randomUUID()
const now = Date.now()
const graph = {
  nodes: [
    {
      id: 't1',
      type: 'table',
      position: { x: 240, y: 200 },
      data: {
        staticData: [
          { step: 'hello', from: 'static rows' },
          { step: 'world', from: 'static rows' },
          { step: 'this is a runnable test workflow', from: 'static rows' },
        ],
      },
    },
  ],
  edges: [],
}
const graphJson = JSON.stringify(graph)

db.prepare(
  `INSERT INTO workflows (id, name, description, draft_graph, published_graph,
                          draft_updated_at, published_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  id,
  'Test: Echo static data',
  'Self-contained test workflow created by scripts/create-test-workflow.mjs. ' +
    'Single Table node, no external dependencies. Run it to verify the live status banner ' +
    'and node-glow feedback work end-to-end.',
  graphJson,       // draft_graph
  graphJson,       // published_graph (pre-published so "Run" is enabled immediately)
  now,             // draft_updated_at
  now,             // published_at
  now,             // created_at
  now,             // updated_at
)

db.close()

console.log('[create-test-workflow] Created workflow', id)
console.log('[create-test-workflow] Open Anubis → Workflows → "Test: Echo static data" → click Run.')
console.log('[create-test-workflow] You should see:')
console.log('[create-test-workflow]   - orange pulsing glow on the Table node while running')
console.log('[create-test-workflow]   - green glow when succeeded')
console.log('[create-test-workflow]   - status banner above the canvas ("Run Succeeded")')
console.log('[create-test-workflow]   - inspector "Run" tab shows the static rows as the node output')
