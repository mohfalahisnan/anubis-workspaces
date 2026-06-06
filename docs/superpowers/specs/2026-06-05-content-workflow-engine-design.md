# Design: Self-Improving Content Workflow + Durable Engine Upgrade

Date: 2026-06-05
Status: **Design approved, spec WIP — implementation not started**
Branch at time of writing: `codex/json-transformer-media-arrays`

This document is both the design spec and a cold-start handoff. It captures the
target workflow, every decision made during brainstorming, the architecture, the
data-model changes, and a file-level change map so the next session can resume
without re-deriving anything.

---

## 1. What we are building

The user wants to build a content workflow (drawn as a diagram) in the Anubis
workflow editor. Several nodes don't exist yet, AND the workflow requires engine
capabilities the runtime does not currently support.

### Target workflow (confirmed reading of the diagram)

```
Instagram Post ─┬─ JSON Transformer ─ Image/Video ─┬─ OCR ──────────┐
                │                                   └─ Transcript ───┤
                └─ JSON Transformer ─────────────────────────────────┤
                                                                     ▼
                                       AI #1  "what is this content about"
                                       (target / pain / problem; uses anubis skills)
                                                                     │
                                                              MARKDOWN
                                                                     ▼
                          AI #2  "find similarity / knowledge base / lessons → improve"
                                                              MARKDOWN
                                                                     ▼
                          AI #3  "review / validation rules"  ── verdict ──┐
                               │approved                          │rejected │
                               ▼                                  ▼         │
                         HUMAN REVIEW                 AI "lesson: mistakes" ─┘ loops back to AI #1
                          │approved   │rejected                   ▲
     ┌────────────────────┤           └───────────────────────────┘
     ▼                    ▼
 final MARKDOWN   AI "lesson: what made it good"
```

Key behaviours:
- Two gates: **AI #3** (auto verdict) then **Human Review** (manual).
- On rejection from EITHER gate, a "write a lesson — mistakes" agent records the
  lesson and the workflow **loops back to AI #1** to regenerate (a real cycle).
- On Human approval: emit the final MARKDOWN AND run a "write a lesson — what made
  it good" agent.

---

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Engine approach | **A — durable re-entrant scheduler** (ready-queue, DB-persisted state) |
| Human Review pause | **Durable suspend/resume** — survives backend/app restart |
| Retry loop | **True cycle**, with a **configurable `maxIterations` per workflow** (default 3) |
| AI #3 verdict | **Structured decision field** (`data.decision = 'approved' \| 'rejected'`) routed by a `branchDecision` node |
| Lessons store | **Simple dedicated table** (`workflow_lessons`) + lesson writer/reader nodes |
| OCR / Transcript wiring | **Delegate via AI agent** — the agent already has MCP/skills (incl. anubis-extractor) materialised in its workspace; no new backend MCP client |
| Spec scope | **One comprehensive spec** covering engine + nodes + lessons + assembled graph |

---

## 3. Current runtime — what exists vs. what's missing

Inventory taken from the actual code (paths relative to repo root).

### Existing nodes (`packages/workflow-runtime/src/executors/`)
`table`, `transformerBrief`, `jsonTransformer`, `instagramPost`, `transformerMedia`,
`ocrExtractor`, `imageVideo`, `aiAgentConversation`, `markdownDisplay`,
`mediaDisplay`, `scheduleTrigger`, `fileWatchTrigger`.

| Diagram node | Status |
|---|---|
| Instagram Post (`instagramPost`) | ✅ exists |
| JSON Transformer (`jsonTransformer`) | ✅ exists |
| Image/Video (`imageVideo`) | ✅ exists |
| OCR (`ocrExtractor`) | ✅ node exists, but `ctx.ocr` is a **stub that throws** |
| Markdown (`markdownDisplay`) | ✅ exists |
| AI Agent (`aiAgentConversation`) | ✅ exists |
| Transcript | ❌ build new |
| Human Review (durable pause) | ❌ build new + engine support |
| Branch routing (approved/rejected) | ❌ build new + engine support |
| Loop-back / cycles | ❌ **engine forbids cycles today** |

### Engine reality (the crux)
- `packages/workflow-runtime/src/runner.ts` — `runWorkflow()` does a single
  `topologicalSort` pass, runs each node **exactly once**, in-memory, to
  completion. On a cycle it `throw`s `"graph contains a cycle"`.
- `packages/workflow-runtime/src/graph.ts` — `topologicalSort`, `incomingEdges`,
  `outgoingEdges`.
- `packages/workflow-runtime/src/types.ts` — `WorkflowEdgeSchema` is just
  `{ id, source, target }` (no `sourceHandle`). `RunStatus` =
  `pending|running|succeeded|failed|cancelled`. `ExecutorContext` has
  `crawler`, `ocr` (stub), `db`, `fs`, `conversations`, `runId`, `signal`, `emit`.
- `packages/backend/src/workflow-run-manager.ts` — drives runs. Persists run +
  steps for observability only (no resume). Enforces **one active run per
  workflow** (`runsByWorkflow`). `ctx.ocr.extractFromImage` THROWS
  "not yet wired (anubis-extractor integration is follow-up)". There is **no
  `ctx.transcribe`**. No MCP client anywhere in backend/conversation.

### Persistence layer (`packages/conversation/src/db/`)
- better-sqlite3, WAL, `foreign_keys=ON`. Migrations in
  `packages/conversation/src/db/migrations/`, registered in
  `migrations/index.ts` (currently up to `007_known_workspaces.sql`).
- `workflow-runs-repo.ts` — `workflow_runs` + `workflow_run_steps` tables
  (schema in `004_workflows.sql`). Methods: `createRun`, `upsertStep`,
  `setRunStatus`.
- `workflows-repo.ts` — `workflows` table with `draft_graph` / `published_graph`
  (JSON `{ nodes, edges }`).
- `ConversationStack` (`packages/conversation/src/index.ts`) exposes:
  `conversation`, `profiles`, `competitors`, `capturedPosts`, `workflows`,
  `workflowRuns`, `workflowTriggers`, `appConfig`, `skills`, `sse`, `cron`,
  `taskManager`, `aiAgent`, `knownWorkspaces`, `agentHomeRoot`, `shutdown`.

### Frontend (`packages/frontend/src/components/workflow-editor/`)
- React Flow (`@xyflow/react`). Edges created via `addEdge(...)` in
  `editor-canvas.tsx` with `type: 'separated'`. Edge objects natively carry
  `sourceHandle` if a node exposes multiple handles.
- Shared handles: `packages/workflow/handles.tsx` —
  `WORKFLOW_TARGET_HANDLE='in-main'`, `WORKFLOW_SOURCE_HANDLE='out-main'`,
  `NodeDirectionalHandles`. Single source handle today.
- Run status UI: `inspector/run-viewer.tsx` inside `inspector-panel.tsx`
  (Config/Run mode toggle). This is where Approve/Reject buttons go.
- Node registries: `executable-nodes/index.ts` (node components + palette),
  `inspector-panel.tsx` `CONFIG_FORMS` (inspector forms).
- AI agent node context builder: `aiAgentConversation` executor composes
  `<workflow-context>`, `<output-spec>` (downstream contracts), upstream
  `<context>` blocks, attached file paths, then the prompt. Output parsed from a
  trailing ` ```anubis-output ` fenced block → `{ text, data?, paths? }` via
  `parseEnvelope` (`executors/_envelope.js`). Per-downstream contracts live in
  `DOWNSTREAM_CONTRACTS`.

---

## 4. Target architecture

### 4.1 Engine — durable re-entrant scheduler
Replace the one-shot topological pass with a **ready-queue state machine**:
- A node becomes ready when its required incoming edges are satisfied; nodes can
  be re-queued → **cycles are legal**.
- **Conditional edges**: add optional `sourceHandle` to `WorkflowEdgeSchema`.
  Branch nodes expose named handles (e.g. `approved`/`rejected`). The scheduler
  propagates only along the fired handle; the not-taken branch's exclusive
  descendants are marked `skipped`.
- **Loop control**: per-loop iteration counter keyed on the loop-back edge (or
  the loop "head" node). When it exceeds `maxIterations` (configurable, default
  3), the run ends `failed` with a `needs-attention` reason rather than looping.
- **Suspend/resume**: an executor may return a suspend signal
  (e.g. `{ __suspend: { reason, handles } }`). The scheduler persists full run
  state and returns status `awaiting-input`. The run is **not** held in memory.
- Persist run state to the DB after every step → survives app restart.

### 4.2 Data-model changes
- `WorkflowEdgeSchema` (+ frontend serialization): add `sourceHandle?: string`.
- New migration `008_workflow_run_state.sql` + `WorkflowRunStateRepo`:
  `run_id` (UNIQUE FK), `node_outputs` (JSON map), `node_statuses` (JSON map),
  `loop_iterations` (JSON map), `suspended_node`, `suspended_handles`,
  `updated_at`. Add `awaiting-input` to the `RunStatus` enum (and the
  `workflow_runs.status` CHECK constraint).
- New migration `009_workflow_lessons.sql` + `WorkflowLessonsRepo`:
  `id`, `workflow_id`, `kind` (`good`|`mistake`), `text`, `run_id`,
  `created_at`. Methods: `append`, `recentForWorkflow(workflowId, limit)`.

### 4.3 New / changed nodes
- **`branchDecision`** (new, pure routing): reads upstream `data.decision`
  (`approved`|`rejected`) and routes via `approved`/`rejected` source handles.
- **`humanReview`** (new): returns the suspend signal with `approved`/`rejected`
  handles; config carries the loop `maxIterations`. Resumed from the UI.
- **`transcript`** (new): mirrors `ocrExtractor`; calls
  `ctx.transcribe.transcribeAudio(path)` — implemented by delegating to an AI
  agent conversation (see 4.4).
- **`aiAgentConversation`** (extended): optional `outputContract: 'decision'`
  mode instructing the agent to emit `{ decision, reason }` in `data` (drives
  AI #3).
- **`lessonWriter`** / **`lessonReader`** (new, thin): writer persists the
  agent's text to `WorkflowLessonsRepo`; reader injects recent lessons into
  downstream context (feeds AI #1 / AI #2). (Decision: keep these as dedicated
  nodes rather than overloading `aiAgentConversation` — finalise during impl.)
- **OCR**: implement `ctx.ocr` for real via the agent-delegation path.

### 4.4 OCR / Transcript wiring — delegate via AI agent
Backend has no MCP client, but ai-agent profiles get skills/MCP (incl.
anubis-extractor) materialised into the agent workspace. So `ctx.ocr` and the new
`ctx.transcribe` run a tiny ai-agent conversation that calls the extractor tools
(`extractor_ocr` / `extractor_transcribe`) and returns text. Trade-off: slower +
token cost per extraction, but zero new backend infra. (Needs a designated
profileId for the extraction helper — TBD in impl.)

### 4.5 Frontend
- Multi-handle rendering for branch nodes (extend `packages/workflow/handles.tsx`).
- `run-viewer.tsx`: Approve/Reject buttons when a `humanReview` node is
  `awaiting-input`; calls new `POST /workflow-runs/:id/resume`.
- New node cards + inspector config forms + palette entries for `branchDecision`,
  `humanReview`, `transcript`, `lessonWriter`, `lessonReader`.

### 4.6 Backend
- `WorkflowRunManager`: allow resume despite "one active run" block; add
  `resume(runId, nodeId, decision)` that rehydrates `workflow_run_state` and
  re-enters the scheduler; persist run-state on suspend; new resume route in
  `workflow.ts` (routes file) — confirm exact router location during impl.
- Wire `ctx.ocr` + new `ctx.transcribe` per 4.4.

---

## 5. File-level change map (for the plan)

- `packages/workflow-runtime/src/types.ts` — `sourceHandle` on edge; `awaiting-input`
  status; suspend-signal type; `transcribe` on `ExecutorContext`; branch handle types.
- `packages/workflow-runtime/src/graph.ts` — ready-set helpers; drop cycle ban for
  the scheduler path (keep a structural validator that allows declared loops).
- `packages/workflow-runtime/src/runner.ts` — rewrite to ready-queue scheduler with
  branching, loop counters + cap, suspend/resume entry points.
- `packages/workflow-runtime/src/executors/` — new `branch-decision.ts`,
  `human-review.ts`, `transcript.ts`, `lesson-writer.ts`, `lesson-reader.ts`;
  extend `ai-agent-conversation.ts` (decision contract); register all in
  `executors/index.ts`.
- `packages/conversation/src/db/migrations/008_workflow_run_state.sql`,
  `009_workflow_lessons.sql`; register in `migrations/index.ts`.
- `packages/conversation/src/db/repositories/workflow-run-state-repo.ts`,
  `workflow-lessons-repo.ts`; expose on `ConversationStack` (`index.ts`).
- `packages/backend/src/workflow-run-manager.ts` — persist/restore run state;
  `resume()`; wire `ctx.ocr` + `ctx.transcribe`.
- `packages/backend/src/workflow.ts` — `POST /workflow-runs/:id/resume`.
- `packages/workflow/handles.tsx` — multi source-handle support.
- `packages/frontend/src/components/workflow-editor/` — `executable-nodes/*`
  (+ `index.ts` palette), `inspector/config/*`, `inspector-panel.tsx`,
  `inspector/run-viewer.tsx` (approve/reject), `editor-canvas.tsx` (handle-aware
  connect).
- `scripts/create-test-workflow.mjs` — seed the assembled content workflow.

---

## 6. Validation strategy (TDD per CLAUDE.md)

1. Scheduler unit tests: conditional branching, cycle + iteration cap, suspend →
   persist → resume round-trip, skip-propagation for not-taken branches.
2. Repo tests: `workflow-run-state-repo`, `workflow-lessons-repo`.
3. Executor tests: `branchDecision`, `humanReview` (suspend signal),
   `transcript`, decision-mode `aiAgentConversation`, lesson writer/reader.
4. Backend: resume route + run-manager resume path.
5. Assemble the real graph in `scripts/create-test-workflow.mjs`; run end-to-end
   against the visible Electron DB
   (`C:\Users\User\AppData\Roaming\Electron\anubis\anubis.db`, seed via
   `$env:ANUBIS_DATA_DIR=...; node scripts\create-test-workflow.mjs`).

Per CLAUDE.md, build order is load-bearing: research-crawler → ai-agent →
backend → frontend → root vite → electron-builder. Typecheck/test commands:
`pnpm --filter @anubis/workflow-runtime test|typecheck|build`,
`pnpm --filter @anubis/frontend typecheck`.

---

## 7. Open items to finalise during implementation

1. Exact loop-counter key (loop-back edge id vs. loop-head node id) and where
   `maxIterations` config lives (on `humanReview` vs. a dedicated loop node).
2. Whether lessons are dedicated nodes (`lessonWriter`/`lessonReader`) or a mode
   on `aiAgentConversation`. Leaning: dedicated nodes.
3. The profileId used by the OCR/Transcript extraction-helper agent.
4. Exact backend router file/registration for the resume route.
5. How `skipped` propagation interacts with nodes that also sit on the loop path
   (a node may be skipped on one branch but re-activated by the loop).

---

## 8. Next session — start here

1. Re-read this doc.
2. Decide items in §7 (quick).
3. Invoke `superpowers:writing-plans` to turn this spec into a phased
   implementation plan, then `superpowers:test-driven-development` per unit.
4. Implement engine first (it gates everything), then nodes, then assemble + seed.
