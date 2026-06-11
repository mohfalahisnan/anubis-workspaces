# Import / Export Project Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add round-trip JSON import/export of a project's competitors and their captured Instagram posts, triggered from buttons on the Competitors page, so a user can move that data between installs.

**Architecture:** A single combined "project snapshot" JSON file (`anubis-project-snapshot` v1). A new isolated backend module `packages/backend/src/snapshot.ts` exposes `GET /snapshot/export` and `POST /snapshot/import`, going through the existing `getStack()` service layer. Import matches competitors by their globally-unique handle and upserts posts idempotently inside one atomic transaction. The frontend adds Export/Import buttons that download/upload the file.

**Tech Stack:** TypeScript (ESM), Hono, Zod, better-sqlite3 (via `@anubis/conversation` repos/services), React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-import-export-snapshot-design.md`

---

## Background the engineer needs

- The backend never touches repos directly in routes; it calls `getStack()` (`packages/backend/src/services.ts:19`) which returns a `ConversationStack` with services: `stack.competitors` (a `CompetitorsService`), `stack.capturedPosts` (a `CapturedPostsRepo`), `stack.projects` (a `ProjectsRepo`).
- **Competitor handles are globally unique** (`CREATE UNIQUE INDEX uq_competitors_handle_active ON competitors(handle) WHERE deleted_at IS NULL`), not per-project. So import matches a competitor by handle across the whole DB.
- `stack.capturedPosts.upsertMany(posts)` is `INSERT … ON CONFLICT(competitor_id, post_url) DO UPDATE`, deduped by `(competitorId, normalized url)`. It returns `{ inserted }` = the number of **unique candidate** rows it processed (NOT net-new). To count net-new we compare `countForCompetitor()` before and after.
- Errors: routes `throw` a `ZodError` (from `.parse`) or `new HttpError(status, body)` (`packages/backend/src/http-errors.ts:15`); the single `app.onError` seam maps them (ZodError → 400, HttpError → its status). Don't hand-roll `c.json(err, status)`.
- `@anubis/*` imports resolve to each package's **built `dist`** at test/runtime. After editing `@anubis/shared` or `@anubis/conversation`, you MUST rebuild that package before backend/frontend pick up the change. (Type-only imports are erased by esbuild at test time, but typecheck still needs the rebuild.)

## File structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `packages/shared/src/index.ts` | Snapshot data types (`ProjectSnapshot`, `SnapshotCompetitor`, `SnapshotCapturedPost`, `SnapshotProjectInfo`, `ImportSnapshotInput`, `ImportSnapshotResult`) | Modify |
| `packages/conversation/src/index.ts` | Add `transaction<T>(fn)` to `ConversationStack` for atomic multi-write imports | Modify |
| `packages/backend/src/snapshot.ts` | Zod schema, `buildSnapshot`, `importSnapshot`, `snapshotRoutes` | Create |
| `packages/backend/src/app.ts` | Mount `app.route('/snapshot', snapshotRoutes)` | Modify |
| `packages/backend/tests/snapshot.test.ts` | Export shape, round-trip, idempotency, handle conflict, orphan, invalid-schema | Create |
| `packages/frontend/src/api.ts` | `exportProjectSnapshot`, `importProjectSnapshot` helpers | Modify |
| `packages/frontend/src/pages/competitors.tsx` | Export/Import toolbar buttons + handlers | Modify |

> **Spec deviation (intentional):** the spec mentioned a shared-package schema-validation test, but `@anubis/shared` carries only compile-time interfaces (no Zod). The runtime validation lives in the backend's Zod schema, so the schema-validation test lives in `packages/backend/tests/snapshot.test.ts` instead.

---

## Task 1: Shared snapshot types

**Files:**
- Modify: `packages/shared/src/index.ts` (append a new section near the other domain types; `CompetitorLevelOverride` is already exported from this file)

- [ ] **Step 1: Add the snapshot types**

Append to `packages/shared/src/index.ts`:

```typescript
/* ============================================================
   Project snapshot — import/export of competitors + captured
   posts for moving a project's data between installs. See
   docs/superpowers/specs/2026-06-11-import-export-snapshot-design.md
   ============================================================ */

export interface SnapshotProjectInfo {
  id: string
  name: string
  emoji?: string
  color?: string
  description?: string
}

export interface SnapshotCompetitor {
  handle: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  postCount?: number
  lastRefreshedAt?: number
  notes?: string
  bio?: string
  level?: CompetitorLevelOverride
  addedAt?: number
  updatedAt?: number
}

export interface SnapshotCapturedPost {
  competitorHandle: string
  username: string
  postUrl: string
  caption?: string
  likes?: number
  comments?: number
  postedAt?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaUrl?: string
  carouselCount?: number
  capturedAt?: number
  raw?: Record<string, unknown>
}

export interface ProjectSnapshot {
  kind: 'anubis-project-snapshot'
  schemaVersion: 1
  exportedAt: number
  app: { name: string; version: string }
  project: SnapshotProjectInfo
  competitors: SnapshotCompetitor[]
  capturedPosts: SnapshotCapturedPost[]
}

export interface ImportSnapshotInput {
  projectId?: string
  snapshot: ProjectSnapshot
}

export interface ImportSnapshotResult {
  ok: true
  projectId: string
  competitors: { created: number; matched: number }
  posts: { imported: number; skipped: number }
  warnings: string[]
}
```

- [ ] **Step 2: Build the shared package**

Run: `pnpm --filter @anubis/shared build`
Expected: completes with no output / no errors.

- [ ] **Step 3: Typecheck the shared package**

Run: `pnpm --filter @anubis/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): project snapshot import/export types"
```

---

## Task 2: Atomic transaction primitive on ConversationStack

The import does several writes (create competitors, upsert posts, update counts). The spec requires this to be atomic, but `ConversationStack` doesn't expose the DB. Add a thin `transaction` method that wraps better-sqlite3's `db.transaction()` (nested calls are safe — better-sqlite3 uses savepoints).

**Files:**
- Modify: `packages/conversation/src/index.ts:44` (interface) and `:151` (stack object)

- [ ] **Step 1: Add `transaction` to the `ConversationStack` interface**

In `packages/conversation/src/index.ts`, inside `export interface ConversationStack { … }`, add this member right above `shutdown(): Promise<void>` (around line 66):

```typescript
  /** Run a function inside a single better-sqlite3 transaction (atomic, synchronous). */
  transaction<T>(fn: () => T): T
```

- [ ] **Step 2: Implement it on the stack object**

In the same file, the `db` const is in scope (`const db = openDatabase(...)` at line 76). In the `const stack: ConversationStack = { … }` literal (around line 151), add this property right above `async shutdown() {`:

```typescript
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)()
    },
```

- [ ] **Step 3: Build the conversation package**

Run: `pnpm --filter @anubis/conversation build`
Expected: completes with no errors.

> If the build reports `ERR_DLOPEN_FAILED` / NODE_MODULE_VERSION for better-sqlite3, run `pnpm rebuild better-sqlite3` first, then rebuild. This is an ABI mismatch, not a code error.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/index.ts
git commit -m "feat(conversation): expose stack.transaction for atomic multi-write ops"
```

---

## Task 3: Backend snapshot module — export

Create the module with the Zod schema, `buildSnapshot`, the export route, and mount it. Test the export shape.

**Files:**
- Create: `packages/backend/src/snapshot.ts`
- Modify: `packages/backend/src/app.ts` (import + mount)
- Test: `packages/backend/tests/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/snapshot.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectSnapshot } from '@anubis/shared'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-snapshot-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('snapshot export', () => {
  it('exports a project\'s competitors and their posts, tagged by handle', async () => {
    const { getStack } = await import('../src/services.js')
    const { buildSnapshot } = await import('../src/snapshot.js')
    const stack = getStack()

    const comp = stack.competitors.create({ handle: '@alpha', displayName: 'Alpha' })
    stack.capturedPosts.upsertMany([
      {
        id: 'p1', competitorId: comp.id, username: 'alpha',
        postUrl: 'https://instagram.com/p/AAA/', likes: 10, capturedAt: 1,
      },
      {
        id: 'p2', competitorId: comp.id, username: 'alpha',
        postUrl: 'https://instagram.com/p/BBB/', likes: 20, capturedAt: 2,
      },
    ])

    const snap: ProjectSnapshot = buildSnapshot('default')
    expect(snap.kind).toBe('anubis-project-snapshot')
    expect(snap.schemaVersion).toBe(1)
    expect(snap.competitors.map((c) => c.handle)).toContain('@alpha')
    expect(snap.capturedPosts).toHaveLength(2)
    expect(snap.capturedPosts.every((p) => p.competitorHandle === '@alpha')).toBe(true)
    expect(new Set(snap.capturedPosts.map((p) => p.postUrl))).toEqual(
      new Set(['https://instagram.com/p/AAA/', 'https://instagram.com/p/BBB/']),
    )
  })

  it('returns 404 for an unknown project via the route', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/snapshot/export?projectId=does-not-exist')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/backend/tests/snapshot.test.ts`
Expected: FAIL — cannot resolve `../src/snapshot.js` (module doesn't exist yet).

- [ ] **Step 3: Create the snapshot module (export half)**

Create `packages/backend/src/snapshot.ts`:

```typescript
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { CapturedPost } from '@anubis/conversation'
import type {
  ImportSnapshotResult,
  ProjectSnapshot,
  SnapshotCapturedPost,
  SnapshotCompetitor,
} from '@anubis/shared'
import { getStack } from './services.js'
import { HttpError } from './http-errors.js'

/* ---------- version (informational only) ---------- */

function readAppVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../../../package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function notFound(projectId: string): HttpError {
  return new HttpError(404, {
    ok: false,
    error: { code: 'NOT_FOUND', message: `Project not found: ${projectId}` },
  })
}

/* ---------- export ---------- */

export function buildSnapshot(projectId: string): ProjectSnapshot {
  const stack = getStack()
  const project = stack.projects.findById(projectId)
  if (!project) throw notFound(projectId)

  const competitors = stack.competitors.list(projectId)

  const snapCompetitors: SnapshotCompetitor[] = competitors.map((c) => ({
    handle: c.handle,
    displayName: c.displayName,
    niche: c.niche,
    tint: c.tint,
    followers: c.followers,
    avgLikes: c.avgLikes,
    postCount: c.postCount,
    lastRefreshedAt: c.lastRefreshedAt,
    notes: c.notes,
    bio: c.bio,
    level: c.level,
    addedAt: c.addedAt,
    updatedAt: c.updatedAt,
  }))

  const snapPosts: SnapshotCapturedPost[] = []
  for (const c of competitors) {
    // High limit so we export every post for the competitor (list() defaults to 200).
    const posts = stack.capturedPosts.list({ competitorId: c.id, limit: 1_000_000 })
    for (const p of posts) {
      snapPosts.push({
        competitorHandle: c.handle,
        username: p.username,
        postUrl: p.postUrl,
        caption: p.caption,
        likes: p.likes,
        comments: p.comments,
        postedAt: p.postedAt,
        mediaKind: p.mediaKind,
        mediaUrl: p.mediaUrl,
        carouselCount: p.carouselCount,
        capturedAt: p.capturedAt,
        raw: p.raw,
      })
    }
  }

  return {
    kind: 'anubis-project-snapshot',
    schemaVersion: 1,
    exportedAt: Date.now(),
    app: { name: 'anubis', version: readAppVersion() },
    project: {
      id: project.id,
      name: project.name,
      emoji: project.emoji,
      color: project.color,
      description: project.description,
    },
    competitors: snapCompetitors,
    capturedPosts: snapPosts,
  }
}

/* ---------- routes ---------- */

export const snapshotRoutes = new Hono()

snapshotRoutes.get('/export', (c) => {
  const projectId = c.req.query('projectId') ?? 'default'
  return c.json({ ok: true, snapshot: buildSnapshot(projectId) })
})
```

- [ ] **Step 4: Mount the route in `app.ts`**

In `packages/backend/src/app.ts`, add the import next to the other route imports (top of file, alongside `competitorRoutes` etc.):

```typescript
import { snapshotRoutes } from './snapshot.js'
```

And add the mount right after `app.route('/posts', postRoutes)` (around line 63):

```typescript
app.route('/snapshot', snapshotRoutes)
```

- [ ] **Step 5: Run the export tests to verify they pass**

Run: `pnpm vitest run packages/backend/tests/snapshot.test.ts -t "export"`
Expected: PASS (both export tests). The 404 test passes because `buildSnapshot` throws `HttpError(404)` and `app.onError` maps it.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/snapshot.ts packages/backend/src/app.ts packages/backend/tests/snapshot.test.ts
git commit -m "feat(backend): GET /snapshot/export — project snapshot of competitors + posts"
```

---

## Task 4: Backend snapshot module — import

Add the Zod schema, `importSnapshot`, and the import route. Test round-trip, idempotency, handle conflict, orphan posts, and invalid schema.

**Files:**
- Modify: `packages/backend/src/snapshot.ts`
- Test: `packages/backend/tests/snapshot.test.ts`

- [ ] **Step 1: Add the failing import tests**

First, extend the top-of-file `@anubis/shared` type import to also bring in `ImportSnapshotResult`:

```typescript
import type { ImportSnapshotResult, ProjectSnapshot } from '@anubis/shared'
```

(Replace the existing `import type { ProjectSnapshot } from '@anubis/shared'` line from Task 3.)

Then append these `describe` blocks to `packages/backend/tests/snapshot.test.ts`:

```typescript
function sampleSnapshot(): ProjectSnapshot {
  return {
    kind: 'anubis-project-snapshot',
    schemaVersion: 1,
    exportedAt: 123,
    app: { name: 'anubis', version: 'test' },
    project: { id: 'default', name: 'Default Project' },
    competitors: [
      { handle: '@roundtrip', displayName: 'RT', followers: 100 },
    ],
    capturedPosts: [
      { competitorHandle: '@roundtrip', username: 'rt', postUrl: 'https://instagram.com/p/RT1/', likes: 5 },
      { competitorHandle: '@roundtrip', username: 'rt', postUrl: 'https://instagram.com/p/RT2/', likes: 6 },
    ],
  }
}

describe('snapshot import', () => {
  it('round-trips: creates the competitor and its posts', async () => {
    const { getStack } = await import('../src/services.js')
    const { importSnapshot } = await import('../src/snapshot.js')
    const stack = getStack()

    const res = importSnapshot('default', sampleSnapshot())
    expect(res.competitors).toEqual({ created: 1, matched: 0 })
    expect(res.posts.imported).toBe(2)
    expect(res.posts.skipped).toBe(0)
    expect(res.warnings).toEqual([])

    const comp = stack.competitors.list('default').find((c) => c.handle === '@roundtrip')
    expect(comp).toBeTruthy()
    expect(stack.capturedPosts.countForCompetitor(comp!.id)).toBe(2)
    // postCount refreshed on the competitor
    expect(comp!.postCount).toBe(2)
  })

  it('is idempotent: re-importing the same file adds nothing new', async () => {
    const { importSnapshot } = await import('../src/snapshot.js')
    const res = importSnapshot('default', sampleSnapshot())
    expect(res.competitors.created).toBe(0)
    expect(res.competitors.matched).toBe(1)
    expect(res.posts.imported).toBe(0)
    expect(res.posts.skipped).toBe(2)
  })

  it('matches an existing competitor by handle without duplicating', async () => {
    const { getStack } = await import('../src/services.js')
    const { importSnapshot } = await import('../src/snapshot.js')
    const stack = getStack()

    const before = stack.competitors.list().filter((c) => c.handle === '@roundtrip').length
    importSnapshot('default', sampleSnapshot())
    const after = stack.competitors.list().filter((c) => c.handle === '@roundtrip').length
    expect(after).toBe(before) // still exactly one
  })

  it('skips posts whose competitor handle is unknown, with a warning', async () => {
    const { importSnapshot } = await import('../src/snapshot.js')
    // Reference a handle that exists in neither the snapshot nor the DB, so the
    // posts are genuinely orphaned (do NOT reuse @roundtrip — it exists by now).
    const snap: ProjectSnapshot = {
      kind: 'anubis-project-snapshot',
      schemaVersion: 1,
      exportedAt: 1,
      app: { name: 'anubis', version: 'test' },
      project: { id: 'default', name: 'Default Project' },
      competitors: [],
      capturedPosts: [
        { competitorHandle: '@ghost-xyz', username: 'g', postUrl: 'https://instagram.com/p/G1/' },
        { competitorHandle: '@ghost-xyz', username: 'g', postUrl: 'https://instagram.com/p/G2/' },
      ],
    }
    const res = importSnapshot('default', snap)
    expect(res.posts.imported).toBe(0)
    expect(res.warnings.length).toBe(1)
    expect(res.warnings[0]).toMatch(/2 post/)
  })

  it('rejects a wrong-kind file with 400 via the route', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot: { kind: 'something-else', schemaVersion: 1, competitors: [], capturedPosts: [] } }),
    })
    expect(res.status).toBe(400)
  })

  it('imports via the route and returns the summary', async () => {
    const { default: app } = await import('../src/app.js')
    const snap = sampleSnapshot()
    snap.competitors = [{ handle: '@viaroute' }]
    snap.capturedPosts = [{ competitorHandle: '@viaroute', username: 'vr', postUrl: 'https://instagram.com/p/VR1/' }]
    const res = await app.request('/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', snapshot: snap }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ImportSnapshotResult
    expect(body.competitors.created).toBe(1)
    expect(body.posts.imported).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/backend/tests/snapshot.test.ts -t "import"`
Expected: FAIL — `importSnapshot` is not exported from `../src/snapshot.js`.

- [ ] **Step 3: Add the schema + import logic to `snapshot.ts`**

Add these imports/usages to `packages/backend/src/snapshot.ts`. Place the Zod schema and `importSnapshot` **above** the `/* ---------- routes ---------- */` section, then add the import route in the routes section.

Schema + helper (add after `buildSnapshot`):

```typescript
/* ---------- import ---------- */

const SnapshotCompetitorSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().optional(),
  niche: z.string().optional(),
  tint: z.string().optional(),
  followers: z.number().int().nonnegative().optional(),
  avgLikes: z.number().int().nonnegative().optional(),
  postCount: z.number().int().nonnegative().optional(),
  lastRefreshedAt: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
  bio: z.string().optional(),
  level: z.enum(['black', 'green', 'yellow', 'red']).optional(),
  addedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
})

const SnapshotCapturedPostSchema = z.object({
  competitorHandle: z.string().min(1),
  username: z.string().min(1),
  postUrl: z.string().min(1),
  caption: z.string().optional(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  postedAt: z.string().optional(),
  mediaKind: z.enum(['image', 'video', 'carousel']).optional(),
  mediaUrl: z.string().optional(),
  carouselCount: z.number().int().nonnegative().optional(),
  capturedAt: z.number().int().nonnegative().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
})

export const ProjectSnapshotSchema = z.object({
  kind: z.literal('anubis-project-snapshot'),
  schemaVersion: z.literal(1),
  exportedAt: z.number().optional(),
  app: z.object({ name: z.string().optional(), version: z.string().optional() }).optional(),
  project: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      emoji: z.string().optional(),
      color: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  competitors: z.array(SnapshotCompetitorSchema),
  capturedPosts: z.array(SnapshotCapturedPostSchema),
})

type ValidatedSnapshot = z.infer<typeof ProjectSnapshotSchema>

function normHandle(handle: string): string {
  return handle.trim().toLowerCase()
}

export function importSnapshot(
  targetProjectId: string,
  snapshot: ValidatedSnapshot,
): ImportSnapshotResult {
  const stack = getStack()
  if (!stack.projects.findById(targetProjectId)) throw notFound(targetProjectId)

  return stack.transaction((): ImportSnapshotResult => {
    const warnings: string[] = []
    let created = 0
    let matched = 0

    // Handles are globally unique → resolve against ALL competitors.
    const byHandle = new Map<string, { id: string; projectId: string }>()
    for (const c of stack.competitors.list()) {
      byHandle.set(normHandle(c.handle), { id: c.id, projectId: c.projectId ?? 'default' })
    }

    // 1. Resolve or create competitors.
    for (const sc of snapshot.competitors) {
      const key = normHandle(sc.handle)
      if (byHandle.has(key)) {
        matched++
        continue
      }
      const c = stack.competitors.create({
        handle: sc.handle,
        projectId: targetProjectId,
        displayName: sc.displayName,
        niche: sc.niche,
        tint: sc.tint,
        followers: sc.followers,
        avgLikes: sc.avgLikes,
        notes: sc.notes,
        bio: sc.bio,
        level: sc.level,
      })
      byHandle.set(key, { id: c.id, projectId: c.projectId ?? targetProjectId })
      created++
    }

    // 2. Build post rows; collect orphans (handle not in file or DB).
    const now = Date.now()
    const rows: CapturedPost[] = []
    let orphans = 0
    for (const sp of snapshot.capturedPosts) {
      const owner = byHandle.get(normHandle(sp.competitorHandle))
      if (!owner) {
        orphans++
        continue
      }
      rows.push({
        id: randomUUID(),
        competitorId: owner.id,
        projectId: owner.projectId,
        username: sp.username,
        postUrl: sp.postUrl,
        caption: sp.caption,
        likes: sp.likes,
        comments: sp.comments,
        postedAt: sp.postedAt,
        mediaKind: sp.mediaKind,
        mediaUrl: sp.mediaUrl,
        carouselCount: sp.carouselCount,
        capturedAt: sp.capturedAt ?? now,
        raw: sp.raw,
      })
    }
    if (orphans > 0) {
      warnings.push(`${orphans} post(s) skipped: competitor handle not found in snapshot or database.`)
    }

    // 3. Net-new = sum of per-competitor counts after minus before.
    const affected = [...new Set(rows.map((r) => r.competitorId))]
    const countAll = () =>
      affected.reduce((n, id) => n + stack.capturedPosts.countForCompetitor(id), 0)
    const before = countAll()
    const { inserted: uniqueCandidates } = stack.capturedPosts.upsertMany(rows)
    const after = countAll()
    const imported = after - before
    const skipped = uniqueCandidates - imported

    // 4. Refresh competitor post counts.
    for (const id of affected) {
      stack.competitors.update(id, { postCount: stack.capturedPosts.countForCompetitor(id) })
    }

    return {
      ok: true,
      projectId: targetProjectId,
      competitors: { created, matched },
      posts: { imported, skipped },
      warnings,
    }
  })
}
```

Add the import route in the routes section (after the export route):

```typescript
const ImportBody = z.object({
  projectId: z.string().min(1).optional(),
  snapshot: ProjectSnapshotSchema,
}).strict()

snapshotRoutes.post('/import', async (c) => {
  const body = ImportBody.parse(await c.req.json())
  return c.json(importSnapshot(body.projectId ?? 'default', body.snapshot))
})
```

- [ ] **Step 4: Run the import tests to verify they pass**

Run: `pnpm vitest run packages/backend/tests/snapshot.test.ts`
Expected: PASS — all export and import tests (8 tests total).

> If you see `ERR_DLOPEN_FAILED` for better-sqlite3, run `pnpm rebuild better-sqlite3`, then re-run. If `stack.transaction is not a function`, the `@anubis/conversation` rebuild from Task 2 didn't happen — run `pnpm --filter @anubis/conversation build`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/snapshot.ts packages/backend/tests/snapshot.test.ts
git commit -m "feat(backend): POST /snapshot/import — atomic competitor+post restore by handle"
```

---

## Task 5: Frontend API helpers

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Add the type import**

At the top of `packages/frontend/src/api.ts`, add `ProjectSnapshot`, `ImportSnapshotInput`, and `ImportSnapshotResult` to the existing `@anubis/shared` type import (find the `import type { … } from '@anubis/shared'` line and extend it):

```typescript
import type {
  // …existing imports…
  ProjectSnapshot,
  ImportSnapshotInput,
  ImportSnapshotResult,
} from '@anubis/shared'
```

- [ ] **Step 2: Add the two helpers**

Append to `packages/frontend/src/api.ts` (uses the file's existing private `api<T>()` helper and `getApiBaseUrl()` machinery):

```typescript
export async function exportProjectSnapshot(projectId?: string): Promise<ProjectSnapshot> {
  const path = projectId
    ? `/snapshot/export?projectId=${encodeURIComponent(projectId)}`
    : '/snapshot/export'
  const r = await api<{ ok: true; snapshot: ProjectSnapshot }>(path)
  return r.snapshot
}

export async function importProjectSnapshot(
  input: ImportSnapshotInput,
): Promise<ImportSnapshotResult> {
  return api<ImportSnapshotResult>('/snapshot/import', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: no errors. (Frontend resolves `@anubis/shared` types from the dist you rebuilt in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): api helpers for project snapshot export/import"
```

---

## Task 6: Competitors page — Export/Import buttons

Add two toolbar buttons. Export downloads the snapshot as a file; Import reads a chosen file and posts it, then refreshes the list and shows a result banner.

**Files:**
- Modify: `packages/frontend/src/pages/competitors.tsx`

Context the engineer needs (already in this file):
- `const { activeProject } = useProject()` (line 92) — `activeProject?.id` is the project id.
- `async function refresh()` (line 170) reloads the list.
- `setBanner({ kind: 'success' | 'error', message })` (state at line 95) shows a status banner.
- `const [busy, setBusy] = useState(false)` (line 96).
- The toolbar buttons live in a flex row ending at line 372; the "Add competitor" button is at lines 363-371. `DownloadCloudIcon` is already imported (line 5).

- [ ] **Step 1: Add an upload icon to the lucide import**

In the `lucide-react` import block (lines 2-13), add `UploadCloudIcon`:

```typescript
import {
  CheckIcon,
  CheckSquareIcon,
  DownloadCloudIcon,
  Edit3Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UploadCloudIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react'
```

- [ ] **Step 2: Add the API imports**

Extend the `@/api` import (lines 20-25) to include the two helpers:

```typescript
import {
  createCompetitor,
  deleteCompetitor,
  exportProjectSnapshot,
  importProjectSnapshot,
  listCompetitors,
  updateCompetitor,
} from '@/api'
```

- [ ] **Step 3: Add a hidden file-input ref and the handlers**

Add `useRef` to the React import on line 1:

```typescript
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
```

Inside `CompetitorsPage`, right after `async function refresh() { … }` (after line 180), add:

```typescript
  const importInputRef = useRef<HTMLInputElement | null>(null)

  async function handleExport() {
    setBusy(true)
    setBanner(null)
    try {
      const snapshot = await exportProjectSnapshot(activeProject?.id || undefined)
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const slug = (activeProject?.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const a = document.createElement('a')
      a.href = url
      a.download = `anubis-${slug || 'project'}-${date}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setBanner({
        kind: 'success',
        message: `Exported ${snapshot.competitors.length} competitor(s) and ${snapshot.capturedPosts.length} post(s).`,
      })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Export failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true)
    setBanner(null)
    try {
      const text = await file.text()
      const snapshot = JSON.parse(text)
      if (!snapshot || snapshot.kind !== 'anubis-project-snapshot') {
        throw new Error('Not an Anubis project snapshot file.')
      }
      const result = await importProjectSnapshot({ projectId: activeProject?.id || undefined, snapshot })
      await refresh()
      const parts = [
        `${result.competitors.created} new competitor(s), ${result.competitors.matched} matched`,
        `${result.posts.imported} post(s) imported, ${result.posts.skipped} skipped`,
      ]
      if (result.warnings.length) parts.push(result.warnings.join(' '))
      setBanner({ kind: 'success', message: `Import complete — ${parts.join('; ')}.` })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Import failed.' })
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 4: Add the buttons + hidden input to the toolbar**

In the toolbar flex row, insert these right **before** the "Find competitors" button (before line 354's `<button>` for Find competitors), so order reads Capture / Export / Import / Find / Add:

```tsx
            <button
              type='button'
              onClick={handleExport}
              disabled={busy || selectMode}
              className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
            >
              <DownloadCloudIcon className='size-[15px]' strokeWidth={2} />
              Export
            </button>
            <button
              type='button'
              onClick={() => importInputRef.current?.click()}
              disabled={busy || selectMode}
              className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
            >
              <UploadCloudIcon className='size-[15px]' strokeWidth={2} />
              Import
            </button>
            <input
              ref={importInputRef}
              type='file'
              accept='application/json,.json'
              className='hidden'
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = '' // allow re-importing the same file
                if (file) void handleImportFile(file)
              }}
            />
```

- [ ] **Step 5: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: no errors.

- [ ] **Step 6: Run the frontend test suite (sanity, no regressions)**

Run: `pnpm --filter @anubis/frontend test`
Expected: PASS (no snapshot-specific frontend tests added; this confirms nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/competitors.tsx
git commit -m "feat(frontend): Export/Import buttons on the Competitors page"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 2: Run the backend snapshot tests once more**

Run: `pnpm vitest run packages/backend/tests/snapshot.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Run the shared tests**

Run: `pnpm vitest run packages/shared/tests`
Expected: PASS.

- [ ] **Step 4: Confirm the build chain is clean for the edited packages**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build && pnpm --filter @anubis/frontend build`
Expected: all four build with no errors.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run the app (`pnpm dev`), open the Competitors page, click **Export** → a `anubis-<project>-<date>.json` file downloads. Click **Import**, choose that file → the success banner reports matched competitors and skipped posts (idempotent), and the list reloads.

- [ ] **Step 6: Final commit if anything changed during verification** (otherwise skip)

```bash
git add -A
git commit -m "chore: verification fixes for snapshot import/export"
```

---

## Self-review notes (for the implementer)

- **Net-new math:** `upsertMany` returns the deduped candidate count, not new rows; that's why `imported` is derived from `countForCompetitor` before/after, and `skipped = uniqueCandidates - imported`. Don't use `inserted` as "imported."
- **Posts land in the competitor's project**, not necessarily the target project, because handles are global and a matched competitor keeps its existing project. This is the documented behavior — see the spec.
- **Atomicity** relies on `stack.transaction` (Task 2). If it's missing at runtime, the conversation package wasn't rebuilt.
- **Rebuild order matters:** shared → conversation → backend/frontend. Backend tests load `@anubis/conversation` from dist.
```
