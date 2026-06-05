#!/usr/bin/env node
// Seeds self-contained test workflows into the Anubis SQLite. Idempotent —
// re-running first deletes any prior workflows whose name starts with "Test:".
//
// Usage:  node scripts/create-test-workflow.mjs
//
// What gets seeded:
//   1. "Test: Echo static data"          — single Table node, instant smoke test
//   2. "Test: Chain — Source → Sink"     — two Table nodes connected, visible progression
//   3. "Test: Instagram JSON media fanout" — Instagram Post → JSON Transformer
//                                             → Image / Video and JSON Transformer → Table
//
// Open Anubis → Workflows after running; both appear in the list.
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

// Migrations 002/003 — apply the minimal competitor/post tables needed by the
// seeded Instagram workflow if the user's install predates captured posts.
const capturedPostTables = db
  .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name IN ('competitors','captured_posts')`)
  .get().c
if (capturedPostTables !== 2) {
  console.log('[seed] Competitor/captured post tables missing — applying migrations 002/003 inline.')
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitors (
      id                TEXT PRIMARY KEY,
      handle            TEXT NOT NULL,
      display_name      TEXT,
      niche             TEXT,
      tint              TEXT,
      followers         INTEGER,
      avg_likes         INTEGER,
      post_count        INTEGER NOT NULL DEFAULT 0,
      last_refreshed_at INTEGER,
      notes             TEXT,
      added_at          INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      deleted_at        INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_competitors_handle_active
      ON competitors(handle) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_competitors_added_at
      ON competitors(added_at DESC) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS captured_posts (
      id              TEXT PRIMARY KEY,
      competitor_id   TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
      username        TEXT NOT NULL,
      post_url        TEXT NOT NULL,
      caption         TEXT,
      likes           INTEGER,
      comments        INTEGER,
      posted_at       TEXT,
      media_kind      TEXT,
      media_url       TEXT,
      carousel_count  INTEGER,
      captured_at     INTEGER NOT NULL,
      raw             TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_captured_posts_url
      ON captured_posts(competitor_id, post_url);
    CREATE INDEX IF NOT EXISTS idx_captured_posts_competitor_time
      ON captured_posts(competitor_id, posted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_captured_posts_likes
      ON captured_posts(likes DESC);
  `)
}

// Clean up any prior seeded test workflows (cascade removes their runs).
const removed = db.prepare(`DELETE FROM workflows WHERE name LIKE 'Test:%'`).run()
if (removed.changes > 0) {
  console.log(`[seed] Removed ${removed.changes} prior test workflow(s).`)
}

function seedCapturedInstagramPost() {
  const now = Date.now()
  const competitorId = 'test-json-transformer-competitor'
  const postId = 'test-json-transformer-post'
  const mediaUrl =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

  db.prepare(`
    INSERT INTO competitors (
      id, handle, display_name, niche, tint, followers, avg_likes, post_count,
      last_refreshed_at, notes, added_at, updated_at, deleted_at
    ) VALUES (
      @id, @handle, @displayName, @niche, @tint, @followers, @avgLikes, @postCount,
      @lastRefreshedAt, @notes, @addedAt, @updatedAt, NULL
    )
    ON CONFLICT(id) DO UPDATE SET
      handle = excluded.handle,
      display_name = excluded.display_name,
      niche = excluded.niche,
      post_count = excluded.post_count,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run({
    id: competitorId,
    handle: '@anubis.test',
    displayName: 'Anubis Test',
    niche: 'Workflow QA',
    tint: '#fd551d',
    followers: 1000,
    avgLikes: 42,
    postCount: 1,
    lastRefreshedAt: now,
    notes: 'Seeded by scripts/create-test-workflow.mjs',
    addedAt: now,
    updatedAt: now,
  })

  db.prepare(`
    INSERT INTO captured_posts (
      id, competitor_id, username, post_url, caption, likes, comments,
      posted_at, media_kind, media_url, carousel_count, captured_at, raw
    ) VALUES (
      @id, @competitorId, @username, @postUrl, @caption, @likes, @comments,
      @postedAt, @mediaKind, @mediaUrl, @carouselCount, @capturedAt, @raw
    )
    ON CONFLICT(id) DO UPDATE SET
      caption = excluded.caption,
      likes = excluded.likes,
      comments = excluded.comments,
      media_kind = excluded.media_kind,
      media_url = excluded.media_url,
      carousel_count = excluded.carousel_count,
      captured_at = excluded.captured_at,
      raw = excluded.raw
  `).run({
    id: postId,
    competitorId,
    username: 'anubis.test',
    postUrl: 'https://instagram.com/p/anubis-json-transformer-test',
    caption: 'Seeded post for JSON Transformer media fanout',
    likes: 123,
    comments: 7,
    postedAt: new Date(now).toISOString(),
    mediaKind: 'image',
    mediaUrl,
    carouselCount: 1,
    capturedAt: now,
    raw: JSON.stringify({ seeded: true, mediaUrls: [mediaUrl] }),
  })

  return postId
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

const seededPostId = seedCapturedInstagramPost()
const wf3 = seedWorkflow({
  name: 'Test: Instagram JSON media fanout',
  description:
    'Instagram Post → JSON Transformer, then fan out to Image / Video and ' +
    'JSON Transformer → Table. Uses a seeded captured post with an inline PNG, so no Instagram login is required.',
  graph: {
    nodes: [
      {
        id: 'instagram-post',
        type: 'instagramPost',
        position: { x: 80, y: 260 },
        data: { source: 'existing', postId: seededPostId },
      },
      {
        id: 'extract-json',
        type: 'jsonTransformer',
        position: { x: 560, y: 260 },
        data: {
          template: JSON.stringify({
            caption: '{{input.post.caption}}',
            mediaPaths: '{{input.post.mediaPaths}}',
            rows: {
              $map: 'input.post.mediaPaths',
              template: {
                label: 'media',
                value: '{{item}}',
              },
            },
          }, null, 2),
        },
      },
      {
        id: 'image-video',
        type: 'imageVideo',
        position: { x: 1040, y: 120 },
        data: { source: 'upstream' },
      },
      {
        id: 'table-json',
        type: 'jsonTransformer',
        position: { x: 1040, y: 400 },
        data: {
          template: JSON.stringify({
            $map: 'input.rows',
            template: {
              label: '{{item.label}}',
              value: '{{item.value}}',
            },
          }, null, 2),
        },
      },
      {
        id: 'table',
        type: 'table',
        position: { x: 1520, y: 400 },
        data: { staticData: [] },
      },
    ],
    edges: [
      { id: 'e-instagram-extract', source: 'instagram-post', target: 'extract-json' },
      { id: 'e-extract-media', source: 'extract-json', target: 'image-video' },
      { id: 'e-extract-table-json', source: 'extract-json', target: 'table-json' },
      { id: 'e-table-json-table', source: 'table-json', target: 'table' },
    ],
  },
})
console.log('[seed]', wf3, '→ Test: Instagram JSON media fanout')


db.close()

console.log('')
console.log('[seed] Done. Open Anubis → Workflows → click "Open" on either entry → "▶ Run published".')
console.log('[seed] Watch the Table node turn orange (running) → green (succeeded), with a banner above the canvas.')
