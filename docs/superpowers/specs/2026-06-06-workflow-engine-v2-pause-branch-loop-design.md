# Workflow Engine v2 — Pause, Branch & Loop (Human Approval + Lesson Writer)

Date: 2026-06-06
Status: Design — approved shape, pending spec review
Owner: (this work)

## 1. Problem & motivation

The workflow builder's hand-drawn target flow is:

```
IG → JSON → media → AI(analyze) → MD → AI(improve) → MD → AI(review)
   → Human Review ──approved──▶ MD (+ AI: "what good looks like")
                   └─rejected──▶ AI: "write a lesson / what to avoid" ──▶ (loop back to Improve)
```

Three capabilities in that picture do not exist in the engine today:

1. **Pause for a human** — the runner ([`packages/workflow-runtime/src/runner.ts`](../../../packages/workflow-runtime/src/runner.ts)) is a single-pass topological executor: it sorts once and runs every node exactly once, with no way to wait for external input.
2. **Conditional branching** — every node runs; there is no notion of an "approved" vs "rejected" path where only one side executes.
3. **Loops** — `topologicalSort` throws on any cycle ("graph contains a cycle"), and the frontend `onConnect` refuses cyclic connections (`wouldCreateCycle`). The diagram's reject→improve loop is impossible.

Two smaller gaps:

4. **Markdown node has no OUT handle** — [`markdown-display.tsx`](../../../packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx) renders `handles='in'`, so you cannot draw `markdown → AI` in the builder even though the runtime already passes markdown text downstream.
5. **No lesson persistence** — anubis-core has an experience/feedback store (`ExperienceIndexService`), but nothing in the workflow writes to it.

The content-memory README already names this as deferred work: *"`lessonWriter`/`lessonReader` … + durable rejection→regenerate loop. The nodes will call the services here once the durable engine lands."* This spec is that durable-ish engine (in-memory pause; see non-goals).

## 2. Goals / non-goals

**Goals**
- Frontier scheduler that supports: pause-for-human, approved/rejected branch pruning, and a bounded reject→improve loop.
- New `humanApproval` node (pause + two-way branch) and `lessonWriter` node (writes the lesson + persists an experience memory).
- Fix the markdown OUT handle.
- A real Approve/Reject UI during a run.

**Non-goals (explicit)**
- **Durable resume across app/backend restart.** Pause is in-memory: a run awaiting approval is cancelled if the backend restarts. (Durable resume is a later project.)
- **anubis-core retrieval into the Improve agent.** The Improve node stays prompt-only; the loop's lesson reaches Improve **via the loop-back edge as context**, not via retrieval. Persisted memories help *future* runs once retrieval is wired (separate work).
- Nested loops, multiple concurrent approvals, parallel fan-out execution. The scheduler must not break on these graphs, but only the single-loop / single-approval shape is a supported, tested path.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Max loop iterations before auto-reject | **3** (configurable per `humanApproval` node, default 3) |
| Lesson paths | **Both** — reject (`type: 'mistake'`, loops back) **and** approve (`type: 'lesson'`, captures what worked) |
| Persisted lesson status | **`candidate`** (informs the in-run loop via edge; enters cross-run retrieval only after manual promote) |

## 4. Architecture

### 4.1 Edge model (labels + loop flag)

`WorkflowEdgeSchema` ([`types.ts`](../../../packages/workflow-runtime/src/types.ts)) gains two optional fields:

```ts
export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),         // 'approved' | 'rejected' | undefined
  data: z.object({ loop: z.boolean().optional() }).optional(),
})
```

- The frontend already captures `sourceHandle` on connect (`addEdge({ ...conn, … })` in [`editor-canvas.tsx`](../../../packages/frontend/src/components/workflow-editor/editor-canvas.tsx)); today it is silently stripped by `WorkflowGraphSchema.parse`. We stop stripping it and persist it in `draft_graph`/`published_graph` (no new DB column — it lives inside the graph JSON).
- **Loop edges** are marked `data.loop = true`. They are excluded from cycle detection and from the scheduler's readiness in-degree, and are the only edges allowed to point "backwards".

### 4.2 Frontier scheduler (replaces topo-once)

`runWorkflow` becomes a ready-queue scheduler over **edge state** rather than a fixed topo order.

- Each non-loop edge has a state: `pending → active | dead`.
- A node is **ready** when every incoming **non-loop** edge is *settled* (`active` or `dead`).
  - If ≥1 incoming edge is `active` (or the node has no incoming non-loop edges) → **run** it.
  - If **all** incoming edges are `dead` → mark the node `skipped`, and mark all its outgoing edges `dead` (cascade).
- On node completion, the node decides which outgoing edges activate:
  - Default nodes: **all** outgoing non-loop edges → `active`.
  - `humanApproval`: only edges whose `sourceHandle` equals the decision (`'approved'`/`'rejected'`) → `active`; the others → `dead`.
- **Pause** falls out for free: `humanApproval.run()` returns a promise that doesn't resolve until a decision arrives, so the scheduler simply awaits it. While any node promise is unresolved and is a `humanApproval`, the run status is `awaiting_approval`.
- Cycle detection (`topologicalSort`) is replaced by readiness; a separate static check rejects cycles **formed by non-loop edges only** (loop edges are allowed to be back-edges).

### 4.3 Loop semantics

- A loop edge `lessonWriter --(loop)--> ai-improve` does not gate readiness. When `lessonWriter` runs on the rejected path, after it completes the scheduler **re-arms the loop body**:
  - **Loop body** = nodes reachable from the loop edge's target (`ai-improve`) that can also reach the `humanApproval` node. Their states reset to `pending`, outputs cleared, incoming edges reset to `pending`.
  - The loop edge supplies `ai-improve` with the lesson text as upstream context for the next iteration.
  - An **iteration counter** (per `humanApproval`) increments. If it would exceed `maxIterations` (default 3), the scheduler does **not** re-arm; instead the run ends as **`rejected`** (the final lesson is still written/persisted).
- The approved path is linear (no loop).

### 4.4 Pause + decision transport

- New `ExecutorContext.approvals`:
  ```ts
  approvals: { waitFor(nodeId: string, opts: { title?: string; instructions?: string; upstream: unknown }): Promise<{ decision: 'approved' | 'rejected'; notes?: string }> }
  ```
  Implemented in `WorkflowRunManager`: registers a pending resolver keyed by `runId:nodeId`, emits a `node-awaiting` event, and resolves when the decision endpoint is hit (or rejects on abort).
- New endpoint: **`POST /workflows/runs/:runId/decisions`** `{ nodeId, decision: 'approved'|'rejected', notes? }` → resolves the parked promise (404 if no such pending decision; 409 if already decided).
- New context dep: **`experience: ExperienceIndexService`** (from `stack.experience`) for `lessonWriter`.
- New context field **`workspaceId: string`** — the run's brand workspace, read from the workflow row (`workflow.workspaceId`, default `'default-workspace'`) in `WorkflowRunManager.start`, so `lessonWriter` knows which brand to scope the memory to.

### 4.5 New / changed nodes

| Node | Change |
|---|---|
| `markdownDisplay` | `handles='in'` → `'both'` (one line). Runtime already passes through. |
| `humanApproval` (new) | Config `{ title?, instructions?, maxIterations?: number }`. Renders two OUT handles `approved`/`rejected`. Calls `ctx.approvals.waitFor(...)`. Output `{ kind:'approval', decision, notes }` and passes upstream content through so both branches see the reviewed content. |
| `lessonWriter` (new) | AI-agent variant. Config `{ profileId, reasoning?, prompt?, lessonType: 'mistake'|'lesson' }`. Runs a conversation (reuses the `aiAgentConversation` composition), **outputs the lesson `text`** (consumed by the loop-back edge / downstream markdown) **and** persists via `ctx.experience.recordCandidate({ type: lessonType, title, problem, correction, preventionRule, severity, workspaceId: ctx.workspaceId, platform: null, sourceRunId: ctx.runId })` as `candidate`. (Platform left `null` in v1 — not threaded from the source post yet.) |

`humanApproval` and `lessonWriter` register in: runtime `executorRegistry` + `WorkflowGraphSchema` types; frontend `executableNodeTypes`, `NODE_PALETTE` (category `agent`/`output`), an inspector config form each, and the inspector panel switch.

## 5. Data model / migration

**Migration 017** (`017_workflow_runs_pause.sql`, registered in [`migrations/index.ts`](../../../packages/conversation/src/db/migrations/index.ts) after 016): rebuild the two tables (SQLite cannot ALTER a CHECK) to widen the status enums.

- `workflow_runs.status`: add `'awaiting_approval'`, `'rejected'`.
- `workflow_run_steps.status`: add `'awaiting'`.
- Optional: `workflow_run_steps.iteration INTEGER` (default 0) to disambiguate loop re-runs in the run viewer.

Rebuild pattern: create `*_new` with the new CHECK, `INSERT INTO … SELECT …`, drop old, rename, recreate indexes — inside the migration. The standalone seed scripts (`scripts/create-*.mjs`) that inline migration 004 get the widened CHECK too.

## 6. API / event-stream changes

- `RunStatus` (+ store `ActiveRun.status`) gains `awaiting_approval`, `rejected`.
- `StepStatus` (+ store `StepState.status`) gains `awaiting`.
- SSE `NodeRunEvent` gains:
  - `{ kind: 'node-awaiting'; nodeId; at; title?; instructions? }`
  - `{ kind: 'node-decided'; nodeId; at; decision; notes? }`
- `workflowsApi.decide(runId, { nodeId, decision, notes? })` client method; `openRunEventStream` keeps the stream open through `node-awaiting` (it only closes on `run-finished`, already true).

## 7. Frontend changes

- **Handles:** `humanApproval` card renders two labelled source handles (`approved` green / `rejected` red) — extend `NodeDirectionalHandles` to accept a custom handle list, or a dedicated handles render in the node card.
- **Decision UI:** when a node's step status is `awaiting`, its card shows **Approve / Reject** buttons (+ optional notes) that call `workflowsApi.decide`. The run-status banner shows "Awaiting your review".
- **Store:** `applyRunEvent` handles `node-awaiting` (set step `awaiting`) and `node-decided`.
- **Loop edges:** edge inspector gets a "Loop back" toggle (sets `edge.data.loop`); `wouldCreateCycle` ignores loop edges so the connection is allowed.
- **Inspector configs:** `human-approval-config.tsx`, `lesson-writer-config.tsx`.

## 8. Testing plan

- **Runtime (vitest, the core):**
  - scheduler: branch pruning (only approved branch runs; rejected nodes `skipped`), all-dead-inputs skip cascade, loop re-arm + iteration bound (auto-reject at maxIterations), pause/resume via a fake `approvals.waitFor` resolver.
  - `humanApproval` executor (awaits + maps decision to active branch), `lessonWriter` executor (outputs text + calls a fake `experience.recordCandidate`).
  - cycle check still rejects non-loop cycles; loop edges allowed.
- **Backend:** decision endpoint (resolves, 404/409 paths), `awaiting_approval`/`rejected` persisted, abort cancels a parked approval.
- **Frontend:** node renders approve/reject when awaiting; decide() posts; store transitions. (Light — mostly type-level + one interaction test.)

## 9. Build order

1. Edge schema + `markdownDisplay` handle fix (small, independent).
2. Scheduler rewrite (`runner.ts`) with branch pruning + skip cascade — keep existing linear workflows green (regression).
3. Loop support in scheduler + non-loop cycle check.
4. Pause: `approvals` ctx, run-manager parking, decision endpoint, SSE events, migration 017, status enums.
5. `humanApproval` + `lessonWriter` executors + registry.
6. Frontend: node cards, handles, inspector configs, palette, decision UI, store, loop-edge toggle.
7. End-to-end: extend the seeded "Real: IG content pipeline" with approval + lesson + loop and run it.

## 10. Risks & open questions

- **Scheduler rewrite regresses existing linear workflows.** Mitigation: the existing runtime test suite (72 tests) must stay green; scheduler must be behavior-identical for acyclic, branch-free graphs.
- **Loop body detection** (which nodes reset) is the subtlest piece — must handle the approval node sitting on both the loop and the approved exit. Mitigation: define loop body as `reachable(loopTarget) ∩ canReach(approvalNode)`; cover with tests.
- **In-memory pause** means a long human delay + backend restart loses the run. Accepted for v1 (non-goal); the run shows as `cancelled` after restart.
- **Token cost**: up to 3 Improve→Review cycles per run. Bounded by `maxIterations`.
- Open: should `node-awaiting` also surface in the workflow-list "lastRun" status? (Minor; default yes — show `awaiting_approval`.)
