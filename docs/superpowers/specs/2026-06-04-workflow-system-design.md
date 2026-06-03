# Workflow System — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** New `packages/workflow-runtime` package; new migration in `packages/conversation/src/db/migrations/`; new module + routes in `packages/backend`; new pages + editor in `packages/frontend`. Existing `components/workflow/` visual library is reused.
**Builds on:** Existing workflow node visual library (commits 5333633..2c83801) and the now-merged sidebar entry (commit 2501243).

## Problem

The current state of the workflow feature in Anubis is **visual only** — `packages/frontend/src/components/workflow/` ships a `NodeShell` primitive, nine specialized renderers, a `SeparatedEdge` for multi-IO routing, and a `workflow-demo` route that shows a static 12-node Anubis content pipeline. None of it runs. There is no concept of a "workflow" in the backend, no storage, no execution engine, no per-node executors. The reference file the renderers were modelled on was a visual mockup; it never specified what these nodes *do* when executed.

We need a real workflow system — n8n-shaped, scoped to the Anubis content domain — where the user can:

1. Browse a list of workflows; create new ones; open one in an editor.
2. Author the workflow graph with a full Tier 3 editor (drag from palette, connect handles, multi-select, undo/redo, copy/paste, keyboard shortcuts).
3. Save a draft and publish it as the canonical version.
4. Run the published version and watch each node execute live in a right-side inspector panel.
5. Inspect past run history per workflow.

The thin slice that proves the system end-to-end ships **six executable node types** plus the full editor and execution engine.

## Goals

1. New `packages/workflow-runtime` package containing graph validation, a topological-sort runner, an `Executor` interface, and six concrete executors.
2. New SQLite migration `004_workflows.sql` adding `workflows`, `workflow_runs`, and `workflow_run_steps` tables alongside the existing `conversations`/`competitors`/etc.
3. Backend module `packages/backend/src/workflow.ts` exposing:
   - REST: `POST /workflows`, `GET /workflows`, `GET /workflows/:id`, `PATCH /workflows/:id`, `PUT /workflows/:id/draft`, `POST /workflows/:id/publish`, `DELETE /workflows/:id`.
   - Runs: `POST /workflows/:id/runs`, `GET /workflows/:id/runs`, `GET /workflows/runs/:runId`, `DELETE /workflows/runs/:runId`.
   - SSE: `GET /workflows/runs/:runId/events` streams per-node + run-level events.
4. New frontend pages: `pages/workflows.tsx` (list) and `pages/workflow-editor.tsx` (editor).
5. New `components/workflow-editor/` module containing the editor canvas, node palette, dual-mode inspector panel, history stack, clipboard, keymap, autosave, store, and the six executable-node renderer wrappers.
6. Sidebar nav: replace the current "Workflow demo" entry with a "Workflows" entry pointing at the list page. The demo route stays reachable internally (no sidebar slot) and is unchanged.
7. Draft + published workflow versioning: the editor edits a draft, `Save` writes the draft, `Publish` promotes draft → published. Runs target the published version (each run freezes a `graph_snapshot` so subsequent edits don't change history).
8. Six executable node types:
   - **AI Agent** — runs through existing `ai-agent` package; composed prompt auto-prepends upstream outputs.
   - **Instagram Post** — either selects from existing captured content (DB) or calls `research-crawler` against a URL.
   - **Transformer Media** — downloads media at a URL → file artifact.
   - **Transformer Brief** — deterministic JSON template substitution.
   - **OCR Extractor** — extracts text from images via the anubis-extractor service.
   - **Table** — passive passthrough/display; static rows if no upstream input.
9. Per-node config forms generated from Zod schemas — one form file per executable type under `components/workflow-editor/inspector/config/`.
10. Run inspector mode: same right-side panel; switches from config form to per-node run state + output viewer while a run is active.

## Non-goals

- Parallel node execution. v1 runs nodes in topological order, one at a time.
- Scheduled runs, webhook triggers, retry-on-failure, continue-on-error branches, conditional nodes — all deferred.
- Versioned undo across page reloads — undo/redo is in-memory only and clears on navigation away from an editor session.
- Typed connection handles or port-level type checking. v1 validates only "no cycles" and "no dangling edges". Executors trust their upstream and fail loudly on shape mismatch.
- Real-time co-editing.
- Run-record retention policy / cleanup. Runs and steps accumulate; "keep last N" is a follow-up.
- Making the four decorative nodes (`SearchNode`, `ContextBuilderNode`, `AgentReviewNode`, `FinalContentNode`) executable. They remain in the `workflow-demo` showcase as visual references — user explicitly said they are "just naming only".
- Migrating, deleting, or modifying the existing `components/workflow/` library. The new executable-node renderers wrap it; the showcase route is preserved.
- Multi-concurrent runs of the same workflow. A second Run click while one is active returns 409.

## Architecture

### Package + file layout

```
packages/workflow-runtime/                 # NEW package
├── src/
│   ├── index.ts                            # public exports
│   ├── graph.ts                            # WorkflowGraph type, topological sort, validation
│   ├── runner.ts                           # DAG walker, status emitter, error capture
│   ├── context.ts                          # ExecutorContext factory
│   ├── types.ts                            # Executor interface, NodeRunEvent, RunStatus
│   └── executors/
│       ├── index.ts                        # executorRegistry
│       ├── ai-agent.ts
│       ├── instagram-post.ts
│       ├── transformer-media.ts
│       ├── transformer-brief.ts
│       ├── ocr-extractor.ts
│       └── table.ts
├── tests/
│   ├── graph.test.ts
│   ├── runner.test.ts
│   └── executors/
│       ├── ai-agent.test.ts
│       ├── instagram-post.test.ts
│       ├── transformer-media.test.ts
│       ├── transformer-brief.test.ts
│       ├── ocr-extractor.test.ts
│       └── table.test.ts
└── package.json

packages/conversation/src/db/migrations/
└── 004_workflows.sql                        # NEW migration

packages/backend/src/
├── workflow.ts                              # NEW module — Hono routes + SSE
└── server.ts                                # MODIFIED — mount workflow.ts routes

packages/backend/tests/
└── workflow.test.ts                         # NEW — Hono integration tests

packages/frontend/src/
├── api/
│   └── workflows.ts                         # NEW — frontend client (REST + SSE)
├── pages/
│   ├── workflows.tsx                        # NEW — list page
│   └── workflow-editor.tsx                  # NEW — editor page wrapper
├── components/workflow-editor/              # NEW module
│   ├── editor-canvas.tsx                    # ReactFlow + drag-from-palette + selection
│   ├── node-palette.tsx                     # left sidebar with 6 draggable chips
│   ├── inspector-panel.tsx                  # right-side dual-mode panel
│   ├── inspector/
│   │   ├── config/
│   │   │   ├── ai-agent-config.tsx
│   │   │   ├── instagram-post-config.tsx
│   │   │   ├── transformer-media-config.tsx
│   │   │   ├── transformer-brief-config.tsx
│   │   │   ├── ocr-extractor-config.tsx
│   │   │   └── table-config.tsx
│   │   └── run-viewer.tsx                   # mode-switched run state viewer
│   ├── history/
│   │   └── use-editor-history.ts            # in-memory undo/redo stack
│   ├── clipboard/
│   │   └── use-editor-clipboard.ts          # subgraph copy/paste with ID rewriting
│   ├── keymap.ts                            # Delete, Ctrl+Z/Y, Ctrl+C/V, Ctrl+S, Ctrl+Shift+S
│   ├── autosave.ts                          # debounced draft writeback
│   ├── editor-store.ts                      # zustand store: nodes, edges, selection, dirty, run state
│   └── executable-nodes/                    # renderer wrappers for the 6 executable types
│       ├── ai-agent.tsx
│       ├── instagram-post.tsx
│       ├── transformer-media.tsx
│       ├── transformer-brief.tsx
│       ├── ocr-extractor.tsx
│       └── table.tsx
└── components/dashboard/
    └── data.ts                              # MODIFIED — replace 'workflow-demo' nav entry with 'workflows'
    sidebar.tsx                              # MODIFIED — updated case in itemRoute()
    index.tsx                                # MODIFIED — case 'workflows' → WorkflowsPage, case 'workflow-editor' → WorkflowEditorPage
└── lib/navigation.tsx                       # MODIFIED — add 'workflows' and 'workflow-editor' (with workflowId param) to Route union
```

### Database schema (migration `004_workflows.sql`)

```sql
CREATE TABLE workflows (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  draft_graph       TEXT NOT NULL,             -- JSON: { nodes, edges }
  published_graph   TEXT,                       -- JSON or NULL if never published
  draft_updated_at  INTEGER NOT NULL,           -- ms epoch
  published_at      INTEGER,                    -- ms epoch (NULL until first publish)
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  graph_snapshot  TEXT NOT NULL,                -- frozen copy of published_graph at run start
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  error           TEXT
);
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);

CREATE TABLE workflow_run_steps (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL,                   -- matches a node id inside graph_snapshot
  status       TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  started_at   INTEGER,
  finished_at  INTEGER,
  output       TEXT,                            -- JSON: inline output, or { kind: 'file', path }
  error        TEXT
);
CREATE INDEX idx_workflow_run_steps_run ON workflow_run_steps(run_id);
```

**Graph JSON shape** (validated by Zod on read):

```json
{
  "nodes": [
    { "id": "n1", "type": "aiAgent", "position": { "x": 100, "y": 200 }, "config": { "...": "..." } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2" }
  ]
}
```

**Large output handling:** any executor whose output is large (downloaded media, OCR transcripts >256KB) writes the payload to `<dataDir>/workflows/runs/<run-id>/<node-id>.<ext>` via `ctx.fs.writeRunArtifact()` and stores `{ kind: "file", path, mimeType, sizeBytes }` in the `output` column. Plain text/JSON outputs live inline.

**Run snapshotting:** each run freezes `published_graph` into `graph_snapshot` at start time. Subsequent edits to the workflow don't mutate historical runs.

### Execution engine

**`ExecutorContext`** (`packages/workflow-runtime/src/context.ts`) — the services bag injected into every executor call. Backed by the backend at runtime, mocked in unit tests:

```ts
export interface ExecutorContext {
  agent:   { run: (req: AgentRunRequest) => Promise<AgentRunResult> }
  crawler: { captureProfile: (url: string) => Promise<CapturedProfile> }
  ocr:     { extractFromImage: (path: string) => Promise<string> }
  db:      { getCapturedPost: (id: string) => Promise<CapturedPost> }
  fs:      { writeRunArtifact: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string> }
  signal:  AbortSignal
  emit:    (event: NodeRunEvent) => void
}
```

**`Executor` interface**:

```ts
export interface ExecutorInput<TConfig> {
  nodeId:   string
  config:   TConfig
  upstream: Record<string, unknown>     // keyed by source node id
}

export interface Executor<TConfig> {
  type:           string
  validateConfig: (raw: unknown) => TConfig    // Zod-backed; throws on invalid
  run:            (input: ExecutorInput<TConfig>, ctx: ExecutorContext) => Promise<unknown>
}

export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }
```

**Runner algorithm** (`runner.ts`):

1. **Validate the graph snapshot:**
   - Kahn's topological sort → reject if cycles exist.
   - Every edge's `source` and `target` reference an existing node.
   - Every node's `type` is in `executorRegistry`.
   - Every node's `config` passes its executor's `validateConfig`.
2. **For each node in topo order:**
   - Check `signal.aborted` → mark all remaining nodes `skipped`, run `cancelled`, stop.
   - Build `upstream` by reading completed outputs from incoming-edge sources.
   - Persist step row with `status='running'`, `started_at=now`.
   - Emit `node-started`.
   - Call `executor.run(input, ctx)`.
   - **On success:** persist `output` (inline or file ref), set `status='succeeded'`, emit `node-succeeded`.
   - **On throw:** persist `error`, set `status='failed'`, emit `node-failed`, mark remaining nodes `skipped`, set run `status='failed'`, stop.
3. **If all nodes complete:** run `status='succeeded'`, set `finished_at`.

**No parallelism in v1** — even if branches could run independently, run sequentially. **Stop on first failure** — no continue-on-error. **Cancellation** — `DELETE /workflows/runs/:id` aborts the signal; runner finishes the current node (no mid-executor abort hook in v1), then marks remaining nodes skipped.

### Backend routes (`packages/backend/src/workflow.ts`)

All requests validated by Zod; errors normalized by the existing `app.ts` error middleware.

```
POST   /workflows                       create workflow with empty draft graph
GET    /workflows                       list workflows with last-run summary
GET    /workflows/:id                   full workflow incl. both graphs and run summary
PATCH  /workflows/:id                   update name/description
PUT    /workflows/:id/draft             write draft_graph (autosave target)
POST   /workflows/:id/publish           promote draft_graph → published_graph
DELETE /workflows/:id                   cascade-deletes runs and steps

POST   /workflows/:id/runs              create run; freeze graph_snapshot; spawn runner; return run id
GET    /workflows/:id/runs              list runs (paginated)
GET    /workflows/runs/:runId           run + step records
DELETE /workflows/runs/:runId           cancel running, or delete completed (idempotent)
GET    /workflows/runs/:runId/events    SSE stream of NodeRunEvent + run-level start/end events
```

The runner runs in-process inside the backend Hono server (which is already a child process spawned by Electron main and survives renderer navigation).

### The 6 executors

#### 1. AI Agent (`aiAgent`)

```ts
config = z.object({
  profileId: z.string(),
  reasoning: z.enum(['low','medium','high']),
  prompt:    z.string(),
})

run(input, ctx):
  const upstreamBlock = JSON.stringify(input.upstream, null, 2)
  const composedPrompt =
    `<context>\n${upstreamBlock}\n</context>\n\n${input.config.prompt}`
  const result = await ctx.agent.run({
    profileId: input.config.profileId,
    reasoning: input.config.reasoning,
    prompt:    composedPrompt,
  })
  return { kind: 'text', text: result.text }
```

Upstream outputs are automatically embedded inside a `<context>` block prepended to the user's prompt. No template language to learn in v1.

#### 2. Instagram Post (`instagramPost`)

```ts
config = z.discriminatedUnion('source', [
  z.object({ source: z.literal('existing'), postId: z.string() }),
  z.object({ source: z.literal('url'),      url: z.string().url() }),
])

run(input, ctx):
  if (input.config.source === 'existing') {
    const post = await ctx.db.getCapturedPost(input.config.postId)
    return { kind: 'instagramPost', post }
  } else {
    const captured = await ctx.crawler.captureProfile(input.config.url)
    return { kind: 'instagramPost', post: captured }
  }
```

`ctx.db.getCapturedPost` is added to `ExecutorContext` (reads from the existing `captured_posts` table).

#### 3. Transformer Media (`transformerMedia`)

```ts
config = z.object({
  url: z.string().url().optional(),     // override; falls back to upstream
})

run(input, ctx):
  const url = input.config.url ?? findFirstMediaUrl(input.upstream)   // throws if none
  const response = await fetch(url)
  const buffer = Buffer.from(await response.arrayBuffer())
  const ext = inferExtension(response.headers.get('content-type'), url)
  const path = await ctx.fs.writeRunArtifact(runId, input.nodeId, ext, buffer)
  return { kind: 'file', path, mimeType: response.headers.get('content-type'), sizeBytes: buffer.length }
```

`findFirstMediaUrl` walks the upstream bag looking for `kind: 'instagramPost'` outputs and returns the first media URL.

#### 4. Transformer Brief (`transformerBrief`)

```ts
config = z.object({
  jsonTemplate: z.string(),             // template with {{path.to.field}} placeholders
})

run(input, ctx):
  const rendered = renderTemplate(input.config.jsonTemplate, input.upstream)
  const value = JSON.parse(rendered)    // throws on parse failure
  return { kind: 'json', value }
```

`renderTemplate` substitutes `{{<path>}}` tokens by looking up `path` in the upstream bag (e.g. `{{aiAgent_n3.text}}` resolves to `upstream['n3'].text`). Deterministic — no LLM involvement.

#### 5. OCR Extractor (`ocrExtractor`)

```ts
config = z.object({
  imagePath: z.string().optional(),     // override; falls back to upstream file path
})

run(input, ctx):
  const path = input.config.imagePath ?? findFirstFilePath(input.upstream)   // throws if none
  const text = await ctx.ocr.extractFromImage(path)
  return { kind: 'text', text }
```

`ctx.ocr` is backed by the `mcp__anubis-extractor__extractor_ocr` MCP tool when available, otherwise a built-in OCR call. Backend picks at startup based on which is reachable. If neither is available, the executor's config form surfaces "OCR service unavailable" and runs fail with a clear error.

#### 6. Table (`table`)

```ts
config = z.object({
  staticData: z.array(z.record(z.unknown())).optional(),
})

run(input, ctx):
  const upstreamValues = Object.values(input.upstream)
  if (upstreamValues.length > 0) {
    return { kind: 'table', rows: upstreamValues }      // pass-through
  }
  return { kind: 'table', rows: input.config.staticData ?? [] }
```

Pure passive node — no logic beyond passthrough or static-rows fallback.

### Frontend editor

#### Editor state (`editor-store.ts`)

Zustand store, single source of truth for the editor session. Shape:

```ts
{
  workflowId: string
  name: string
  draft:   { nodes: Node[]; edges: Edge[] }   // currently being edited
  published: { nodes: Node[]; edges: Edge[] } | null
  draftSavedAt: number | null                 // last successful draft write
  publishedAt:  number | null
  isDirty: boolean                            // draft has changes since last save
  isAheadOfPublished: boolean                 // draft differs from published
  selection: Set<string>                      // node IDs
  history: { past: Snapshot[]; future: Snapshot[] }
  clipboard: SerializedSubgraph | null
  activeRun: {
    runId: string
    status: RunStatus
    steps: Record<NodeId, NodeRunState>
  } | null
}
```

#### Tier 3 editor behaviors

- **Drag-from-palette** — HTML5 drag-and-drop. Each palette chip carries a `data-node-type` attribute; on drop, compute the canvas-relative position and call `addNode(type, position)`.
- **Multi-select** — ReactFlow's built-in `selectionOnDrag` (rubber-band) plus shift-click for additive selection.
- **Undo/redo** — `useEditorHistory` snapshots `{ nodes, edges }` before each mutation. `Ctrl+Z` pops `past`, pushes onto `future`; `Ctrl+Y`/`Ctrl+Shift+Z` reverses. Stack lives in zustand, cleared on editor unmount. Config-form edits also push snapshots.
- **Copy/paste** — `useEditorClipboard` serializes selected nodes + their internal edges (edges where both endpoints are selected) to a JSON blob. On paste, generates new node IDs and offsets positions by `(20, 20)`. Serialized blob also goes to `navigator.clipboard.writeText` so paste works between workflows.
- **Keyboard shortcuts** (`keymap.ts`):
  - `Delete` / `Backspace` → remove selected nodes + connected edges
  - `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` → undo / redo
  - `Ctrl+C` / `Ctrl+V` → copy / paste
  - `Ctrl+S` → save draft
  - `Ctrl+Shift+S` → publish
- **Autosave** — `autosave.ts` debounces 800ms after each draft mutation, calls `PUT /workflows/:id/draft`. Failure surfaces a non-blocking toast; dirty stays true until success.
- **Validation on connect** — `isValidConnection` callback to ReactFlow: rejects if the connection would create a cycle, if the source or target node doesn't exist, or if an identical edge already exists. Cycle check uses BFS over the current graph plus the proposed edge. No type-level port checking — connections are accepted regardless of upstream/downstream data shapes (executors handle shape mismatches at run time).

#### Inspector panel (`inspector-panel.tsx`)

Dual-mode right-side panel, ~360px wide.

- **Mode: Config** (default, no active run):
  - 0 nodes selected → workflow meta form (name, description).
  - 1 node selected → that node's config form, picked from `inspector/config/<type>-config.tsx`.
  - 2+ nodes selected → "N nodes selected" + delete-selection button.
- **Mode: Run inspector** (active or completed run on display):
  - Selected node → status pill, timing, output viewer (renders by output kind: text → `<pre>`, json → JSON tree, file → download link + preview, instagramPost → embedded card, table → tabular view).
  - "Back to config" button at top switches modes; switching also happens automatically when the user starts editing the graph while inspecting.

#### List page (`pages/workflows.tsx`)

Cards per workflow showing name, draft/published indicator (one of "Up to date", "Draft ahead of published", "Draft only"), last-run summary, and actions: Open / Run / Duplicate / Delete. `+ New workflow` opens a name dialog → `POST /workflows` → navigate to `/workflows/:id`.

### Sidebar changes

`components/dashboard/data.ts` — replace the existing `{ label: 'Workflow demo', icon: WorkflowIcon, page: 'workflow-demo' }` entry with `{ label: 'Workflows', icon: WorkflowIcon, page: 'workflows' }`. The `workflow-demo` route stays in the codebase and remains reachable via `navigate({ page: 'workflow-demo' })`.

`lib/navigation.tsx` — add to the `Route` union:
- `| { page: 'workflows' }`
- `| { page: 'workflow-editor'; workflowId: string }`

`components/dashboard/index.tsx` — add cases in `CurrentPage`'s switch and `BREADCRUMBS` entries. `sidebar.tsx`'s `itemRoute` gets a new case for `'workflows'`.

## Data flow

**Authoring** — User opens the editor; frontend fetches the workflow via `GET /workflows/:id`, populates the zustand store. Every graph mutation pushes a history snapshot and triggers debounced autosave (`PUT /workflows/:id/draft`). Publishing calls `POST /workflows/:id/publish`.

**Running** — User clicks Run. Frontend calls `POST /workflows/:id/runs` → returns `{ runId }`. Frontend opens an `EventSource` to `GET /workflows/runs/:runId/events`. The backend runner emits events (`node-started`, `node-succeeded`, `node-failed`, plus run-level `run-started`, `run-finished`); each event is appended to the `activeRun.steps` map in the store. The inspector panel re-renders. Closing the editor doesn't kill the run (the runner lives in the backend); reopening the workflow during a run re-subscribes to the SSE stream by calling `GET /workflows/runs/:runId` first to hydrate then `EventSource` for live updates.

**Inside the runner** — Each node receives `upstream: Record<sourceNodeId, output>`. Executors that need a specific input shape walk the bag to find what they need (e.g. `findFirstMediaUrl`). When upstream shapes don't match, the executor throws — caught by the runner, recorded as a `node-failed`, run halts.

## Error handling

- **Graph validation errors** at run-start (cycles, dangling edges, unknown node types, invalid config) → returns 400 from `POST /workflows/:id/runs` with structured issue list, no run created.
- **Executor errors** at run time → caught by the runner; step row gets `status='failed'`, `error=<message>`; emit `node-failed`; subsequent nodes marked `skipped`; run `status='failed'`.
- **SSE disconnects** → frontend reconnects automatically (`EventSource` does this). If the run finished between disconnect and reconnect, the reconnect handler reads run state via `GET /workflows/runs/:runId` and renders the final state.
- **Cancellation** → `DELETE /workflows/runs/:runId` aborts the signal; runner finishes current node, then halts. Run record stays in DB with `status='cancelled'`.

## Testing strategy

- **`packages/workflow-runtime/tests/`** — unit tests with mocked `ExecutorContext`:
  - `graph.test.ts` — cycle detection, topo sort, dangling-edge detection.
  - `runner.test.ts` — 3-node linear happy path, stop-on-failure, mid-run cancellation, skipped-status propagation.
  - `executors/*.test.ts` — one file per executor: validates the config Zod schema, happy path with mocked services, upstream resolution rules.
- **`packages/backend/tests/workflow.test.ts`** — Hono integration tests against an in-memory SQLite DB with a mock executor registry. Verifies REST shape, draft/publish lifecycle, run creation, SSE event ordering for a small run.
- **`packages/frontend/tests/`** — unit tests for `useEditorHistory` (push/undo/redo invariants) and `useEditorClipboard` (subgraph serialization + ID rewriting on paste). No full editor e2e in v1.
- **Manual smoke for v1 release**:
  1. Create a "Prompt → AI Agent → Table" workflow. Save. Publish. Run. Confirm right-panel run inspector populates as each node executes.
  2. Create an "IG URL → AI Agent → Table" workflow. Run. Confirm crawler integration works and IG post output appears in the Table node's run output.

## Integration with existing code

- **`components/workflow/` (NodeShell + 9 renderers + SeparatedEdge)** — reused as the rendering substrate. The new executable-node renderer wrappers under `components/workflow-editor/executable-nodes/` each wrap the corresponding `NodeShell`-based component, providing a thin adapter from `(config, runState)` to the existing data shapes used for display.
- **`workflow-demo` route** — unchanged; loses its sidebar slot to the new `Workflows` entry but remains reachable internally.
- **`packages/ai-agent`** — consumed via a new wrapper in `packages/backend/src/services.ts` that exposes `ctx.agent.run()`. No changes to the agent package itself.
- **`packages/research-crawler`** — consumed via a new wrapper in `services.ts` exposing `ctx.crawler.captureProfile()`. No changes to the crawler package itself.
- **OCR / anubis-extractor MCP** — `ctx.ocr.extractFromImage` is implemented in the backend as a thin call to the MCP tool when present, else a built-in fallback (or a clear "service unavailable" error).
- **`captured_posts` SQLite table (existing)** — read by the Instagram Post executor's `source: 'existing'` branch via a new `ctx.db.getCapturedPost(id)` accessor.

## Risks & open questions

- **SSE through Electron.** The conversation package already streams SSE through the renderer successfully (`packages/conversation/src/sse/`), so the foundation exists. Implementation plan should validate the renderer-side `EventSource` connection against the workflow runs endpoint early in the work — first failure point to flush out.
- **OCR service availability.** If neither `mcp__anubis-extractor` nor a built-in OCR is reachable at backend startup, every OCR Extractor run fails. Plan should include a startup health check and surface unavailability in the OCR config form so the user knows before they run.
- **Long-running AI agent calls block the runner.** With sequential execution, a 30s+ agent call blocks subsequent nodes. Acceptable for v1 per design discussion. The SSE stream just has long quiet gaps between `node-started` and `node-succeeded`; the frontend's `EventSource` keepalive handles it.
- **Hard-coded executor registry.** v1 imports executors statically. A future dynamic plugin model (load executors from disk, user-authored nodes) is out of scope.
- **Schema evolution of stored graph JSON.** v1 ships with one Zod schema per node-type config. When a node type's config schema changes incompatibly in a future version, stored draft/published graphs that don't validate will fail at load time. No graph-level schema-version field in v1; per-node-type migration tooling is a follow-up if/when the first incompatible change lands.
