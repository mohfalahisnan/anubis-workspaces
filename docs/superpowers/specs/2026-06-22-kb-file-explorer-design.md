# Knowledge Base → File Explorer + Markdown Viewer/Editor — Design

**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan
**Area:** `packages/frontend`, `packages/backend`, `packages/knowledge-lite`, `packages/shared`

## Goal

Replace the current Knowledge Base page (search / ingest / stats / indexed-doc list) with a
**file explorer + markdown viewer/editor** scoped to the active project's `knowledge/` directory.
The page lets the user browse the markdown corpus as a file tree, read rendered markdown, and do
**full file management** (create / edit / delete `.md` files). Manual **search** and **re-ingest**
controls are retained. Leftover **graph** artifacts are removed.

## Context (current state)

- KB markdown lives per-project at `<projectWorkdir>/knowledge/**/*.md` (source of truth). The
  search index is disposable at `<dataDir>/knowledge-lite/<projectId>/index.db`.
- Backend routes (`packages/backend/src/knowledge-base.ts`, mounted at `/knowledge-base`):
  `POST /search`, `POST /ingest`, `POST /save`, `POST /update`, `POST /delete`, `GET /stats`,
  `GET /documents`. There is **no** filesystem tree listing and **no** raw file-read endpoint —
  `/documents` returns only *indexed* rows from sqlite, so it misses un-indexed files.
- The engine (`packages/knowledge-lite/src/index.ts`) `save`/`update`/`delete` each call
  `buildIndex()` after writing, so **the search index stays fresh automatically after any edit**.
  Path safety is enforced by `resolveTargetPath` / `rejectBadDocumentPath`
  (`packages/knowledge-lite/src/paths.ts`): no absolute paths, no Windows drive, no `..`, `.md`
  only, must resolve inside the knowledge root.
- A recursive markdown walker already exists: `scanMarkdownFiles(sourceRoot)`
  (`packages/knowledge-lite/src/fs.ts`).
- Frontend already depends on `streamdown` (^2.5.0) + `@streamdown/code` + `shiki` for markdown
  rendering (used by `components/ai-elements/reasoning.tsx`). **No new markdown dep is needed.**
  There is **no** code-editor dependency.
- **No graph page exists** in the frontend (the `knowledge-graph` page was removed previously).
  But `react-force-graph-2d` is still listed in `packages/frontend/package.json` with **zero
  imports** — a dead leftover of the old graph page.
- The KB page is reached via the `knowledge-base` route key, the sidebar nav item, a breadcrumb,
  and an "Open Knowledge Base" deep-link in the extraction-complete modal
  (`components/jobs/top-nav-progress.tsx`).

## Approach

**Reuse the existing `knowledge-base` route slot and rewrite the page in place.** This keeps the
sidebar item, breadcrumb, and the "Open Knowledge Base" deep-link working, and avoids the silent
`default`-branch nav bugs that come from renaming a page key (`sidebar.tsx` `itemRoute()` and
`dashboard/index.tsx` `CurrentPage()` both have silent defaults). The `KnowledgeBasePage` export
name is preserved so the `dashboard/index.tsx` import is unchanged.

*Rejected alternative:* a new `knowledge`/`files` route with full nav surgery (5 spots + deep-link)
— more churn and risk for no benefit.

## Components & changes

### 1. Engine — `@anubis/knowledge-lite`

Add two read methods to the `KnowledgeEngine` interface and `createEngine` implementation
(`src/index.ts`). `knowledge-lite` does **not** depend on `@anubis/shared`, so these return
**structural** types (defined locally / inline); `@anubis/shared` mirrors them as named interfaces
for the backend/frontend boundary (§2).

- `listFiles(): { items: Array<{ path: string; size: number; updatedAt: string }> }`
  Walk the filesystem via `scanMarkdownFiles(sourceRoot)`; for each file `statSync` for `size`
  and `mtime` (ISO string), and `toSourcePath` for the forward-slashed relative path. Returns
  entries sorted by path. **Reads the filesystem, not the index** — so newly added, un-ingested
  files appear.
- `readFile(opts: { path: string }): { path: string; content: string }`
  Validate via `resolveTargetPath(sourceRoot, opts.path)` (reuses existing guards). If the target
  does not exist, throw `ValidationError('target does not exist')`. Return the normalized relative
  `path` (via `toSourcePath`) and the file `content` (`readFileSync(target, 'utf8')`).

Both go through the backend's existing `withEngineLock` serialization. The route/response shapes are
structurally identical to the `@anubis/shared` `KnowledgeBaseFileEntry` / `KnowledgeBaseFileContent`
types.

### 2. Shared types — `@anubis/shared`

```ts
export interface KnowledgeBaseFileEntry { path: string; size: number; updatedAt: string }
export interface KnowledgeBaseFileContent { path: string; content: string }
```

### 3. Backend routes — `packages/backend/src/knowledge-base.ts`

Two new GET routes (both static paths — no Hono `:param` ordering concerns):

- `GET /knowledge-base/tree?projectId=<id>` → `{ ok: true, items: KnowledgeBaseFileEntry[] }`
  Calls `engineFor(projectId).listFiles()`.
- `GET /knowledge-base/read?projectId=<id>&path=<relPath>` → `{ ok: true, path, content }`
  New `ReadQuery = z.object({ projectId: z.string().min(1), path: z.string().min(1) })`. Calls
  `engineFor(projectId).readFile({ path })`. Path-validation errors surface as `ValidationError`
  → mapped to HTTP 400 by the existing `toErrorResponse` handler.

Create/edit/delete reuse the **existing** `/save` `/update` `/delete` routes unchanged.

### 4. Frontend API layer — `packages/frontend/src/api.ts`

Add thin wrappers:

- `getKnowledgeBaseTree(projectId): Promise<KnowledgeBaseFileEntry[]>` (GET `/tree`, returns `.items`)
- `readKnowledgeBaseFile(projectId, path): Promise<KnowledgeBaseFileContent>`
  (GET `/read`, `encodeURIComponent(path)`)
- `saveKnowledgeBaseFile({ projectId, path, content, force? })` (POST `/save`)
- `updateKnowledgeBaseFile({ projectId, path, content })` (POST `/update`)
- `deleteKnowledgeBaseFile({ projectId, path })` (POST `/delete`)

`searchKnowledgeBase` and `ingestKnowledgeBase` already exist and are reused.

### 5. Frontend page — `packages/frontend/src/pages/knowledge-base.tsx` (rewrite)

Two-pane layout inside the page content area; keeps the existing `useProject()` /
no-project / no-workdir empty states.

- **Left pane (~280px):** file tree built client-side from the flat `/tree` path list
  (collapsible folders; files sorted). Toolbar above it:
  - **New file** — reveals a small **inline path input** (e.g. `folder/name.md`); not
    `window.prompt` (Electron may block it). Opens the editor empty; Save calls
    `saveKnowledgeBaseFile` (`force: false`, so it refuses to clobber an existing file).
  - **Re-ingest** — calls `ingestKnowledgeBase` (for files added outside the app).
  - **Refresh tree** — re-fetches `/tree`.
  - **Search box** — calls `searchKnowledgeBase`; results render as a list; clicking a hit opens
    that `source` file in the viewer. (Low-confidence banner preserved.)
- **Right pane (flex-1):** markdown **viewer** (rendered with the existing `Streamdown`, mirroring
  `components/ai-elements/reasoning.tsx`) with an **Edit** toggle → raw-markdown `<textarea>`
  editor (textarea is the YAGNI choice; no code-editor dep exists) → **Save**
  (`updateKnowledgeBaseFile` for existing, `saveKnowledgeBaseFile` for new) and **Delete** (with a
  confirm step → `deleteKnowledgeBaseFile`). After any write the tree refreshes and the engine has
  already re-indexed.
- **Compact stats line** (documents / chunks / last indexed) retained, served by the existing
  `use-kb-loader` store.

For clarity and testability the page is split into small focused components under
`packages/frontend/src/components/knowledge/`:
- `file-tree.tsx` — pure render of the tree + selection callback (built from `KnowledgeBaseFileEntry[]`).
- `markdown-view.tsx` — Streamdown wrapper.
- `markdown-editor.tsx` — textarea editor + save/cancel.
The page (`knowledge-base.tsx`) owns data fetching and state (selected path, content, mode) and
composes these. A small `buildTree(paths)` helper converts the flat path list into a nested
structure.

### 6. Navigation / icon

Route key, nav item, breadcrumb, and deep-link are **unchanged**. Optional polish: swap the
sidebar icon from `DatabaseIcon` to a folder/files icon (`data.ts`) and keep the label
"Knowledge Base". No `navigation.tsx` / `sidebar.tsx` / `index.tsx` route changes.

### 7. Graph cleanup

- **Remove `react-force-graph-2d`** from `packages/frontend/package.json` (verified zero imports).
- **Workflow demo** (`packages/frontend/src/components/workflow/`):
  - `demo/sample-data.ts` — remove the `knowledge-base` node, its `e7` ("KB context") edge, and the
    now-unused `sampleNodeData.knowledgeBase` block. (`ai-context-builder` keeps its other inputs
    e5/e6/e8.)
  - `demo/gallery.tsx` — remove the `TableNode` gallery entry that consumes `sampleNodeData.knowledgeBase`.
    **Consequence:** the `referenceTable` node type loses its demo showcase (acceptable; the node
    type stays registered).
  - `nodes/context-builder-node.tsx` — trim the incidental "knowledge base," from the subtitle list.
  - **Left intact:** `nodes/search-node.tsx` ("Anubis Context Retrieval") — its purpose *is*
    context/similarity retrieval, so removing the phrase would mislabel a functional node. (Widen
    scope here only if desired.)

## Data flow

1. Page mounts / active project changes → fetch `/tree` (+ stats via `use-kb-loader`).
2. User clicks a file → `readKnowledgeBaseFile` → render via Streamdown.
3. Edit → Save → `/update` (or `/save` for new) → engine re-indexes synchronously → refetch `/tree`
   and the file content.
4. Delete → confirm → `/delete` → engine re-indexes → refetch `/tree`, clear selection.
5. Search → `/search` → result list → click → open file.
6. Re-ingest → `/ingest` → refresh stats.

## Error handling

- Backend path/validation errors → `ValidationError` → HTTP 400 (existing `toErrorResponse`).
- Frontend surfaces errors via the existing banner pattern (`{ kind: 'error' | 'success' }`).
- No-project / no-workdir → existing empty states. Empty `knowledge/` → "no files yet, create one
  or drop `.md` files in" empty state.
- `react-error-boundary` already wraps `<CurrentPage/>` at page level — the new subtree inherits it.

## Testing

- **knowledge-lite** (`packages/knowledge-lite/tests/`): `listFiles` returns filesystem files incl.
  un-indexed ones with size/updatedAt; `readFile` returns content and **rejects** traversal (`..`),
  absolute paths, Windows drive, non-`.md`, and missing files.
- **backend**: route tests for `GET /tree` and `GET /read` (happy path + a 400 traversal case),
  matching the existing backend route-test harness.
- **frontend** (`packages/frontend/tests/`, jsdom + testing-library, mock `@/api`): tree renders
  from a mocked `/tree`; selecting a file renders its markdown; Edit→Save calls
  `updateKnowledgeBaseFile`; New file→Save calls `saveKnowledgeBaseFile`; Delete confirm calls
  `deleteKnowledgeBaseFile`.
- **Build order** is load-bearing for tests (vitest resolves `@anubis/*` to `dist`): rebuild
  `knowledge-lite` → `shared` → `backend` → `frontend` before running their vitest suites.
- **Typecheck separately**: `pnpm --filter @anubis/frontend typecheck` (the Vite build does not fail
  on type errors) plus whole-repo `pnpm typecheck`.
- **Manual**: drive the real Electron app (`verify` skill) — browse, open, edit/save, create,
  delete, search, re-ingest against a project that has a `knowledge/` folder.

## Out of scope / YAGNI

- File **rename/move** (no rename endpoint; would be save-as + delete — defer unless asked).
- Browsing files **outside** `knowledge/` or non-`.md` files (scope is the markdown corpus).
- A rich code editor (Monaco/CodeMirror) — textarea suffices for v1.
- URL/deep-link to a specific file path.

## Packaging note

All new runtime imports are Node built-ins (`fs`, `path`) already used by knowledge-lite, and
frontend deps are bundled by Vite — so the electron-builder root-`dependencies` packaging trap does
**not** apply here. Removing `react-force-graph-2d` is a pure reduction.
