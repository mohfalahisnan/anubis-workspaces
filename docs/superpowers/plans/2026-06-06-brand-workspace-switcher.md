# Brand Workspace Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-bar switcher over `@anubis/content-memory` brand workspaces (switch / create / rename / archive) and scope competitors, content/posts, and workflows to the active brand.

**Architecture:** Client owns the active workspace (React context + `localStorage`), passing `workspaceId` as an explicit query/body param to scoped list/create endpoints (backend stays stateless — same convention the existing `/content-memory/*` routes use). New brand-workspace CRUD routes are composed into the existing content-memory router. Data scoping is added at the repo layer (competitors filter, posts via `competitors` join, workflows via a new `workspace_id` column).

**Tech Stack:** TypeScript ESM monorepo (pnpm), Hono + Zod backend, better-sqlite3 (raw SQL migrations + repo pattern), React 19 + Vite + Tailwind + radix `dropdown-menu`/`dialog`, vitest.

> ⚠️ **Base branch:** This work depends on the `@anubis/content-memory` package, migration `010_competitors_workspace.sql`, and `competitors.workspace_id` — all of which live **only on `feat/scoped-content-memory`** (they are NOT on `main`). Create the implementation branch/worktree from `feat/scoped-content-memory`. Verify before starting: `git ls-tree -r --name-only HEAD -- packages/content-memory | head` must be non-empty.

> **Spec:** `docs/superpowers/specs/2026-06-06-brand-workspace-switcher-design.md`.

> **Build order (load-bearing):** `@anubis/shared` → `@anubis/content-memory` → `@anubis/conversation` → `@anubis/backend` → `@anubis/frontend`. After changing a lower package, build it before testing a higher one (e.g. `pnpm --filter @anubis/content-memory build`). Backend/frontend vitest runs resolve workspace sources, but if an import of a changed `@anubis/*` package fails to resolve, build that package first.

---

## Task 1: Shared brand-workspace types

**Files:**
- Modify: `packages/shared/src/index.ts` (near the existing `WorkspaceSummary` / `ListResponse` block, ~line 352–384)

- [ ] **Step 1: Add the types**

Add after the existing `WorkspaceListResponse` line:

```ts
/* Brand workspace (content-memory) — distinct from the filesystem WorkspaceSummary above. */
export interface BrandWorkspaceSummary {
  id: string
  name: string
  brandSummary?: string | null
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

export type BrandWorkspaceListResponse = ListResponse<BrandWorkspaceSummary>

export interface CreateBrandWorkspaceInput {
  name: string
  brandSummary?: string
}

export interface UpdateBrandWorkspaceInput {
  name?: string
  brandSummary?: string | null
  status?: 'active' | 'archived'
}
```

- [ ] **Step 2: Add `workspaceId` to scoped input types**

Find `CreateCompetitorInput` in this file and add an optional field (keep other fields unchanged):

```ts
  // ...existing CreateCompetitorInput fields...
  workspaceId?: string
```

Find `ListPostsOpts` in this file and add:

```ts
  workspaceId?: string
```

> If `CreateCompetitorInput` or `ListPostsOpts` are not declared in `shared` (search first: `rg -n "CreateCompetitorInput|ListPostsOpts" packages/shared/src`), skip the missing one here — it is handled in its own package in Task 4 / Task 5.

- [ ] **Step 3: Build shared**

Run: `pnpm --filter @anubis/shared build`
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): brand-workspace summary + scoped input types"
```

---

## Task 2: content-memory — `update()` on repo + service

**Files:**
- Modify: `packages/content-memory/src/db/repositories/brand-workspaces-repo.ts`
- Modify: `packages/content-memory/src/workspaces/brand-workspaces-service.ts`
- Test: `packages/content-memory/tests/brand-workspaces-service.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  CONTENT_MEMORY_MIGRATIONS,
  BrandWorkspacesService,
  BrandWorkspacesRepo,
  DEFAULT_WORKSPACE_ID,
} from '@anubis/content-memory'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const m of [...CONTENT_MEMORY_MIGRATIONS].sort((a, b) => a.version - b.version)) {
    db.exec(m.sql)
  }
  return db
}

describe('BrandWorkspacesService.update', () => {
  it('renames a workspace and bumps updatedAt', () => {
    const svc = new BrandWorkspacesService(new BrandWorkspacesRepo(makeDb()))
    const ws = svc.create({ name: 'Acme' }, 1000)
    const updated = svc.update(ws.id, { name: 'Acme Co' }, 2000)
    expect(updated?.name).toBe('Acme Co')
    expect(updated?.updatedAt).toBe(2000)
    expect(svc.get(ws.id)?.name).toBe('Acme Co')
  })

  it('updates brandSummary and archives', () => {
    const svc = new BrandWorkspacesService(new BrandWorkspacesRepo(makeDb()))
    const ws = svc.create({ name: 'Acme' }, 1000)
    const updated = svc.update(ws.id, { brandSummary: 'gentle skincare', status: 'archived' }, 2000)
    expect(updated?.brandSummary).toBe('gentle skincare')
    expect(updated?.status).toBe('archived')
  })

  it('returns null for an unknown id', () => {
    const svc = new BrandWorkspacesService(new BrandWorkspacesRepo(makeDb()))
    expect(svc.update('nope', { name: 'x' }, 2000)).toBeNull()
  })

  it('seeds the default workspace via migration', () => {
    const svc = new BrandWorkspacesService(new BrandWorkspacesRepo(makeDb()))
    expect(svc.get(DEFAULT_WORKSPACE_ID)?.id).toBe(DEFAULT_WORKSPACE_ID)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/brand-workspaces-service.test.ts`
Expected: FAIL — `svc.update is not a function`.

- [ ] **Step 3: Add `update()` to the repo**

In `brand-workspaces-repo.ts`, add this method to the `BrandWorkspacesRepo` class (after `list()`):

```ts
  update(
    id: string,
    patch: Partial<Pick<BrandWorkspace, 'name' | 'brandSummary' | 'status'>>,
    now: number,
  ): BrandWorkspace | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: BrandWorkspace = { ...cur, ...patch, updatedAt: now }
    this.db
      .prepare(
        `UPDATE brand_workspaces
         SET name = ?, brand_summary = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.name, next.brandSummary, next.status, next.updatedAt, id)
    return next
  }
```

- [ ] **Step 4: Add `update()` to the service**

In `brand-workspaces-service.ts`, add to the `BrandWorkspacesService` class:

```ts
  update(
    id: string,
    input: { name?: string; brandSummary?: string | null; status?: 'active' | 'archived' },
    now: number = Date.now(),
  ): BrandWorkspace | null {
    return this.repo.update(id, input, now)
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/brand-workspaces-service.test.ts`
Expected: PASS (4 tests). If the import of `@anubis/content-memory` fails to resolve, run `pnpm --filter @anubis/content-memory build` first.

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/db/repositories/brand-workspaces-repo.ts packages/content-memory/src/workspaces/brand-workspaces-service.ts packages/content-memory/tests/brand-workspaces-service.test.ts
git commit -m "feat(content-memory): BrandWorkspacesService.update (rename/summary/archive)"
```

---

## Task 3: Backend brand-workspace routes

**Files:**
- Create: `packages/backend/src/brand-workspaces.ts`
- Modify: `packages/backend/src/content-memory.ts` (compose the sub-router)
- Test: `packages/backend/tests/brand-workspaces-route.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-bw-test-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* best-effort */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('brand workspace REST', () => {
  it('lists the seeded default workspace', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/workspaces')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.some((w: { id: string }) => w.id === 'default-workspace')).toBe(true)
  })

  it('creates, then renames a workspace', async () => {
    const app = await loadApp()
    const created = await app.request('/content-memory/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })
    expect(created.status).toBe(201)
    const { workspace } = await created.json()
    expect(workspace.name).toBe('Acme')

    const patched = await app.request(`/content-memory/workspaces/${workspace.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Co' }),
    })
    expect(patched.status).toBe(200)
    expect((await patched.json()).workspace.name).toBe('Acme Co')
  })

  it('404s patching an unknown workspace', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/workspaces/nope', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects archiving the default workspace', async () => {
    const app = await loadApp()
    const res = await app.request('/content-memory/workspaces/default-workspace', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/brand-workspaces-route.test.ts`
Expected: FAIL — 404 on `/content-memory/workspaces` (route not mounted).

- [ ] **Step 3: Create the router**

`packages/backend/src/brand-workspaces.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { DEFAULT_WORKSPACE_ID } from '@anubis/content-memory'
import type { BrandWorkspaceSummary } from '@anubis/shared'
import { getStack } from './services.js'

const CreateBody = z.object({
  name: z.string().min(1),
  brandSummary: z.string().optional(),
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  brandSummary: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
}).strict()

function toSummary(w: {
  id: string; name: string; brandSummary: string | null
  status: 'active' | 'archived'; createdAt: number; updatedAt: number
}): BrandWorkspaceSummary {
  return {
    id: w.id, name: w.name, brandSummary: w.brandSummary,
    status: w.status, createdAt: w.createdAt, updatedAt: w.updatedAt,
  }
}

export const brandWorkspaceRoutes = new Hono()

brandWorkspaceRoutes.get('/', (c) => {
  const items = getStack().brandWorkspaces.list()
    .filter((w) => w.status === 'active')
    .map(toSummary)
  return c.json({ ok: true, items })
})

brandWorkspaceRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const workspace = getStack().brandWorkspaces.create(body)
  return c.json({ ok: true, workspace: toSummary(workspace) }, 201)
})

brandWorkspaceRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = UpdateBody.parse(await c.req.json())
  if (id === DEFAULT_WORKSPACE_ID && body.status === 'archived') {
    return c.json({ ok: false, error: 'cannot_archive_default' }, 400)
  }
  const workspace = getStack().brandWorkspaces.update(id, body)
  if (!workspace) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, workspace: toSummary(workspace) })
})
```

- [ ] **Step 4: Compose it into the content-memory router**

In `packages/backend/src/content-memory.ts`, add the import near the top:

```ts
import { brandWorkspaceRoutes } from './brand-workspaces.js'
```

…and after `export const contentMemoryRoutes = new Hono()` add:

```ts
contentMemoryRoutes.route('/workspaces', brandWorkspaceRoutes)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/brand-workspaces-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/brand-workspaces.ts packages/backend/src/content-memory.ts packages/backend/tests/brand-workspaces-route.test.ts
git commit -m "feat(backend): brand-workspace CRUD routes under /content-memory/workspaces"
```

---

## Task 4: Backend — scope competitors by workspace

**Files:**
- Modify: `packages/conversation/src/db/repositories/competitors-repo.ts` (`list`)
- Modify: `packages/conversation/src/competitors/competitors-service.ts` (`list`, `CreateCompetitorInput`, `create`)
- Modify: `packages/backend/src/competitors.ts` (`GET /`, `POST /` body)
- Test: `packages/backend/tests/competitors-scope.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-comp-scope-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch { /* */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})
async function loadApp() { return (await import('../src/app.js')).default }

describe('competitors workspace scoping', () => {
  it('lists only competitors in the requested workspace', async () => {
    const app = await loadApp()
    const ws = await (await app.request('/content-memory/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Brand B' }),
    })).json()
    const wsB = ws.workspace.id

    await app.request('/competitors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alpha' }), // defaults to default-workspace
    })
    await app.request('/competitors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'beta', workspaceId: wsB }),
    })

    const inB = await (await app.request(`/competitors?workspaceId=${wsB}`)).json()
    expect(inB.items.map((c: { handle: string }) => c.handle)).toEqual(['@beta'])

    const inDefault = await (await app.request('/competitors?workspaceId=default-workspace')).json()
    expect(inDefault.items.some((c: { handle: string }) => c.handle === '@alpha')).toBe(true)
    expect(inDefault.items.some((c: { handle: string }) => c.handle === '@beta')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/competitors-scope.test.ts`
Expected: FAIL — `@beta` appears in the default-workspace list (scoping not applied).

- [ ] **Step 3: Scope the repo `list()`**

In `competitors-repo.ts`, replace the `list()` method:

```ts
  list(workspaceId?: string): Competitor[] {
    const rows = workspaceId
      ? (this.db
          .prepare(
            'SELECT * FROM competitors WHERE deleted_at IS NULL AND workspace_id = ? ORDER BY added_at DESC',
          )
          .all(workspaceId) as Row[])
      : (this.db
          .prepare('SELECT * FROM competitors WHERE deleted_at IS NULL ORDER BY added_at DESC')
          .all() as Row[])
    return rows.map(toCompetitor)
  }
```

- [ ] **Step 4: Thread `workspaceId` through the service**

In `competitors-service.ts`:

Replace `list()`:

```ts
  list(workspaceId?: string): Competitor[] {
    return this.repo.list(workspaceId)
  }
```

Add `workspaceId?: string` to `CreateCompetitorInput`:

```ts
export interface CreateCompetitorInput {
  handle: string
  displayName?: string
  niche?: string
  tint?: string
  followers?: number
  avgLikes?: number
  notes?: string
  bio?: string
  level?: CompetitorLevelOverride
  workspaceId?: string
}
```

In `create()`, add `workspaceId` to the constructed `Competitor` (the repo already defaults a missing value to `default-workspace`):

```ts
    const competitor: Competitor = {
      id: newId(),
      handle,
      displayName: input.displayName?.trim() || undefined,
      niche: input.niche?.trim() || undefined,
      tint: input.tint ?? pickTintFor(handle),
      followers: input.followers,
      avgLikes: input.avgLikes,
      postCount: 0,
      notes: input.notes?.trim() || undefined,
      bio: input.bio?.trim() || undefined,
      level: input.level ?? undefined,
      workspaceId: input.workspaceId,
      addedAt: now,
      updatedAt: now,
    }
```

- [ ] **Step 5: Thread `workspaceId` through the route**

In `packages/backend/src/competitors.ts`:

Add `workspaceId` to `CreateBody`:

```ts
const CreateBody = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  tint: z.string().regex(HEX_COLOR).optional(),
  followers: z.number().int().nonnegative().optional(),
  avgLikes: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
  bio: z.string().optional(),
  level: z.enum(['black', 'green', 'yellow', 'red']).optional(),
  workspaceId: z.string().min(1).optional(),
}).strict()
```

Replace the `GET /` handler:

```ts
competitorRoutes.get('/', (c) => {
  const workspaceId = c.req.query('workspaceId')
  return c.json({ ok: true, items: getStack().competitors.list(workspaceId) })
})
```

(`POST /` already passes `body` straight to `create`, so `workspaceId` flows through unchanged.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/competitors-scope.test.ts`
Expected: PASS. Then run the existing competitor/route tests to confirm no regression: `pnpm vitest run packages/backend/tests/workflow.test.ts` is unrelated; run `pnpm vitest run packages/conversation` if competitor repo tests exist there.

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/repositories/competitors-repo.ts packages/conversation/src/competitors/competitors-service.ts packages/backend/src/competitors.ts packages/backend/tests/competitors-scope.test.ts
git commit -m "feat: scope competitors list/create by brand workspace"
```

---

## Task 5: Backend — scope content/posts by workspace (competitor join)

**Files:**
- Modify: `packages/conversation/src/db/repositories/captured-posts-repo.ts` (`ListPostsOpts`, `list`)
- Modify: `packages/backend/src/captures.ts` (`ListQuery`, `GET /` opts)
- Test: `packages/backend/tests/posts-scope.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-posts-scope-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch { /* */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

describe('posts workspace scoping', () => {
  it('returns only posts whose competitor is in the workspace', async () => {
    const app = (await import('../src/app.js')).default
    const { getStack } = await import('../src/services.js')
    const stack = getStack()

    const wsB = stack.brandWorkspaces.create({ name: 'Brand B' }).id
    const a = stack.competitors.create({ handle: 'alpha' })                 // default-workspace
    const b = stack.competitors.create({ handle: 'beta', workspaceId: wsB }) // Brand B

    stack.capturedPosts.upsert({
      id: 'p-a', competitorId: a.id, username: 'alpha', postUrl: 'https://x/a',
      capturedAt: 1,
    })
    stack.capturedPosts.upsert({
      id: 'p-b', competitorId: b.id, username: 'beta', postUrl: 'https://x/b',
      capturedAt: 2,
    })

    const inB = await (await app.request(`/posts?workspaceId=${wsB}`)).json()
    expect(inB.items.map((p: { id: string }) => p.id)).toEqual(['p-b'])
  })
})
```

> If `capturedPosts.upsert` requires more non-optional fields than shown, fill them from `CapturedPost` in `captured-posts-repo.ts` — the scoping assertion is what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/posts-scope.test.ts`
Expected: FAIL — both posts returned (no workspace filter).

- [ ] **Step 3: Add `workspaceId` to `ListPostsOpts` and the join in `list()`**

In `captured-posts-repo.ts`, add `workspaceId?: string` to the `ListPostsOpts` interface, then replace `list()`:

```ts
  list(opts: ListPostsOpts = {}): CapturedPost[] {
    const limit = opts.limit ?? 200
    const order =
      opts.orderBy === 'engagement'
        ? 'COALESCE(cp.likes, 0) DESC, COALESCE(cp.comments, 0) DESC'
        : "COALESCE(cp.posted_at, '') DESC, cp.captured_at DESC"

    const where: string[] = []
    const params: unknown[] = []
    if (opts.competitorId) { where.push('cp.competitor_id = ?'); params.push(opts.competitorId) }
    const join = opts.workspaceId ? 'JOIN competitors c ON c.id = cp.competitor_id' : ''
    if (opts.workspaceId) { where.push('c.workspace_id = ?'); params.push(opts.workspaceId) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sql = `SELECT cp.* FROM captured_posts cp ${join} ${whereSql} ORDER BY ${order} LIMIT ?`
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as Row[]
    return rows.map(toPost)
  }
```

> Note: selecting `cp.*` returns the same bare column names `toPost` already expects, so the mapper is unchanged.

- [ ] **Step 4: Thread `workspaceId` through the route**

In `packages/backend/src/captures.ts`, add to `ListQuery`:

```ts
const ListQuery = z.object({
  competitorId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  orderBy: z.enum(['recent', 'engagement']).optional(),
  workspaceId: z.string().optional(),
}).strict()
```

…and pass it into the list call inside `postRoutes.get('/')`:

```ts
  const rows = stack.capturedPosts.list({
    competitorId: opts.competitorId,
    limit: opts.limit ?? 60,
    orderBy: opts.orderBy ?? 'recent',
    workspaceId: opts.workspaceId,
  })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/posts-scope.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/db/repositories/captured-posts-repo.ts packages/backend/src/captures.ts packages/backend/tests/posts-scope.test.ts
git commit -m "feat: scope captured posts by brand workspace via competitor join"
```

---

## Task 6: Workflows — `workspace_id` migration + repo scoping

**Files:**
- Create: `packages/conversation/src/db/migrations/016_workflows_workspace.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Modify: `packages/conversation/src/db/repositories/workflows-repo.ts`
- Test: `packages/backend/tests/workflows-scope.test.ts` (create)

- [ ] **Step 1: Write the migration**

`016_workflows_workspace.sql`:

```sql
-- Brand owns its workflows. Nullable + NULL default so SQLite permits the
-- REFERENCES clause under foreign_keys=ON; then backfill legacy rows.
ALTER TABLE workflows
  ADD COLUMN workspace_id TEXT REFERENCES brand_workspaces(id) DEFAULT NULL;

UPDATE workflows
  SET workspace_id = 'default-workspace'
  WHERE workspace_id IS NULL;

CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
```

- [ ] **Step 2: Register the migration**

In `migrations/index.ts`, add after the `load(10, ...)` line:

```ts
  // 016 alters workflows; depends on brand_workspaces existing (8).
  load(16, '016_workflows_workspace.sql'),
```

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-wf-scope-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch { /* */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})
async function loadApp() { return (await import('../src/app.js')).default }

describe('workflows workspace scoping', () => {
  it('lists only workflows in the requested workspace', async () => {
    const app = await loadApp()
    const wsB = (await (await app.request('/content-memory/workspaces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Brand B' }),
    })).json()).workspace.id

    await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Default WF' }),
    })
    await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B WF', workspaceId: wsB }),
    })

    const inB = await (await app.request(`/workflows?workspaceId=${wsB}`)).json()
    expect(inB.items.map((w: { name: string }) => w.name)).toEqual(['B WF'])
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/workflows-scope.test.ts`
Expected: FAIL — both workflows listed (route/repo not scoped yet; route change lands in Task 7, but the repo change is here).

- [ ] **Step 5: Add `workspaceId` to the workflow repo types + `create` + `list`**

In `workflows-repo.ts`:

Add to `WorkflowRow`:

```ts
  workspace_id: string | null
```

Add to `Workflow`:

```ts
  workspaceId?: string
```

Add to `toWorkflow` return object:

```ts
    workspaceId: r.workspace_id ?? undefined,
```

Replace `create()`:

```ts
  create(input: { id: string; name: string; description?: string; now: number; workspaceId?: string }): Workflow {
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, description, draft_graph, published_graph,
          draft_updated_at, published_at, created_at, updated_at, workspace_id)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
      )
      .run(
        input.id, input.name, input.description ?? null, EMPTY_GRAPH,
        input.now, input.now, input.now, input.workspaceId ?? 'default-workspace',
      )
    return this.getOrThrow(input.id)
  }
```

Replace `list()`:

```ts
  list(workspaceId?: string): Workflow[] {
    const rows = workspaceId
      ? (this.db.prepare(`SELECT * FROM workflows WHERE workspace_id = ? ORDER BY updated_at DESC`)
          .all(workspaceId) as WorkflowRow[])
      : (this.db.prepare(`SELECT * FROM workflows ORDER BY updated_at DESC`).all() as WorkflowRow[])
    return rows.map(toWorkflow)
  }
```

- [ ] **Step 6: Build conversation, then re-run (still expected to fail on the route)**

Run: `pnpm --filter @anubis/conversation build` then `pnpm vitest run packages/backend/tests/workflows-scope.test.ts`
Expected: still FAIL — the route ignores `workspaceId` and `workflowsApi`/route create doesn't forward it yet. This is wired in Task 7. (If you prefer a green checkpoint here, commit after Task 7.)

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/migrations/016_workflows_workspace.sql packages/conversation/src/db/migrations/index.ts packages/conversation/src/db/repositories/workflows-repo.ts packages/backend/tests/workflows-scope.test.ts
git commit -m "feat(conversation): workflows.workspace_id (migration 016) + repo scoping"
```

---

## Task 7: Backend — workflow route scoping

**Files:**
- Modify: `packages/backend/src/workflow.ts` (`CreateBody`, `POST /`, `GET /`)

- [ ] **Step 1: Add `workspaceId` to the create body**

In `workflow.ts`, find `const CreateBody = z.object({ ... })` (near the top) and add `workspaceId: z.string().min(1).optional()` to it. Final shape (match existing field names):

```ts
const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  workspaceId: z.string().min(1).optional(),
})
```

- [ ] **Step 2: Forward it on create**

Replace the `workflowRoutes.post('/')` body's create call:

```ts
  const wf = stack.workflows.create({
    id: randomUUID(), name: body.name, description: body.description,
    now, workspaceId: body.workspaceId,
  })
```

- [ ] **Step 3: Scope the list**

In `workflowRoutes.get('/')`, replace `stack.workflows.list()` with:

```ts
  const items = stack.workflows.list(c.req.query('workspaceId')).map((wf) => {
```

- [ ] **Step 4: Run the scope test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/workflows-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing workflow route test (no regression)**

Run: `pnpm vitest run packages/backend/tests/workflow.test.ts`
Expected: PASS (existing tests unaffected — `workspaceId` is optional).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/workflow.ts
git commit -m "feat(backend): scope workflow list/create by brand workspace"
```

---

## Task 8: Frontend API functions

**Files:**
- Modify: `packages/frontend/src/api.ts` (brand-workspace fns + scoped params)
- Modify: `packages/frontend/src/api/workflows.ts` (`list`/`create` workspaceId)

- [ ] **Step 1: Add brand-workspace API functions**

In `api.ts`, add the import alongside the existing `@anubis/shared` type imports:

```ts
  type BrandWorkspaceSummary,
  type BrandWorkspaceListResponse,
  type CreateBrandWorkspaceInput,
  type UpdateBrandWorkspaceInput,
```

Add these functions (near `listWorkspaces`):

```ts
export async function listBrandWorkspaces(): Promise<BrandWorkspaceSummary[]> {
  const r = await api<BrandWorkspaceListResponse>('/content-memory/workspaces')
  return r.items
}

export async function createBrandWorkspace(
  input: CreateBrandWorkspaceInput,
): Promise<BrandWorkspaceSummary> {
  const r = await api<{ ok: true; workspace: BrandWorkspaceSummary }>(
    '/content-memory/workspaces',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return r.workspace
}

export async function updateBrandWorkspace(
  id: string,
  patch: UpdateBrandWorkspaceInput,
): Promise<BrandWorkspaceSummary> {
  const r = await api<{ ok: true; workspace: BrandWorkspaceSummary }>(
    `/content-memory/workspaces/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.workspace
}
```

- [ ] **Step 2: Add `workspaceId` to `listCompetitors` and `listPosts`**

Replace `listCompetitors`:

```ts
export async function listCompetitors(workspaceId?: string): Promise<CompetitorSummary[]> {
  const path = workspaceId
    ? `/competitors?workspaceId=${encodeURIComponent(workspaceId)}`
    : '/competitors'
  const r = await api<CompetitorListResponse>(path)
  return r.items
}
```

In `listPosts`, add the param mapping (after the `orderBy` line):

```ts
  if (opts.workspaceId) params.set('workspaceId', opts.workspaceId)
```

(`createCompetitor` already forwards its whole `input`; callers will include `workspaceId` — see Task 12.)

- [ ] **Step 3: Add `workspaceId` to the workflows API**

In `api/workflows.ts`, replace the `list` and `create` entries of `workflowsApi`:

```ts
  list:        (workspaceId?: string) =>
                jsonFetch<{ items: WorkflowSummary[] }>(
                  workspaceId ? `/workflows?workspaceId=${encodeURIComponent(workspaceId)}` : '/workflows',
                ),
  create:      (name: string, description?: string, workspaceId?: string) =>
                jsonFetch<WorkflowDetail>('/workflows', {
                  method: 'POST',
                  body: JSON.stringify({ name, description, workspaceId }),
                }),
```

- [ ] **Step 4: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck` (or `pnpm typecheck`)
Expected: exits 0. (If `ListPostsOpts`/`CreateCompetitorInput` lack `workspaceId`, ensure Task 1 added them in shared.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/api/workflows.ts
git commit -m "feat(frontend): brand-workspace API + workspaceId on scoped list/create"
```

---

## Task 9: Frontend — `WorkspaceProvider` / `useActiveWorkspace`

**Files:**
- Create: `packages/frontend/src/lib/workspace.tsx`
- Test: `packages/frontend/tests/lib/use-active-workspace.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

vi.mock('@/api', () => ({
  listBrandWorkspaces: vi.fn(),
  createBrandWorkspace: vi.fn(),
  updateBrandWorkspace: vi.fn(),
}))

import { listBrandWorkspaces } from '@/api'
import { WorkspaceProvider, useActiveWorkspace } from '@/lib/workspace'

function Probe() {
  const { activeWorkspace, workspaces } = useActiveWorkspace()
  return <div data-testid="active">{activeWorkspace?.name ?? '—'}:{workspaces.length}</div>
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(listBrandWorkspaces).mockResolvedValue([
    { id: 'default-workspace', name: 'Default', brandSummary: null, status: 'active', createdAt: 1, updatedAt: 1 },
    { id: 'ws-b', name: 'Brand B', brandSummary: null, status: 'active', createdAt: 2, updatedAt: 2 },
  ])
})

describe('useActiveWorkspace', () => {
  it('defaults to default-workspace and loads the list', async () => {
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>)
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('Default:2'))
  })

  it('falls back to default when the persisted id is absent from the list', async () => {
    localStorage.setItem('anubis.activeWorkspaceId', 'ghost')
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>)
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('Default:2'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/frontend/tests/lib/use-active-workspace.test.tsx`
Expected: FAIL — cannot resolve `@/lib/workspace`.

- [ ] **Step 3: Implement the provider**

`packages/frontend/src/lib/workspace.tsx`:

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import type { BrandWorkspaceSummary } from '@anubis/shared'
import {
  listBrandWorkspaces, createBrandWorkspace, updateBrandWorkspace,
} from '@/api'

const STORAGE_KEY = 'anubis.activeWorkspaceId'
const DEFAULT_ID = 'default-workspace'

interface WorkspaceState {
  workspaces: BrandWorkspaceSummary[]
  activeWorkspaceId: string
  activeWorkspace: BrandWorkspaceSummary | undefined
  setActiveWorkspace: (id: string) => void
  refetch: () => void
  create: (input: { name: string; brandSummary?: string }) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  archive: (id: string) => Promise<void>
}

const Ctx = createContext<WorkspaceState | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<BrandWorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveId] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_ID
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ID
  })

  const refetch = useCallback(() => {
    listBrandWorkspaces().then(setWorkspaces).catch(() => {})
  }, [])

  useEffect(() => { refetch() }, [refetch])

  // Fall back to default if the persisted id is gone (archived/deleted).
  useEffect(() => {
    if (workspaces.length === 0) return
    if (!workspaces.some((w) => w.id === activeWorkspaceId)) {
      setActiveId(DEFAULT_ID)
      localStorage.setItem(STORAGE_KEY, DEFAULT_ID)
    }
  }, [workspaces, activeWorkspaceId])

  const setActiveWorkspace = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setActiveId(id)
  }, [])

  const create = useCallback(async (input: { name: string; brandSummary?: string }) => {
    const ws = await createBrandWorkspace(input)
    setWorkspaces((prev) => [...prev, ws])
    setActiveWorkspace(ws.id)
  }, [setActiveWorkspace])

  const rename = useCallback(async (id: string, name: string) => {
    const ws = await updateBrandWorkspace(id, { name })
    setWorkspaces((prev) => prev.map((w) => (w.id === id ? ws : w)))
  }, [])

  const archive = useCallback(async (id: string) => {
    await updateBrandWorkspace(id, { status: 'archived' })
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
    if (id === activeWorkspaceId) setActiveWorkspace(DEFAULT_ID)
  }, [activeWorkspaceId, setActiveWorkspace])

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  )

  const value = useMemo<WorkspaceState>(() => ({
    workspaces, activeWorkspaceId, activeWorkspace,
    setActiveWorkspace, refetch, create, rename, archive,
  }), [workspaces, activeWorkspaceId, activeWorkspace, setActiveWorkspace, refetch, create, rename, archive])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActiveWorkspace(): WorkspaceState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useActiveWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}

export const DEFAULT_WORKSPACE_ID = DEFAULT_ID
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/frontend/tests/lib/use-active-workspace.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/workspace.tsx packages/frontend/tests/lib/use-active-workspace.test.tsx
git commit -m "feat(frontend): WorkspaceProvider + useActiveWorkspace (localStorage-backed)"
```

---

## Task 10: Wire `WorkspaceProvider` into the app

**Files:**
- Modify: `packages/frontend/src/App.tsx`

- [ ] **Step 1: Wrap the app**

Replace the contents of `App.tsx`:

```tsx
import { Dashboard } from './components/dashboard'
import { NavigationProvider } from './lib/navigation'
import { WorkspaceProvider } from './lib/workspace'

function App() {
  return (
    <WorkspaceProvider>
      <NavigationProvider>
        <Dashboard />
      </NavigationProvider>
    </WorkspaceProvider>
  )
}

export default App
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "feat(frontend): mount WorkspaceProvider around the dashboard"
```

---

## Task 11: `WorkspaceSwitcher` component + top-bar wiring

**Files:**
- Create: `packages/frontend/src/components/dashboard/workspace-switcher.tsx`
- Modify: `packages/frontend/src/components/dashboard/topbar.tsx`

- [ ] **Step 1: Build the switcher component**

`workspace-switcher.tsx` (uses the existing `dropdown-menu` and `dialog` primitives):

```tsx
import { useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, PencilIcon, ArchiveIcon } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useActiveWorkspace, DEFAULT_WORKSPACE_ID } from '@/lib/workspace'

type DialogMode = { kind: 'create' } | { kind: 'rename'; id: string; name: string } | null

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspace, create, rename, archive } =
    useActiveWorkspace()
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  function openCreate() { setName(''); setDialog({ kind: 'create' }) }
  function openRename(id: string, current: string) { setName(current); setDialog({ kind: 'rename', id, name: current }) }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || !dialog) return
    setBusy(true)
    try {
      if (dialog.kind === 'create') await create({ name: trimmed })
      else await rename(dialog.id, trimmed)
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <span className="truncate">{activeWorkspace?.name ?? 'Workspace'}</span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => setActiveWorkspace(w.id)}
              className="group flex items-center gap-2"
            >
              <CheckIcon className={cn('size-3.5', w.id === activeWorkspaceId ? 'opacity-100' : 'opacity-0')} />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <button
                type="button"
                aria-label="Rename workspace"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRename(w.id, w.name) }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <PencilIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
              </button>
              {w.id !== DEFAULT_WORKSPACE_ID && (
                <button
                  type="button"
                  aria-label="Archive workspace"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void archive(w.id) }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <ArchiveIcon className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openCreate()} className="gap-2">
            <PlusIcon className="size-3.5" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === 'rename' ? 'Rename workspace' : 'New workspace'}</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            autoFocus
            placeholder="Workspace name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
              {dialog?.kind === 'rename' ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

> Verify the exact export names in `@/components/ui/dropdown-menu` and `@/components/ui/dialog` (`rg -n "export" packages/frontend/src/components/ui/dropdown-menu.tsx packages/frontend/src/components/ui/dialog.tsx`). They follow shadcn conventions; adjust import names if the repo's differ.

- [ ] **Step 2: Render it in the top bar**

In `topbar.tsx`, import and place the switcher to the left of the breadcrumb. Add the import:

```tsx
import { WorkspaceSwitcher } from './workspace-switcher'
```

Insert `<WorkspaceSwitcher />` as the first child inside the `<header>`, before the breadcrumb block:

```tsx
    <header className='sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6'>
      <WorkspaceSwitcher />
      {breadcrumb && (
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/dashboard/workspace-switcher.tsx packages/frontend/src/components/dashboard/topbar.tsx
git commit -m "feat(frontend): workspace switcher in the top bar (switch/create/rename/archive)"
```

---

## Task 12: Scope the Competitors page

**Files:**
- Modify: `packages/frontend/src/pages/competitors.tsx`

- [ ] **Step 1: Read the active workspace and scope the fetch + create**

Add the hook import near the top:

```tsx
import { useActiveWorkspace } from '@/lib/workspace'
```

Inside the competitors page component, read the active id (place with the other hooks, near the `useState` block):

```tsx
  const { activeWorkspaceId } = useActiveWorkspace()
```

Replace `refresh()` to pass the workspace and re-run on switch:

```tsx
  async function refresh() {
    try {
      setItems(await listCompetitors(activeWorkspaceId))
    } catch (e) {
      setItems([])
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load competitors.',
      })
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])
```

Where the page calls `createCompetitor(...)` (the add-competitor submit handler), include the workspace in the payload, e.g.:

```tsx
    await createCompetitor({ ...input, workspaceId: activeWorkspaceId })
```

> Find the exact call: `rg -n "createCompetitor" packages/frontend/src/pages/competitors.tsx packages/frontend/src/pages/competitor-dialogs.tsx`. Add `workspaceId: activeWorkspaceId` to the object passed in. If the create lives in `competitor-dialogs.tsx`, thread `activeWorkspaceId` in as a prop from the page.

- [ ] **Step 2: Typecheck + sanity build**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/competitors.tsx packages/frontend/src/pages/competitor-dialogs.tsx
git commit -m "feat(frontend): scope Competitors page by active workspace"
```

---

## Task 13: Scope the Content page

**Files:**
- Modify: `packages/frontend/src/pages/content.tsx`

- [ ] **Step 1: Scope the post fetch**

Add the import:

```tsx
import { useActiveWorkspace } from '@/lib/workspace'
```

Read the active id inside the component (with the other hooks):

```tsx
  const { activeWorkspaceId } = useActiveWorkspace()
```

Replace `refresh()` and its effect:

```tsx
  async function refresh() {
    setBusy(true)
    try {
      const items = await listPosts({ limit: 120, orderBy: 'recent', workspaceId: activeWorkspaceId })
      setPosts(items)
    } catch {
      setPosts([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/content.tsx
git commit -m "feat(frontend): scope Content page posts by active workspace"
```

---

## Task 14: Scope the Workflows page + dashboard live counts

**Files:**
- Modify: `packages/frontend/src/pages/workflows.tsx`
- Modify: `packages/frontend/src/components/dashboard/index.tsx` (`useLiveCounts`)

- [ ] **Step 1: Scope the workflows list + create**

In `workflows.tsx`, add the import:

```tsx
import { useActiveWorkspace } from '@/lib/workspace'
```

Read the active id in the component:

```tsx
  const { activeWorkspaceId } = useActiveWorkspace()
```

Replace the list effect to scope + re-run on switch:

```tsx
  useEffect(() => {
    workflowsApi.list(activeWorkspaceId).then((r) => setItems(r.items)).catch((e) => console.error(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])
```

Update the create call to assign the active workspace:

```tsx
    const wf = await workflowsApi.create(draftName.trim(), undefined, activeWorkspaceId)
```

- [ ] **Step 2: Scope the dashboard competitor count**

In `components/dashboard/index.tsx`, the `useLiveCounts` hook calls `listCompetitors()`. Make it workspace-aware so the home count matches the active brand:

Change the hook signature and call:

```tsx
function useLiveCounts(workspaceId: string): LiveCounts {
  const [counts, setCounts] = useState<LiveCounts>({})

  useEffect(() => {
    let active = true

    async function fetchAll() {
      const [profiles, conversations, skills, cron, competitors] = await Promise.allSettled([
        listProfiles(),
        listConversations({ limit: 200 }),
        listSkills(),
        listCronJobs(),
        listCompetitors(workspaceId),
      ])
      if (!active) return
      setCounts({
        profiles: profiles.status === 'fulfilled' ? profiles.value.length : undefined,
        conversations: conversations.status === 'fulfilled' ? conversations.value.length : undefined,
        skills: skills.status === 'fulfilled' ? skills.value.length : undefined,
        cron: cron.status === 'fulfilled' ? cron.value.length : undefined,
        competitors: competitors.status === 'fulfilled' ? competitors.value.length : undefined,
      })
    }

    void fetchAll()
    return () => { active = false }
  }, [workspaceId])

  return counts
}
```

In `HomePage`, read the active workspace and pass it in. Add the import at the top of the file:

```tsx
import { useActiveWorkspace } from '@/lib/workspace'
```

…and in `HomePage`:

```tsx
function HomePage() {
  const { navigate } = useNavigation()
  const { activeWorkspaceId } = useActiveWorkspace()
  const counts = useLiveCounts(activeWorkspaceId)
```

- [ ] **Step 3: Typecheck the whole frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/workflows.tsx packages/frontend/src/components/dashboard/index.tsx
git commit -m "feat(frontend): scope Workflows page + dashboard counts by active workspace"
```

---

## Task 15: Full verification

- [ ] **Step 1: Typecheck everything**

Run: `pnpm typecheck`
Expected: exits 0 across all packages.

- [ ] **Step 2: Run the new + affected tests**

Run:
```bash
pnpm vitest run packages/content-memory/tests/brand-workspaces-service.test.ts
pnpm vitest run packages/backend/tests/brand-workspaces-route.test.ts
pnpm vitest run packages/backend/tests/competitors-scope.test.ts
pnpm vitest run packages/backend/tests/posts-scope.test.ts
pnpm vitest run packages/backend/tests/workflows-scope.test.ts
pnpm vitest run packages/backend/tests/workflow.test.ts
pnpm vitest run packages/frontend/tests/lib/use-active-workspace.test.tsx
```
Expected: all PASS.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run `pnpm dev`, then in the app: the top bar shows a workspace switcher defaulting to the seeded "default-workspace"; create "Brand B"; the switcher switches active to Brand B; add a competitor while on Brand B; switch back to default — the Brand B competitor is hidden; switch to Brand B — it reappears. Repeat the visibility check on the Content and Workflows pages. Rename a workspace; archive Brand B and confirm the active workspace resets to default and Brand B drops out of the list.

- [ ] **Step 4: Final commit (if any smoke fixups)**

```bash
git add -A
git commit -m "chore: brand workspace switcher verification fixups"
```

---

## Notes for the implementer

- **DRY:** all scoped reads go through the active-workspace context; never read `localStorage` directly outside `workspace.tsx`.
- **YAGNI:** do not add tone/audience/offers/constraints editing UI — only name + summary are surfaced. No hard-delete; archive only.
- **Migration ownership:** `016` is conversation-owned (it ALTERs the conversation-owned `workflows` table), mirroring `010` for competitors. Do not renumber content-memory's 011–015.
- **No silent breakage:** every `workspaceId` param is optional end-to-end, so unscoped callers and existing tests keep working (default-workspace semantics preserved).
