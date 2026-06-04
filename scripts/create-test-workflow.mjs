#!/usr/bin/env node
// Seeds self-contained test workflows into the Anubis SQLite. Idempotent —
// re-running first deletes any prior workflows whose name starts with "Test:".
//
// Usage:  node scripts/create-test-workflow.mjs
//
// What gets seeded (all pre-published, no external deps):
//   1. "Test: Echo static data"            — single Table node, instant smoke test
//   2. "Test: Chain — Source → Sink"       — two Table nodes connected by an edge,
//                                            so you can watch orange → green progression
//
// Open Anubis → Workflows after running; both appear at the top of the list.
// Click "Open" then "▶ Run published" — the engine, SSE stream, status banner,
// and node-glow ring should light up in sequence.

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
  console.error('[seed] Anubis SQLite not found at', dbPath)
  console.error('[seed] Open the Anubis app at least once so migrations run, then re-run this script.')
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

// Migration 004 — apply inline if the user's install predates it.
const tableCount = db
  .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name IN ('workflows','workflow_runs','workflow_run_steps')`)
  .get().c
if (tableCount !== 3) {
  console.log('[seed] Workflow tables missing — applying migration 004 inline.')
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

// Clean up any prior seeded test workflows (cascade removes their runs).
const removed = db.prepare(`DELETE FROM workflows WHERE name LIKE 'Test:%'`).run()
if (removed.changes > 0) {
  console.log(`[seed] Removed ${removed.changes} prior test workflow(s).`)
}

const insert = db.prepare(
  `INSERT INTO workflows (id, name, description, draft_graph, published_graph,
                          draft_updated_at, published_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

function seedWorkflow({ name, description, graph }) {
  const id = randomUUID()
  const now = Date.now()
  const graphJson = JSON.stringify(graph)
  insert.run(id, name, description, graphJson, graphJson, now, now, now, now)
  return id
}

// 1) Single Table — instant smoke test.
const wf1 = seedWorkflow({
  name: 'Test: Echo static data',
  description:
    'Single Table node, no external dependencies. Runs instantly. Use this to ' +
    'verify the engine, SSE stream, status banner, and node-glow ring.',
  graph: {
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
  },
})
console.log('[seed]', wf1, '→ Test: Echo static data')

// 2) Two Table nodes wired together — visible progression.
const wf2 = seedWorkflow({
  name: 'Test: Chain — Source → Sink',
  description:
    'Two Table nodes connected by an edge. The source has staticData; the sink ' +
    'receives the source\'s output unchanged. Lets you watch the orange → green ' +
    'progression travel through the graph.',
  graph: {
    nodes: [
      {
        id: 'source',
        type: 'table',
        position: { x: 120, y: 200 },
        data: {
          staticData: [
            { id: 1, label: 'first row from the source node' },
            { id: 2, label: 'second row from the source node' },
          ],
        },
      },
      {
        id: 'sink',
        type: 'table',
        position: { x: 620, y: 200 },
        data: { staticData: [] },
      },
    ],
    edges: [
      { id: 'e-source-sink', source: 'source', target: 'sink' },
    ],
  },
})
console.log('[seed]', wf2, '→ Test: Chain — Source → Sink')

db.close()

console.log('')
console.log('[seed] Done. Open Anubis → Workflows → click "Open" on either entry → "▶ Run published".')
console.log('[seed] Watch the Table node turn orange (running) → green (succeeded), with a banner above the canvas.')
