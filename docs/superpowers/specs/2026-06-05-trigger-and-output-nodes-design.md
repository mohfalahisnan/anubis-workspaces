# Trigger & Output Workflow Nodes — Design

**Date:** 2026-06-05
**Status:** Approved (pending written-spec review)
**Scope:** Add the two missing **Output** nodes (Markdown, Media) and the entire
**Trigger** category (Schedule, File-watcher) to the workflow editor and runtime.

## Context

The workflow feature (analyzed prior to this spec) is a node-based DAG builder
spanning four packages:

- `@anubis/workflow-runtime` — pure engine: graph validation, topological run
  loop, executors, Zod schemas. No I/O.
- `packages/backend` — `WorkflowRunManager` (run lifecycle + SSE), `workflow.ts`
  (HTTP routes).
- `@anubis/conversation` — SQLite repos (`workflows`, `workflow_runs`).
- `packages/frontend` — React Flow canvas, palette, inspector, Zustand store.

The palette was just regrouped into six capability categories: **Trigger,
Source, Web Search, Tools, Agent, Output**. Two categories are incomplete:

- **Output** currently has only `table`. Missing: Markdown display, Media display.
- **Trigger** is entirely empty. Missing: Schedule, File-watcher.

Today a run starts **only** when the user clicks "Run published" →
`WorkflowRunManager.start(workflowId)`. There is no scheduler or watcher daemon.

### Adding a node — the established pattern (three registries per layer)

1. **Executor**: `packages/workflow-runtime/src/executors/<name>.ts` + register in
   `executors/index.ts` (`executorRegistry`). Runtime throws `unknown node type`
   if a graph node's type is missing here.
2. **Display component**: `packages/frontend/src/components/workflow-editor/executable-nodes/<name>.tsx`
   + register in `executable-nodes/index.ts` (`executableNodeTypes` and
   `NODE_PALETTE`, now with a `category`).
3. **Config form**: `inspector/config/<name>-config.tsx` + register in
   `inspector-panel.tsx` (`CONFIG_FORMS`).

The frontend reads a node's run output via `useNodeRunStatus(id)` /
`useNodeRunOutput(id)`.

## Decisions (locked during brainstorming)

- **Output nodes:** Markdown + Media, as passthrough display sinks.
- **Trigger firing:** Both Schedule and File-watcher **fully wired** — real
  backend timers and a real file watcher that call `WorkflowRunManager.start()`.
- **Arm semantics:** With a trigger node present, "Run published" is **replaced**
  by an **Arm / Disarm** toggle. (No separate manual one-shot for trigger graphs.)
- **Schedule config:** Interval (`every N minutes/hours`) **plus** an optional
  advanced cron expression.
- **File-watcher config:** Watch a file **or** folder, optional **glob** filter,
  and selectable **events** (add / change / delete).
- **Trigger architecture:** A new `TriggerManager` singleton, parallel to
  `WorkflowRunManager`.

---

## Part 1 — Output nodes

### `markdownDisplay`

- **Executor** (`executors/markdown-display.ts`): terminal passthrough. Scans
  `upstream` for the first string-bearing value (`text`, or a plain string),
  falling back to optional `config.staticText`. Returns
  `{ kind: 'markdown', text }`.
- **Config** (`MarkdownDisplayConfig`): `{ staticText?: string }`.
- **Display component**: renders `output.text` as markdown in the node body
  (reuse the app's existing markdown renderer if one exists; otherwise a minimal
  renderer). Input handle only — **no output handle** (terminal sink).

### `mediaDisplay`

- **Executor** (`executors/media-display.ts`): terminal passthrough. Scans
  `upstream` for the first `{ kind: 'file', path, mimeType? }` value. Returns
  `{ kind: 'file', path, mimeType }`. Throws if no file found upstream.
- **Config** (`MediaDisplayConfig`): `{}` (no config; purely display).
- **Display component**: renders the file using the existing `FileThumb`
  component (`@/components/workflow/file-thumb`). Input handle only — terminal sink.

### Why passthrough executors

The runtime requires every node type to be in `executorRegistry`, and the
frontend renders from the node's persisted run output. So each display node needs
a trivial executor that normalizes upstream into a render-ready payload.

### Handle shape

These nodes are terminal: input handle present, **output handle absent**. This is
a node-component concern (handles are declared in the display component); the DAG
runner already treats nodes with no outgoing edges as leaves.

---

## Part 2 — Trigger nodes

### Node types

- **`scheduleTrigger`** — config:
  `{ everyValue: number; everyUnit: 'minute' | 'hour'; cron?: string }`. When
  `cron` is present and non-empty, it takes precedence over the interval.
- **`fileWatchTrigger`** — config:
  `{ path: string; watchKind: 'file' | 'folder'; glob?: string; events: Array<'add' | 'change' | 'unlink'> }`.

Both are top-of-graph, input-less nodes **with an output handle** (their payload
flows downstream).

### Trigger payload → run injection

A trigger node is a normal DAG node whose output is **injected at run start**
rather than computed by reading upstream:

- `scheduleTrigger` → `{ kind: 'trigger', event: 'schedule', firedAt: number }`
- `fileWatchTrigger` → `{ kind: 'trigger', event: 'file', path: string, eventType: 'add' | 'change' | 'unlink' }`

The changed file path from a file-watch trigger flows straight into downstream
nodes (OCR, AI Agent, Media display, etc.).

**Mechanism:** `WorkflowRunManager.start(workflowId, triggerContext?)` gains an
optional `triggerContext = { nodeId: string; payload: unknown }`. When present,
the run seeds `outputs[nodeId] = payload` and marks that step succeeded before the
topological loop, so the trigger node's executor is **not** invoked at runtime
(its result is supplied externally). The trigger executors still exist and
`validateConfig` is still called for graph validation; their `run()` is a
defensive fallback (e.g. returns a `firedAt: Date.now()` payload) used only if a
trigger graph is somehow run without a context.

Manual runs of trigger-less workflows are unchanged (`triggerContext` omitted).

### TriggerManager (new backend subsystem)

`packages/backend/src/trigger-manager.ts` — a singleton parallel to
`WorkflowRunManager`, holding a reference to it.

Responsibilities:

- `arm(workflowId)`:
  1. Load the workflow; require a `publishedGraph` containing **exactly one**
     trigger node (else 400).
  2. Register the firing source:
     - `scheduleTrigger` → an interval timer, or a cron-scheduled timer when
       `cron` is set. **Reuse the existing `stack.cron` scheduling primitive / its
       cron dependency if suitable** (investigate during planning); otherwise add a
       minimal interval + a small cron lib.
     - `fileWatchTrigger` → a `chokidar` watcher on `path` filtered by `glob` and
       `events`.
  3. On fire, build `triggerContext` (with the trigger node id + payload) and call
     `runManager.start(workflowId, triggerContext)`.
  4. Persist armed state (see persistence below).
- `disarm(workflowId)`: tear down timer/watcher, clear persisted armed state.
- `isArmed(workflowId): boolean`.
- `rearmAll()`: on backend boot, re-arm every persisted armed workflow.
- `shutdown()`: clear all timers/watchers (called from `shutdownStack`).

#### Concurrency / firing policy

- Triggers respect the existing **one-active-run-per-workflow** guard. Default
  policy on a fire while a run is active = **skip** (drop the fire); log it.
- File events are **debounced** (default ~300 ms) so rapid saves coalesce into one
  run.

#### Persistence & restart recovery

New table `workflow_triggers` (migration `006_workflow_triggers.sql`):

| column      | type    | notes                          |
|-------------|---------|--------------------------------|
| workflow_id | TEXT PK | FK → workflows(id), ON DELETE CASCADE |
| armed       | INTEGER | 0/1                            |
| armed_at    | INTEGER | epoch ms, nullable             |

New `WorkflowTriggersRepo` (`@anubis/conversation`) with `setArmed`,
`getArmed`, `listArmed`, mirrored on the `ConversationStack`. On backend boot
(`server.ts`, after `serve` callback), call `TriggerManager.rearmAll()`. On
`workflows.delete`, the cascade drops the trigger row; `TriggerManager.disarm` is
also called to tear down live timers/watchers.

### HTTP routes (in `workflow.ts`)

- `POST /workflows/:id/arm` → `{ armed: true }` (400 if no/invalid trigger node,
  no published graph).
- `POST /workflows/:id/disarm` → `{ armed: false }`.
- Extend `GET /workflows` summary and `GET /workflows/:id` with
  `hasTrigger: boolean` and `armed: boolean`.

### Frontend

- **Palette:** `scheduleTrigger` and `fileWatchTrigger` appear under the now-shown
  **Trigger** category (the category header un-hides once nodes exist).
- **Toolbar (`workflow-editor.tsx`):** if the published graph has a trigger node,
  replace the "Run published" button with an **Arm / Disarm** toggle bound to the
  new routes; reflect `armed` state. Trigger-less workflows keep "Run published".
- **Display components + config forms** for both trigger node types, registered in
  the usual three places.
- **API client (`api/workflows.ts`):** add `arm(id)`, `disarm(id)`; extend
  summary/detail types with `hasTrigger` / `armed`.

---

## Out of scope (backlog, not this spec)

- Other missing nodes: generic Web Search, Extract transcript, Markitdown.
- Wiring the stubbed OCR executor (`ocr.extractFromImage` throws today).
- Multiple trigger nodes per workflow (we require exactly one).
- Trigger run history/notifications beyond the existing run records.

## Testing

- **Runtime (`workflow-runtime/tests`):** trigger-context injection seeds the
  trigger node's output and skips its executor; downstream nodes receive the
  payload. Passthrough output executors normalize upstream / fall back correctly;
  `mediaDisplay` throws when no file upstream.
- **Backend (`backend/tests`):** `TriggerManager.arm` rejects graphs without
  exactly one trigger node / without a published graph; schedule fire calls
  `start` with the right context; file event (simulated) fires; skip-while-running
  policy; `rearmAll` re-arms persisted rows; `disarm` tears down. Use injected
  fake timers / a temp dir + real chokidar (or a watcher seam) to keep tests
  deterministic.
- **Repo (`conversation`):** `WorkflowTriggersRepo` CRUD + cascade on workflow
  delete; migration applies.

## Key files

**New:** `executors/{markdown-display,media-display,schedule-trigger,file-watch-trigger}.ts`,
`executable-nodes/{markdown-display,media-display,schedule-trigger,file-watch-trigger}.tsx`,
`inspector/config/*` for each, `backend/src/trigger-manager.ts`,
`conversation/.../workflow-triggers-repo.ts`, `migrations/006_workflow_triggers.sql`.

**Modified:** `executors/index.ts`, `executable-nodes/index.ts` (palette),
`inspector-panel.tsx`, `runtime` start/inject path + `WorkflowRunManager.start`,
`backend/src/workflow.ts` (routes), `app`/`server.ts` (boot rearm + shutdown),
`conversation` stack index, `api/workflows.ts`, `workflow-editor.tsx` (Arm toggle).
