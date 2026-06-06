# Design: Brand Workspace Switcher (frontend + scoping)

Date: 2026-06-06
Status: **Design approved (brainstorming) — spec ready, implementation not started**
Branch at time of writing: `feat/scoped-content-memory`

## 1. Goal

Surface the `@anubis/content-memory` **brand workspace** as a first-class, user-selectable
concept in the desktop UI. Add a **workspace switcher** in the top bar that lets the user
switch, create, and rename/archive brand workspaces, and scope the app's content data —
**competitors, content/posts, and workflows** — to the selected brand workspace.

Today the brand workspace entity exists in the data/services layer (`BrandWorkspacesService`,
seeded `default-workspace`, `competitors.workspace_id` from migration 010) but has **no HTTP
route and zero frontend presence**. This is the feature that makes it usable.

### Terminology guard

The repo has three unrelated "workspace" concepts (see
`packages/content-memory/README.md` naming note). This feature is **only** about the
content-memory **brand workspace**. To avoid collisions:
- Filesystem working directories (`WorkspaceSummary`, `/workspaces`, `workdir-picker`) — untouched.
- ai-agent MCP `workspaceId` — untouched.
- Brand workspace — this feature. New types are named `BrandWorkspace*`; new routes live under
  `/content-memory/workspaces`. The user-facing UI label is simply "Workspace".

## 2. Current reality (inventory)

- **Entity/service** — `BrandWorkspacesService` (`create`/`get`/`list` only, no `update`) +
  `BrandWorkspacesRepo` (`insert`/`findById`/`list`) in `@anubis/content-memory`. Exposed on
  `ConversationStack.brandWorkspaces`. `BrandWorkspace` = `{ id, name, brandSummary, toneOfVoice,
  audience, offers, constraints, status: 'active'|'archived', createdAt, updatedAt }`.
- **Seed** — migration `008_brand_workspaces.sql` seeds `default-workspace`. `DEFAULT_WORKSPACE_ID
  = 'default-workspace'`.
- **Competitors** — `competitors.workspace_id` added by `010_competitors_workspace.sql` (nullable,
  backfilled to `default-workspace`, indexed). `CompetitorsRepo.insert` defaults `workspaceId` to
  `default-workspace`, but `list()` does **not** filter by it and `create()` does not accept it.
  Backend `GET/POST /competitors` are unscoped.
- **Content/posts** — `captured_posts` has **no** `workspace_id`; ownership is derived via
  `competitor_id → competitors.workspace_id`. `CapturedPostsRepo.list()` supports an optional
  `competitorId` filter only. Backend `GET /posts`.
- **Workflows** — `workflows` table (`004_workflows.sql`) has **no** `workspace_id`.
  `stack.workflows` is the `WorkflowsRepo` directly. Backend `GET/POST /workflows`.
- **Frontend** — in-app navigation via `NavigationProvider` (no router). Top bar
  (`components/dashboard/topbar.tsx`) has breadcrumb + search + actions. `localStorage`-backed
  context precedent: `theme-provider.tsx`, `use-default-profile.ts`. UI primitives available:
  `dropdown-menu`, `dialog`, `input`, `button`, etc. Frontend hook tests live in
  `packages/frontend/tests/lib/`.

## 3. Key decision: state & scoping mechanism

**Client-driven `workspaceId` param** (chosen over server-side session state). The frontend owns
the active workspace (React context + `localStorage`); scoped list/create calls pass `workspaceId`
explicitly — consistent with the existing `/content-memory/*` routes, which already take
`workspaceId` in the body. The backend stays stateless; multiple views stay coherent; no hidden
global mutable state.

Default + fallback: active id defaults to `DEFAULT_WORKSPACE_ID`. If the persisted id is missing
from the fetched list (archived/deleted), fall back to `default-workspace`.

## 4. Architecture by layer

### 4.1 Shared (`@anubis/shared`)
Add:
- `BrandWorkspaceSummary` = `{ id, name, brandSummary?: string | null, status: 'active' | 'archived',
  createdAt: number, updatedAt: number }`.
- `BrandWorkspaceListResponse = ListResponse<BrandWorkspaceSummary>`.
- `CreateBrandWorkspaceInput = { name: string; brandSummary?: string }`.
- `UpdateBrandWorkspaceInput = { name?: string; brandSummary?: string | null; status?: 'active' | 'archived' }`.

(The richer `toneOfVoice/audience/offers/constraints` arrays stay server-side for now; the
summary is the only brand-detail field the switcher edits. YAGNI on the rest.)

### 4.2 content-memory (`@anubis/content-memory`)
- `BrandWorkspacesRepo.update(id, patch, now)` — `UPDATE brand_workspaces SET name=?, brand_summary=?,
  status=?, updated_at=? WHERE id=?`, reading current row for unset fields; returns the updated
  `BrandWorkspace` (or `null` if not found).
- `BrandWorkspacesService.update(id, input, now=Date.now())` — load, merge, persist, return.
- No migration change here (008 already defines the table; status/updated_at columns exist).

### 4.3 Backend routes
New router `packages/backend/src/brand-workspaces.ts` (`brandWorkspaceRoutes`), composed **into**
the existing content-memory router so there's a single `/content-memory` mount in `app.ts` and no
overlapping-prefix ambiguity: in `content-memory.ts`, `contentMemoryRoutes.route('/workspaces',
brandWorkspaceRoutes)`. Effective paths are under **`/content-memory/workspaces`**. Zod `.strict()`
bodies, errors normalized by `app.ts`.

| Method & path | Behavior |
|---|---|
| `GET /content-memory/workspaces` | List `status='active'` workspaces → `{ ok, items: BrandWorkspaceSummary[] }`. |
| `POST /content-memory/workspaces` | Create `{ name, brandSummary? }` → `{ ok, workspace }` (201). |
| `PATCH /content-memory/workspaces/:id` | Update `{ name?, brandSummary?, status? }` → `{ ok, workspace }` (404 if missing). |

Mapping `BrandWorkspace` → `BrandWorkspaceSummary` happens in the route (drop the array fields).

### 4.4 Backend scoping (thread `workspaceId`, default `default-workspace`)

**Competitors** (`competitors.ts` + service + repo)
- `CompetitorsRepo.list(workspaceId?)` → adds `AND workspace_id = ?` when provided.
- `CompetitorsService.list(workspaceId?)` passes through; `CreateCompetitorInput` gains optional
  `workspaceId`, threaded into the inserted `Competitor` (repo already defaults to
  `default-workspace`).
- `GET /competitors` reads `c.req.query('workspaceId')`; `POST /competitors` accepts optional
  `workspaceId` in the body.
- `captures.ts` `POST /posts` competitor lookups already key by `competitorId`; no change needed
  beyond the post list (below).

**Content/posts** (`captures.ts` + `captured-posts-repo.ts`)
- `CapturedPostsRepo.list({ workspaceId })` → when set, `JOIN competitors c ON c.id =
  captured_posts.competitor_id WHERE c.workspace_id = ?` (preserving existing `competitorId`,
  `orderBy`, `limit` options). Select `captured_posts.*` so `toPost` is unchanged.
- `GET /posts` reads `?workspaceId=` and forwards it.

**Workflows** (new migration + repo + route)
- **Migration** `016_workflows_workspace.sql` (conversation-owned — it ALTERs the
  conversation-owned `workflows` table, exactly parallel to 010). Registered in
  `migrations/index.ts` as `load(16, '016_workflows_workspace.sql')`:
  ```sql
  ALTER TABLE workflows
    ADD COLUMN workspace_id TEXT REFERENCES brand_workspaces(id) DEFAULT NULL;
  UPDATE workflows SET workspace_id = 'default-workspace' WHERE workspace_id IS NULL;
  CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
  ```
  016 is the next free number (content-memory owns 011–015, conversation owns 010). Apply order
  is guaranteed by the runner sorting on `version`.
- `WorkflowsRepo`: add `workspaceId` to `Workflow`/`WorkflowRow` + `toWorkflow`; `create()` accepts
  `workspaceId` (default `default-workspace`) and inserts it; `list(workspaceId?)` filters.
- `workflow.ts`: `POST /` reads `workspaceId` from the create body; `GET /` reads `?workspaceId=`.
  The list item shape stays inline (no shared-type change); carry `workspaceId` through if useful.

### 4.5 Frontend

**Context** — `packages/frontend/src/lib/workspace.tsx` (`WorkspaceProvider` + `useActiveWorkspace`),
modeled on `theme-provider.tsx`:
- State: `workspaces: BrandWorkspaceSummary[]`, `activeWorkspaceId` (persisted to
  `localStorage['anubis.activeWorkspaceId']`, default `default-workspace`).
- Derived: `activeWorkspace` (lookup; fallback to default if missing).
- Actions: `setActiveWorkspace(id)`, `refetch()`, `create({name, brandSummary?})` (sets new as
  active), `rename(id, name)`, `archive(id)`.
- Wrap the app in `App.tsx` (outside or inside `NavigationProvider` — order irrelevant since they
  don't depend on each other; put `WorkspaceProvider` outermost).

**API** (`api.ts`) — `listBrandWorkspaces()`, `createBrandWorkspace(input)`,
`updateBrandWorkspace(id, patch)`. Extend `listCompetitors(workspaceId?)`,
`createCompetitor(input)` (carry `workspaceId`), `listPosts({..., workspaceId?})`, and the
workflow list/create in `api/workflows.ts` to accept `workspaceId`.

**Switcher** — `components/dashboard/workspace-switcher.tsx`, rendered in `topbar.tsx` on the left
(by the breadcrumb), using the `dropdown-menu` primitive:
- Trigger: active workspace name + chevron.
- Menu: list of active workspaces with a check on the active one; per-item rename (inline dialog)
  and archive (guarded — see edge cases); a "New workspace" item opening a small `dialog`
  (name + optional summary).

**Page wiring** — pages read `activeWorkspaceId` from context and add it to their fetch
`useEffect` deps so switching re-queries:
- `pages/competitors.tsx` — `listCompetitors(activeWorkspaceId)`; competitor create passes
  `workspaceId`.
- `pages/content.tsx` — `listPosts({ ..., workspaceId: activeWorkspaceId })`.
- `pages/workflows.tsx` — scoped list + create assigns active workspace.
- `components/dashboard/index.tsx` `useLiveCounts` — scope the competitors count by active
  workspace (re-run on switch).

## 5. Edge cases
- Archiving the **active** workspace resets active to `default-workspace`.
- `default-workspace` **cannot** be archived (guard in UI; also reject server-side if `status`
  patch targets it — return 400).
- Archived workspaces drop out of the switcher list (`GET` returns `status='active'` only).
- Persisted active id absent from the fetched list → fall back to `default-workspace`.
- Empty/whitespace name on create/rename → reject (Zod `min(1)` + trim client-side).
- Duplicate names allowed (ids are UUIDs); no uniqueness constraint.

## 6. Testing
- **content-memory** (`packages/content-memory/tests/`): `BrandWorkspacesService.update` — rename,
  brandSummary change, archive; returns `null`/throws appropriately for unknown id.
- **backend** (`packages/backend/tests/` patterns): brand-workspace routes (list active-only,
  create 201, patch 404, default-workspace archive rejected); `GET /competitors?workspaceId=`
  returns only that workspace; `GET /posts?workspaceId=` returns only posts whose competitor is in
  that workspace; workflows list/create scoped. Migration 016 applies cleanly and backfills.
- **frontend** (`packages/frontend/tests/lib/`): `useActiveWorkspace` — default, persistence,
  fallback when active id missing, `create` sets active. Mirror existing hook tests.

## 7. Out of scope (follow-on)
- Editing `toneOfVoice/audience/offers/constraints` from the UI (a full brand-settings page).
- Scoping knowledge documents / similarity items / experience memories views (no UI for those yet).
- Deep-linking the active workspace into the URL/hash.
- Per-workspace conversation scoping (conversations are not workspace-owned today).
- Hard delete of workspaces (archive only).
