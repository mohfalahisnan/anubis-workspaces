#!/usr/bin/env node
// Seeds self-contained test workflows into the Anubis SQLite. Idempotent —
// re-running first deletes any prior workflows whose name starts with "Test:".
//
// Usage:  node scripts/create-test-workflow.mjs
//
// What gets seeded:
//   1. "Test: Echo static data"          — single Table node, instant smoke test
//   2. "Test: Chain — Source → Sink"     — two Table nodes connected, visible progression
//   3. "Test: IG → analyze → ideas →
//        choose → final"                 — 5-node real workflow (uses an existing
//                                          captured Instagram post + 2 AI Agent calls)
//
// Open Anubis → Workflows after running; all three appear in the list.
// Click "Open" then "▶ Run published".

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// The Electron main process always sets ANUBIS_DATA_DIR = `${userData}/anubis`,
// where userData is `%APPDATA%\<app-name>` on Windows. App-name is "Electron"
// for `pnpm dev` (unpackaged) and "Anubis" for the packaged build. We search
// the likely paths and use whichever anubis.db is most recently modified.
function candidateDataDirs() {
  if (process.env.ANUBIS_DATA_DIR) return [process.env.ANUBIS_DATA_DIR]
  const out = []
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      out.push(join(process.env.APPDATA, 'Anubis', 'anubis'))     // packaged
      out.push(join(process.env.APPDATA, 'Electron', 'anubis'))   // `pnpm dev`
    }
    if (process.env.LOCALAPPDATA) {
      out.push(join(process.env.LOCALAPPDATA, 'Anubis', 'anubis')) // bare backend fallback
    }
  } else if (process.platform === 'darwin') {
    const home = homedir()
    if (home) {
      out.push(join(home, 'Library', 'Application Support', 'Anubis', 'anubis'))
      out.push(join(home, 'Library', 'Application Support', 'Electron', 'anubis'))
    }
  } else {
    if (process.env.XDG_DATA_HOME) out.push(join(process.env.XDG_DATA_HOME, 'anubis'))
    const home = homedir()
    if (home) {
      out.push(join(home, '.config', 'Anubis', 'anubis'))
      out.push(join(home, '.config', 'Electron', 'anubis'))
      out.push(join(home, '.local', 'share', 'anubis'))
    }
  }
  if (out.length === 0) out.push(join(tmpdir(), 'anubis'))
  return out
}

function resolveDataDir() {
  const candidates = candidateDataDirs()
  let best = null
  for (const dir of candidates) {
    const dbPath = join(dir, 'anubis.db')
    if (!existsSync(dbPath)) continue
    const mtime = statSync(dbPath).mtimeMs
    if (!best || mtime > best.mtime) best = { dir, dbPath, mtime }
  }
  if (best) return best
  // No DB found — seed into the first candidate so the user can still try it.
  const fallback = candidates[0]
  mkdirSync(fallback, { recursive: true })
  return { dir: fallback, dbPath: join(fallback, 'anubis.db'), mtime: 0 }
}

const { dir: dataDir, dbPath, mtime } = resolveDataDir()
console.log('[seed] Using dataDir:', dataDir)
if (mtime === 0) {
  console.log('[seed] (no existing anubis.db at any candidate path — created fresh; open the app once if seeded workflows still don\'t appear)')
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

// 3) Real workflow: existing IG post → AI analyze → Table of suggested ideas → AI choose → Table final.
//
// We look up a real captured post to use as the IG source (so the workflow runs
// without needing Chrome to be open). If no captured posts exist yet, fall back
// to a URL-source node — the user can edit it in the inspector before running.
//
// For the AI Agent nodes, we prefer a "yolo"-style profile because the two
// agent calls in this chain run unattended and should not stop for plan-mode
// approval. We pick the first profile whose name suggests autonomous behavior;
// otherwise the first one we find. The user can override in the inspector.

const profiles = db.prepare(`SELECT id, name FROM profiles ORDER BY sort_order ASC`).all()
const yoloProfile =
  profiles.find((p) => /yolo/i.test(p.name)) ??
  profiles.find((p) => /research/i.test(p.name)) ??
  profiles[0]
const profileId = yoloProfile?.id ?? 'claude-yolo'
console.log('[seed] Using profile for AI Agent nodes:', profileId, yoloProfile ? `(${yoloProfile.name})` : '(no profile found — placeholder, please set in inspector)')

const capturedPost = db
  .prepare(
    `SELECT id, post_url, caption FROM captured_posts
     WHERE caption IS NOT NULL AND length(caption) > 80
     ORDER BY captured_at DESC
     LIMIT 1`,
  )
  .get()

let igNodeData
if (capturedPost) {
  igNodeData = { source: 'existing', postId: capturedPost.id }
  console.log('[seed] Using captured post:', capturedPost.id, `(${capturedPost.post_url})`)
} else {
  igNodeData = { source: 'url', url: 'https://www.instagram.com/p/REPLACE-WITH-A-PUBLIC-POST/' }
  console.log('[seed] No captured posts found — IG node defaults to a URL placeholder; edit it in the inspector before running.')
}

const analyzePrompt = `You are a content strategist analyzing an Instagram post to inspire new content for a similar audience.

The captured post is provided in the <context> block above (caption, media URLs, metrics).

Your task: suggest 3 distinct content ideas inspired by this post — each one taking a different angle. For each idea, output:
- "title": short, hook-style first line (max 70 chars)
- "angle": one of "educational" | "provocative" | "authority"
- "cta": the closing call to action

Output ONLY a JSON array of exactly 3 objects. No prose before or after, no markdown fences.

Example shape:
[
  {"title":"...","angle":"educational","cta":"..."},
  {"title":"...","angle":"provocative","cta":"..."},
  {"title":"...","angle":"authority","cta":"..."}
]`

const choosePrompt = `The <context> above contains 3 content ideas (from the analyze step's output).

Pick the SINGLE best idea — favor ideas that are specific, novel, and immediately actionable.

Then expand it into a complete Instagram caption:
- First line: the hook (≤ 80 chars)
- Body: 3–5 short paragraphs that deliver the promised value
- Last line: the CTA

Output ONLY the final caption text — no JSON, no commentary, no markdown fences.`

const wf3 = seedWorkflow({
  name: 'Test: IG → analyze → ideas → choose → final',
  description:
    '5-node real workflow. Reads a captured Instagram post, asks an AI Agent to ' +
    'suggest 3 content ideas, displays them in a Table, asks a second AI Agent to ' +
    'pick the best one and expand it into a finished caption, then displays the final ' +
    'output in another Table. Requires a working AI Agent profile (credentials set up).',
  graph: {
    nodes: [
      {
        id: 'ig',
        type: 'instagramPost',
        position: { x: 0, y: 200 },
        data: igNodeData,
      },
      {
        id: 'analyze',
        type: 'aiAgent',
        position: { x: 440, y: 200 },
        data: {
          profileId,
          reasoning: 'medium',
          prompt: analyzePrompt,
        },
      },
      {
        id: 'ideas',
        type: 'table',
        position: { x: 880, y: 200 },
        data: { staticData: [] },
      },
      {
        id: 'choose',
        type: 'aiAgent',
        position: { x: 1320, y: 200 },
        data: {
          profileId,
          reasoning: 'medium',
          prompt: choosePrompt,
        },
      },
      {
        id: 'final',
        type: 'table',
        position: { x: 1760, y: 200 },
        data: { staticData: [] },
      },
    ],
    edges: [
      { id: 'e-ig-analyze',     source: 'ig',       target: 'analyze' },
      { id: 'e-analyze-ideas',  source: 'analyze',  target: 'ideas' },
      { id: 'e-ideas-choose',   source: 'ideas',    target: 'choose' },
      { id: 'e-choose-final',   source: 'choose',   target: 'final' },
    ],
  },
})
console.log('[seed]', wf3, '→ Test: IG → analyze → ideas → choose → final')

db.close()

console.log('')
console.log('[seed] Done. Open Anubis → Workflows → click "Open" on either entry → "▶ Run published".')
console.log('[seed] Watch the Table node turn orange (running) → green (succeeded), with a banner above the canvas.')
