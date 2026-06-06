# Workflow Engine v2 (Pause, Branch & Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the topo-once workflow runner with a frontier scheduler that supports a human-approval pause, approved/rejected branch pruning, and a bounded reject→improve loop, plus the `humanApproval` and `lessonWriter` nodes and the markdown OUT-handle fix.

**Architecture:** A ready-queue scheduler over per-edge state (`pending|active|dead`) replaces `topologicalSort`. A finished node activates outgoing edges (all, or only the branch matching an approval decision); nodes with all-dead inputs are skipped. `humanApproval` pauses by awaiting a promise the run-manager parks until a decision endpoint resolves it. Loop edges (`edge.data.loop`) are exempt from cycle checks and re-arm a bounded loop body. `lessonWriter` writes a lesson, feeds it back via the loop edge, and persists an experience memory to anubis-core.

**Tech Stack:** TypeScript ESM monorepo; `@anubis/workflow-runtime` (zod, vitest), `@anubis/backend` (Hono), `@anubis/conversation` (better-sqlite3 migrations), `@anubis/content-memory` (`ExperienceIndexService`), `@anubis/frontend` (React 19, `@xyflow/react`, zustand).

**Spec:** `docs/superpowers/specs/2026-06-06-workflow-engine-v2-pause-branch-loop-design.md`

---

## File Structure

**Created:**
- `packages/workflow-runtime/src/executors/human-approval.ts` — humanApproval executor (pause + decision→branch).
- `packages/workflow-runtime/src/executors/lesson-writer.ts` — lessonWriter executor (write lesson, persist memory).
- `packages/workflow-runtime/tests/runner-branch.test.ts` — branch pruning + skip cascade tests.
- `packages/workflow-runtime/tests/runner-loop.test.ts` — loop re-arm + bound tests.
- `packages/workflow-runtime/tests/runner-pause.test.ts` — pause/resume via fake approvals.
- `packages/workflow-runtime/tests/executors/human-approval.test.ts`
- `packages/workflow-runtime/tests/executors/lesson-writer.test.ts`
- `packages/conversation/src/db/migrations/017_workflow_runs_pause.sql` — widen status enums + add `iteration`.
- `packages/frontend/src/components/workflow-editor/executable-nodes/human-approval.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/lesson-writer.tsx`
- `packages/frontend/src/components/workflow-editor/inspector/config/human-approval-config.tsx`
- `packages/frontend/src/components/workflow-editor/inspector/config/lesson-writer-config.tsx`

**Modified:**
- `packages/workflow-runtime/src/types.ts` — edge schema fields, `RunStatus`/`StepStatus`/`NodeRunEvent` additions, `ExecutorContext` additions.
- `packages/workflow-runtime/src/runner.ts` — frontier scheduler (full rewrite).
- `packages/workflow-runtime/src/graph.ts` — `assertAcyclicExceptLoops`.
- `packages/workflow-runtime/src/executors/index.ts` — register new executors.
- `packages/workflow-runtime/src/executors/markdown-display.ts` — (no change; runtime already passes through).
- `packages/backend/src/workflow-run-manager.ts` — approvals parking, `experience`/`workspaceId` ctx, new events, awaiting/rejected persistence.
- `packages/backend/src/workflow.ts` — `POST /runs/:runId/decisions`; SSE already forwards all events.
- `packages/frontend/src/api/workflows.ts` — new event kinds, `decide()`.
- `packages/frontend/src/components/workflow-editor/editor-store.ts` — new statuses + event handling.
- `packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx` — `handles='in'` → `'both'`.
- `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts` — node types + palette.
- `packages/frontend/src/components/workflow-editor/inspector-panel.tsx` — register config forms.
- `packages/frontend/src/components/workflow-editor/editor-canvas.tsx` — loop edge on cycle; render approval's two handles.
- `packages/frontend/src/components/workflow/handles.tsx` — labelled approve/reject handles.

**Test commands** (from repo root):
- Runtime unit: `pnpm vitest run packages/workflow-runtime/tests/<file>`
- Runtime all + typecheck: `pnpm --filter @anubis/workflow-runtime test` · `pnpm --filter @anubis/workflow-runtime typecheck`
- Rebuild runtime before backend tests (vitest resolves `@anubis/*` to `dist`): `pnpm --filter @anubis/workflow-runtime build`
- Backend: `pnpm vitest run packages/backend/tests/<file>`
- Frontend typecheck: `pnpm --filter @anubis/frontend typecheck`

---

## Task 1: Edge schema fields + markdown OUT handle

**Files:**
- Modify: `packages/workflow-runtime/src/types.ts` (WorkflowEdgeSchema)
- Test: `packages/workflow-runtime/tests/edge-schema.test.ts` (create)
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx:25`

- [ ] **Step 1: Write the failing test** — `packages/workflow-runtime/tests/edge-schema.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { WorkflowEdgeSchema, WorkflowGraphSchema } from '../src/types.js'

describe('WorkflowEdgeSchema', () => {
  it('preserves sourceHandle and data.loop', () => {
    const e = WorkflowEdgeSchema.parse({
      id: 'e1', source: 'a', target: 'b', sourceHandle: 'rejected', data: { loop: true },
    })
    expect(e.sourceHandle).toBe('rejected')
    expect(e.data?.loop).toBe(true)
  })

  it('still accepts a minimal edge', () => {
    const e = WorkflowEdgeSchema.parse({ id: 'e1', source: 'a', target: 'b' })
    expect(e.sourceHandle).toBeUndefined()
    expect(e.data).toBeUndefined()
  })

  it('graph parse keeps the new edge fields', () => {
    const g = WorkflowGraphSchema.parse({
      nodes: [{ id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
              { id: 'b', type: 'table', position: { x: 1, y: 0 }, data: {} }],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'approved' }],
    })
    expect(g.edges[0]!.sourceHandle).toBe('approved')
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm vitest run packages/workflow-runtime/tests/edge-schema.test.ts` → FAIL (sourceHandle stripped/undefined).

- [ ] **Step 3: Implement** — in `packages/workflow-runtime/src/types.ts`, replace `WorkflowEdgeSchema`:

```ts
export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** Outgoing port the edge leaves from. Used by branch-aware nodes (humanApproval): 'approved' | 'rejected'. */
  sourceHandle: z.string().optional(),
  /** `loop: true` marks a back-edge that re-arms a loop body; exempt from cycle checks. */
  data: z.object({ loop: z.boolean().optional() }).optional(),
})
```

- [ ] **Step 4: Run it, expect PASS** — `pnpm vitest run packages/workflow-runtime/tests/edge-schema.test.ts` → PASS.

- [ ] **Step 5: Fix markdown handle** — in `markdown-display.tsx`, change the `NodeShell` prop `handles='in'` to `handles='both'` (or delete the prop — `'both'` is the default).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @anubis/workflow-runtime typecheck
pnpm --filter @anubis/frontend typecheck
git add packages/workflow-runtime/src/types.ts packages/workflow-runtime/tests/edge-schema.test.ts packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx
git commit -m "feat(workflow): labelled edges (sourceHandle + loop) and markdown OUT handle"
```

---

## Task 2: Frontier scheduler — branch pruning + skip cascade

Rewrite `runWorkflow` to a ready-queue scheduler. Must keep all existing runtime tests green (linear/branch-free graphs behave identically) and add branch pruning.

**Files:**
- Modify: `packages/workflow-runtime/src/graph.ts` (add `assertAcyclicExceptLoops`)
- Modify: `packages/workflow-runtime/src/runner.ts` (full rewrite)
- Test: `packages/workflow-runtime/tests/runner-branch.test.ts` (create)

- [ ] **Step 1: Add the cycle helper** — append to `packages/workflow-runtime/src/graph.ts`:

```ts
import type { WorkflowEdge } from './types.js'

export function isLoopEdge(e: WorkflowEdge): boolean {
  return e.data?.loop === true
}

/** Reject cycles formed by non-loop edges only. Loop edges may be back-edges. */
export function assertAcyclicExceptLoops(graph: WorkflowGraph): void {
  validateGraphStructure(graph)
  const forward = graph.edges.filter((e) => !isLoopEdge(e))
  const sub: WorkflowGraph = { nodes: graph.nodes, edges: forward }
  topologicalSort(sub) // throws "graph contains a cycle" if forward edges cycle
}
```

- [ ] **Step 2: Write the failing test** — `packages/workflow-runtime/tests/runner-branch.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function ctx(): ExecutorContext {
  return {
    crawler: {} as never, ocr: {} as never, db: {} as never, fs: {} as never,
    conversations: {} as never, approvals: {} as never, experience: {} as never,
    workspaceId: 'default-workspace', runId: 'r1',
    signal: new AbortController().signal, emit: () => {},
  }
}

/** Echo executor that returns its config.value; an 'approver' executor returns a fixed decision. */
const registry: Record<string, Executor<unknown>> = {
  echo: { type: 'echo', validateConfig: (c) => c, run: async (i) => ({ value: (i.config as { value: string }).value }) },
  approver: {
    type: 'approver', validateConfig: (c) => c,
    run: async (i) => ({ kind: 'approval', decision: (i.config as { decision: string }).decision }),
  },
}

it('runs only the branch matching the approval decision; the other is skipped', async () => {
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'gate', type: 'approver', position: { x: 0, y: 0 }, data: { decision: 'approved' } },
      { id: 'ok',   type: 'echo',     position: { x: 1, y: 0 }, data: { value: 'approved-path' } },
      { id: 'bad',  type: 'echo',     position: { x: 1, y: 1 }, data: { value: 'rejected-path' } },
    ],
    edges: [
      { id: 'e1', source: 'gate', target: 'ok',  sourceHandle: 'approved' },
      { id: 'e2', source: 'gate', target: 'bad', sourceHandle: 'rejected' },
    ],
  }
  const res = await runWorkflow(graph, registry, ctx())
  expect(res.status).toBe('succeeded')
  expect(res.stepStatuses.ok).toBe('succeeded')
  expect(res.stepStatuses.bad).toBe('skipped')
  expect(res.outputs.ok).toEqual({ value: 'approved-path' })
})
```

- [ ] **Step 3: Run it, expect FAIL** — `pnpm vitest run packages/workflow-runtime/tests/runner-branch.test.ts` → FAIL.

- [ ] **Step 4: Rewrite `runner.ts`** — replace the whole file:

```ts
import { incomingEdges, outgoingEdges, assertAcyclicExceptLoops, isLoopEdge } from './graph.js'
import type {
  Executor, ExecutorContext, RunStatus, StepStatus, WorkflowGraph, WorkflowEdge,
} from './types.js'

export interface RunResult {
  status: RunStatus
  outputs: Record<string, unknown>
  stepStatuses: Record<string, StepStatus>
  error?: string
}

type EdgeState = 'pending' | 'active' | 'dead'
const MAX_STEPS = 1000

/** Which outgoing sourceHandle a finished node activates. null = activate all outgoing edges. */
function selectedBranch(output: unknown): string | null {
  if (output && typeof output === 'object' && (output as { kind?: string }).kind === 'approval') {
    const d = (output as { decision?: string }).decision
    if (d === 'approved' || d === 'rejected') return d
  }
  return null
}

export async function runWorkflow(
  graph: WorkflowGraph,
  registry: Record<string, Executor<unknown>>,
  ctx: ExecutorContext,
  opts?: { seed?: Record<string, unknown> },
): Promise<RunResult> {
  assertAcyclicExceptLoops(graph)
  for (const node of graph.nodes) {
    if (!registry[node.type]) throw new Error(`unknown node type: ${node.type}`)
    registry[node.type]!.validateConfig(node.data)
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const forward = graph.edges.filter((e) => !isLoopEdge(e))
  const loops = graph.edges.filter(isLoopEdge)
  const inForward = (id: string) => forward.filter((e) => e.target === id)
  const outForward = (id: string) => forward.filter((e) => e.source === id)

  const edgeState = new Map<string, EdgeState>()
  for (const e of forward) edgeState.set(e.id, 'pending')

  const outputs: Record<string, unknown> = {}
  const stepStatuses: Record<string, StepStatus> = {}
  for (const n of graph.nodes) stepStatuses[n.id] = 'pending'

  function markOutgoing(nodeId: string, branch: string | null) {
    for (const e of outForward(nodeId)) {
      const take = branch === null || (e.sourceHandle ?? null) === branch
      edgeState.set(e.id, take ? 'active' : 'dead')
    }
  }

  function readyNodes(): string[] {
    const out: string[] = []
    for (const n of graph.nodes) {
      if (stepStatuses[n.id] !== 'pending') continue
      if (inForward(n.id).every((e) => edgeState.get(e.id) !== 'pending')) out.push(n.id)
    }
    return out
  }

  let stepCount = 0
  while (true) {
    if (ctx.signal.aborted) {
      for (const n of graph.nodes) if (stepStatuses[n.id] === 'pending') stepStatuses[n.id] = 'skipped'
      return { status: 'cancelled', outputs, stepStatuses }
    }
    const ready = readyNodes()
    if (ready.length === 0) break

    let didWork = false
    for (const nodeId of ready) {
      if (stepStatuses[nodeId] !== 'pending') continue
      const inc = inForward(nodeId)
      const hasActive = inc.length === 0 || inc.some((e) => edgeState.get(e.id) === 'active')
      if (!hasActive) {                       // all inputs dead → skip and dead-cascade
        stepStatuses[nodeId] = 'skipped'
        for (const e of outForward(nodeId)) edgeState.set(e.id, 'dead')
        didWork = true
        continue
      }
      if (++stepCount > MAX_STEPS) {
        return { status: 'failed', outputs, stepStatuses, error: 'workflow exceeded max steps (unbounded loop?)' }
      }
      const result = await runNode(nodeId)
      if (result) return result               // failure short-circuits
      didWork = true
    }
    if (!didWork) break
  }

  return { status: 'succeeded', outputs, stepStatuses }

  async function runNode(nodeId: string): Promise<RunResult | null> {
    if (opts?.seed && Object.prototype.hasOwnProperty.call(opts.seed, nodeId)) {
      const seeded = opts.seed[nodeId]
      outputs[nodeId] = seeded
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output: seeded })
      markOutgoing(nodeId, null)
      return null
    }
    const node = nodeById.get(nodeId)!
    const upstream: Record<string, unknown> = {}
    for (const e of inForward(nodeId)) if (edgeState.get(e.id) === 'active') upstream[e.source] = outputs[e.source]
    for (const e of loops) if (e.target === nodeId && outputs[e.source] !== undefined) upstream[e.source] = outputs[e.source]
    const downstream = [...outForward(nodeId), ...loops.filter((e) => e.source === nodeId)]
      .map((e) => ({ nodeId: e.target, type: nodeById.get(e.target)!.type }))

    stepStatuses[nodeId] = 'running'
    ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })
    try {
      const output = await registry[node.type]!.run({ nodeId, config: node.data as never, upstream, downstream }, ctx)
      outputs[nodeId] = output
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output })
      markOutgoing(nodeId, selectedBranch(output))
      return null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stepStatuses[nodeId] = 'failed'
      ctx.emit({ kind: 'node-failed', nodeId, at: Date.now(), error: message })
      for (const n of graph.nodes) if (stepStatuses[n.id] === 'pending') stepStatuses[n.id] = 'skipped'
      return { status: 'failed', outputs, stepStatuses, error: message }
    }
  }
}
```

> Note: `incomingEdges`/`outgoingEdges` stay exported for existing callers. Loop re-arm is added in Task 3 (the loop `for` over `loops` currently only feeds context).

- [ ] **Step 5: Run new + existing tests** — `pnpm vitest run packages/workflow-runtime/tests/runner-branch.test.ts` → PASS, then `pnpm --filter @anubis/workflow-runtime test` → all green (existing linear tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-runtime/src/runner.ts packages/workflow-runtime/src/graph.ts packages/workflow-runtime/tests/runner-branch.test.ts
git commit -m "feat(workflow): frontier scheduler with branch pruning and skip cascade"
```

---

## Task 3: Bounded reject→improve loop

Add loop re-arm. When a node with an outgoing **loop** edge finishes, reset the loop body and re-run, bounded by `maxIterations` (read from the approval node's config, default 3). Exceeding the bound ends the run `rejected`.

**Files:**
- Modify: `packages/workflow-runtime/src/runner.ts`
- Test: `packages/workflow-runtime/tests/runner-loop.test.ts` (create)

- [ ] **Step 1: Write the failing test** — `packages/workflow-runtime/tests/runner-loop.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function ctx(): ExecutorContext {
  return { crawler: {} as never, ocr: {} as never, db: {} as never, fs: {} as never,
    conversations: {} as never, approvals: {} as never, experience: {} as never,
    workspaceId: 'w', runId: 'r1', signal: new AbortController().signal, emit: () => {} }
}

// 'improve' counts attempts; 'gate' rejects until attempt >= 3 then approves; 'lesson' loops back.
it('loops reject→lesson→improve, bounded, then approves', async () => {
  let attempt = 0
  const registry: Record<string, Executor<unknown>> = {
    improve: { type: 'improve', validateConfig: (c) => c, run: async () => ({ value: ++attempt }) },
    gate: {
      type: 'gate', validateConfig: (c) => c,
      run: async (i) => ({ kind: 'approval', decision: (i.upstream['improve'] as { value: number }).value >= 3 ? 'approved' : 'rejected' }),
    },
    lesson: { type: 'lesson', validateConfig: (c) => c, run: async () => ({ kind: 'lesson', text: 'try harder' }) },
    done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
  }
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'improve', type: 'improve', position: { x: 0, y: 0 }, data: {} },
      { id: 'gate',    type: 'gate',    position: { x: 1, y: 0 }, data: { maxIterations: 5 } },
      { id: 'done',    type: 'done',    position: { x: 2, y: 0 }, data: {} },
      { id: 'lesson',  type: 'lesson',  position: { x: 2, y: 1 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'improve', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'done',   sourceHandle: 'approved' },
      { id: 'e3', source: 'gate', target: 'lesson', sourceHandle: 'rejected' },
      { id: 'e4', source: 'lesson', target: 'improve', data: { loop: true } },
    ],
  }
  const res = await runWorkflow(graph, registry, ctx())
  expect(res.status).toBe('succeeded')
  expect(attempt).toBe(3)
  expect(res.stepStatuses.done).toBe('succeeded')
})

it('ends rejected when maxIterations is exceeded', async () => {
  const registry: Record<string, Executor<unknown>> = {
    improve: { type: 'improve', validateConfig: (c) => c, run: async () => ({ value: 1 }) },
    gate: { type: 'gate', validateConfig: (c) => c, run: async () => ({ kind: 'approval', decision: 'rejected' }) },
    lesson: { type: 'lesson', validateConfig: (c) => c, run: async () => ({ kind: 'lesson', text: 'x' }) },
    done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
  }
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'improve', type: 'improve', position: { x: 0, y: 0 }, data: {} },
      { id: 'gate',    type: 'gate',    position: { x: 1, y: 0 }, data: { maxIterations: 2 } },
      { id: 'done',    type: 'done',    position: { x: 2, y: 0 }, data: {} },
      { id: 'lesson',  type: 'lesson',  position: { x: 2, y: 1 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'improve', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'done',   sourceHandle: 'approved' },
      { id: 'e3', source: 'gate', target: 'lesson', sourceHandle: 'rejected' },
      { id: 'e4', source: 'lesson', target: 'improve', data: { loop: true } },
    ],
  }
  const res = await runWorkflow(graph, registry, ctx())
  expect(res.status).toBe('rejected')
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run packages/workflow-runtime/tests/runner-loop.test.ts` → FAIL (no loop support; `done` runs / never reaches 3).

- [ ] **Step 3: Implement loop re-arm in `runner.ts`.** Add, after `markOutgoing` (inside `runWorkflow`):

```ts
  // iteration count keyed by loop-edge target (re-entry node)
  const iteration = new Map<string, number>()
  let rejected = false

  // loop body = nodes reachable forward from `target` that can also reach `approvalNode`
  function loopBody(target: string, approvalNode: string): Set<string> {
    const fwd = new Map<string, string[]>()
    const rev = new Map<string, string[]>()
    for (const n of graph.nodes) { fwd.set(n.id, []); rev.set(n.id, []) }
    for (const e of forward) { fwd.get(e.source)!.push(e.target); rev.get(e.target)!.push(e.source) }
    const reach = (start: string, adj: Map<string, string[]>) => {
      const seen = new Set<string>([start]); const q = [start]
      while (q.length) for (const x of adj.get(q.shift()!) ?? []) if (!seen.has(x)) { seen.add(x); q.push(x) }
      return seen
    }
    const down = reach(target, fwd)
    const up = reach(approvalNode, rev)
    return new Set([...down].filter((x) => up.has(x)))
  }

  function rearm(loopEdge: WorkflowEdge): boolean {
    // approval node is the source whose 'rejected' branch led here (the lesson's upstream gate)
    const approvalNode = forward.find((e) => e.target === loopEdge.source && e.sourceHandle === 'rejected')?.source
    if (!approvalNode) return false
    const cfg = (nodeById.get(approvalNode)!.data ?? {}) as { maxIterations?: number }
    const max = cfg.maxIterations ?? 3
    const target = loopEdge.target
    const n = (iteration.get(target) ?? 0) + 1
    if (n >= max) { rejected = true; return false }
    iteration.set(target, n)
    const body = loopBody(target, approvalNode)
    for (const id of body) { stepStatuses[id] = 'pending'; delete outputs[id] }
    for (const e of forward) if (body.has(e.target)) edgeState.set(e.id, 'pending')
    return true
  }
```

Then in `runNode`, after `markOutgoing(nodeId, selectedBranch(output))` and before `return null`, add:

```ts
      for (const le of loops) {
        if (le.source === nodeId) rearm(le)  // a node with an outgoing loop edge just produced its lesson
      }
```

And change the final return to honor `rejected`:

```ts
  return { status: rejected ? 'rejected' : 'succeeded', outputs, stepStatuses }
```

> The lesson output stays in `outputs[lessonNode]` (not cleared — it's outside the body that resets only `target`-reachable nodes; if the lesson node is inside the body it is recomputed next pass anyway). The loop edge feeds it to `target` via the existing loop-context line in `runNode`.

- [ ] **Step 4: Run, expect PASS** — `pnpm vitest run packages/workflow-runtime/tests/runner-loop.test.ts` → PASS. Then `pnpm --filter @anubis/workflow-runtime test` → all green.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/runner.ts packages/workflow-runtime/tests/runner-loop.test.ts
git commit -m "feat(workflow): bounded reject->improve loop via loop edges"
```

---

## Task 4: Runtime types — statuses, events, context deps

**Files:**
- Modify: `packages/workflow-runtime/src/types.ts`
- Test: `packages/workflow-runtime/tests/types.test.ts` (create — compile-time + shape)

- [ ] **Step 1: Write the failing test** — `packages/workflow-runtime/tests/types.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import type { RunStatus, StepStatus, NodeRunEvent } from '../src/types.js'

it('new statuses and events are part of the unions', () => {
  const r: RunStatus[] = ['pending', 'running', 'awaiting_approval', 'succeeded', 'failed', 'rejected', 'cancelled']
  const s: StepStatus[] = ['pending', 'running', 'awaiting', 'succeeded', 'failed', 'skipped']
  const awaiting: NodeRunEvent = { kind: 'node-awaiting', nodeId: 'n', at: 1, title: 't' }
  const decided: NodeRunEvent = { kind: 'node-decided', nodeId: 'n', at: 1, decision: 'approved' }
  expect(r.length).toBe(7); expect(s.length).toBe(6)
  expect(awaiting.kind).toBe('node-awaiting'); expect(decided.kind).toBe('node-decided')
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run packages/workflow-runtime/tests/types.test.ts` → FAIL (type errors).

- [ ] **Step 3: Implement** — in `packages/workflow-runtime/src/types.ts`:

Replace the status type lines:

```ts
export type RunStatus = 'pending' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'awaiting' | 'succeeded' | 'failed' | 'skipped'
```

Extend `NodeRunEvent`:

```ts
export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }
  | { kind: 'node-awaiting';  nodeId: string; at: number; title?: string; instructions?: string }
  | { kind: 'node-decided';   nodeId: string; at: number; decision: 'approved' | 'rejected'; notes?: string }
```

Add to `ExecutorContext` (after `conversations`):

```ts
  approvals: {
    waitFor(nodeId: string, opts: { title?: string; instructions?: string; upstream: unknown }): Promise<{ decision: 'approved' | 'rejected'; notes?: string }>
  }
  experience: {
    recordCandidate(input: {
      type: 'mistake' | 'lesson'
      title: string; problem: string; correction: string
      preventionRule?: string | null; severity?: 'low' | 'medium' | 'high' | 'critical'
      workspaceId?: string | null; platform?: string | null; sourceRunId?: string | null
    }): { id: string }
  }
  /** The run's brand workspace (default 'default-workspace'). */
  workspaceId: string
```

- [ ] **Step 4: Run, expect PASS** — `pnpm vitest run packages/workflow-runtime/tests/types.test.ts` → PASS. `pnpm --filter @anubis/workflow-runtime typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/types.ts packages/workflow-runtime/tests/types.test.ts
git commit -m "feat(workflow): awaiting/rejected statuses, approval events, approvals+experience ctx"
```

---

## Task 5: humanApproval executor

**Files:**
- Create: `packages/workflow-runtime/src/executors/human-approval.ts`
- Test: `packages/workflow-runtime/tests/executors/human-approval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { humanApprovalExecutor } from '../../src/executors/human-approval.js'

function ctx(decision: 'approved' | 'rejected') {
  return {
    crawler: {} as never, ocr: {} as never, db: {} as never, fs: {} as never,
    conversations: {} as never, experience: {} as never, workspaceId: 'w', runId: 'r',
    signal: new AbortController().signal, emit: () => {},
    approvals: { waitFor: async () => ({ decision, notes: 'ok' }) },
  }
}

it('passes upstream through and returns the decision', async () => {
  const out = await humanApprovalExecutor.run(
    { nodeId: 'gate', config: { title: 'Review' }, upstream: { x: { text: 'draft' } }, downstream: [] },
    ctx('approved') as never,
  )
  expect(out).toMatchObject({ kind: 'approval', decision: 'approved', notes: 'ok' })
})

it('rejects config without nothing required (title optional)', () => {
  expect(() => humanApprovalExecutor.validateConfig({})).not.toThrow()
  expect(() => humanApprovalExecutor.validateConfig({ maxIterations: 0 })).toThrow()
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run packages/workflow-runtime/tests/executors/human-approval.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `packages/workflow-runtime/src/executors/human-approval.ts`

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  title: z.string().optional(),
  instructions: z.string().optional(),
  maxIterations: z.number().int().positive().max(20).optional(),
})

export type HumanApprovalConfig = z.infer<typeof ConfigSchema>

export interface HumanApprovalOutput {
  kind: 'approval'
  decision: 'approved' | 'rejected'
  notes?: string
  /** The reviewed content, passed through so the taken branch can use it. */
  reviewed: Record<string, unknown>
}

export const humanApprovalExecutor: Executor<HumanApprovalConfig> = {
  type: 'humanApproval',
  validateConfig(raw) { return ConfigSchema.parse(raw) },
  async run(input, ctx) {
    const { decision, notes } = await ctx.approvals.waitFor(input.nodeId, {
      title: input.config.title,
      instructions: input.config.instructions,
      upstream: input.upstream,
    })
    return { kind: 'approval', decision, notes, reviewed: input.upstream } satisfies HumanApprovalOutput
  },
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm vitest run packages/workflow-runtime/tests/executors/human-approval.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/human-approval.ts packages/workflow-runtime/tests/executors/human-approval.test.ts
git commit -m "feat(workflow): humanApproval executor (pause + decision)"
```

---

## Task 6: lessonWriter executor

Reuses the AI-conversation composition from `ai-agent-conversation.ts` (extract the shared `composeMessage`/`parseEnvelope` use), runs a turn, **and** persists an experience memory.

**Files:**
- Create: `packages/workflow-runtime/src/executors/lesson-writer.ts`
- Test: `packages/workflow-runtime/tests/executors/lesson-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { lessonWriterExecutor } from '../../src/executors/lesson-writer.js'

function ctx(recordCandidate: () => { id: string }) {
  return {
    crawler: {} as never, ocr: {} as never, db: {} as never, fs: {} as never,
    approvals: {} as never, workspaceId: 'brand-1', runId: 'run-9',
    signal: new AbortController().signal, emit: () => {},
    experience: { recordCandidate: vi.fn(recordCandidate) },
    conversations: { createAndAwaitFirstTurn: async () => ({
      conversationId: 'c1', messageId: 'm1',
      text: 'Lesson:\n```anubis-output\n{"text":"Avoid weak hooks"}\n```',
    }), cancel: async () => {} },
  }
}

it('writes a lesson, outputs text, and persists an experience memory', async () => {
  const rec = vi.fn(() => ({ id: 'mem-1' }))
  const out = await lessonWriterExecutor.run(
    { nodeId: 'lw', config: { profileId: 'claude-research', lessonType: 'mistake' },
      upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'weak hook' } }, downstream: [] },
    ctx(rec) as never,
  ) as { kind: string; text: string; memoryId: string }
  expect(out.kind).toBe('lesson')
  expect(out.text).toContain('Avoid weak hooks')
  expect(out.memoryId).toBe('mem-1')
  expect(rec).toHaveBeenCalledWith(expect.objectContaining({
    type: 'mistake', workspaceId: 'brand-1', sourceRunId: 'run-9',
  }))
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run packages/workflow-runtime/tests/executors/lesson-writer.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `packages/workflow-runtime/src/executors/lesson-writer.ts`

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'
import { parseEnvelope } from './_envelope.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  prompt: z.string().optional(),
  lessonType: z.enum(['mistake', 'lesson']),
  titleTemplate: z.string().optional(),
})
export type LessonWriterConfig = z.infer<typeof ConfigSchema>

const DEFAULT_PROMPTS: Record<'mistake' | 'lesson', string> = {
  mistake: 'The reviewed content was REJECTED. Write a concise lesson capturing the mistake and the rule to avoid it next time. Put the lesson in the `text` field.',
  lesson:  'The reviewed content was APPROVED. Write a concise lesson capturing WHAT made this content work, as a reusable rule. Put the lesson in the `text` field.',
}

export const lessonWriterExecutor: Executor<LessonWriterConfig> = {
  type: 'lessonWriter',
  validateConfig(raw) { return ConfigSchema.parse(raw) },
  async run(input, ctx) {
    const contextBlocks = Object.entries(input.upstream)
      .map(([src, v]) => `<context source="${src}">\n${JSON.stringify(v, null, 2)}\n</context>`)
      .join('\n')
    const prompt = input.config.prompt ?? DEFAULT_PROMPTS[input.config.lessonType]
    const content = [
      contextBlocks,
      'End with EXACTLY one ```anubis-output``` block: { "text": "the lesson" }.',
      prompt,
    ].filter(Boolean).join('\n\n')

    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title: input.config.titleTemplate ?? `Lesson · ${input.nodeId}`,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
    })
    const env = parseEnvelope(result.text)
    const lessonText = env.text || result.text

    const mem = ctx.experience.recordCandidate({
      type: input.config.lessonType,
      title: lessonText.slice(0, 80),
      problem: lessonText,
      correction: lessonText,
      severity: 'medium',
      workspaceId: ctx.workspaceId,
      platform: null,
      sourceRunId: ctx.runId,
    })

    return { kind: 'lesson', text: lessonText, memoryId: mem.id, conversationId: result.conversationId }
  },
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm vitest run packages/workflow-runtime/tests/executors/lesson-writer.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/lesson-writer.ts packages/workflow-runtime/tests/executors/lesson-writer.test.ts
git commit -m "feat(workflow): lessonWriter executor (write + persist to anubis-core)"
```

---

## Task 7: Register executors + rebuild runtime

**Files:**
- Modify: `packages/workflow-runtime/src/executors/index.ts`

- [ ] **Step 1: Implement** — add imports + registry entries + re-exports in `index.ts`:

```ts
import { humanApprovalExecutor } from './human-approval.js'
import { lessonWriterExecutor }  from './lesson-writer.js'
// ...in executorRegistry:
  humanApproval: humanApprovalExecutor as Executor<unknown>,
  lessonWriter:  lessonWriterExecutor as Executor<unknown>,
// ...add both to the bottom `export { ... }` block.
```

- [ ] **Step 2: Build + full test** — `pnpm --filter @anubis/workflow-runtime build && pnpm --filter @anubis/workflow-runtime test` → all green.

- [ ] **Step 3: Commit**

```bash
git add packages/workflow-runtime/src/executors/index.ts
git commit -m "feat(workflow): register humanApproval + lessonWriter executors"
```

---

## Task 8: Migration 017 — widen run/step status enums

> Run history is ephemeral local data. This migration **drops and recreates** the run tables with widened CHECK constraints (SQLite cannot alter a CHECK). Existing run logs are discarded; workflow definitions are untouched.

**Files:**
- Create: `packages/conversation/src/db/migrations/017_workflow_runs_pause.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Test: `packages/conversation/tests/db/migrations-017.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { runMigrations } from '../../src/db/migrate.js'

it('migration 017 allows awaiting_approval / rejected / awaiting', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db as never, MIGRATIONS)
  // create a workflow + a run with the new statuses
  db.prepare(`INSERT INTO workflows (id,name,draft_graph,draft_updated_at,created_at,updated_at,workspace_id)
              VALUES ('w','n','{}',0,0,0,'default-workspace')`).run()
  expect(() => db.prepare(`INSERT INTO workflow_runs (id,workflow_id,status,graph_snapshot,started_at)
              VALUES ('r','w','awaiting_approval','{}',0)`).run()).not.toThrow()
  db.prepare(`UPDATE workflow_runs SET status='rejected' WHERE id='r'`).run()
  expect(() => db.prepare(`INSERT INTO workflow_run_steps (id,run_id,node_id,status,iteration)
              VALUES ('s','r','gate','awaiting',1)`).run()).not.toThrow()
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run packages/conversation/tests/db/migrations-017.test.ts` → FAIL (status CHECK / iteration column).

- [ ] **Step 3: Write the migration** — `017_workflow_runs_pause.sql`

```sql
-- Widen workflow run/step status enums for the pause/branch/loop engine.
-- Run history is ephemeral local data; rebuild rather than preserve.
DROP TABLE IF EXISTS workflow_run_steps;
DROP TABLE IF EXISTS workflow_runs;

CREATE TABLE workflow_runs (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN
                    ('pending','running','awaiting_approval','succeeded','failed','rejected','cancelled')),
  graph_snapshot  TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  error           TEXT
);
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);

CREATE TABLE workflow_run_steps (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN
                 ('pending','running','awaiting','succeeded','failed','skipped')),
  iteration    INTEGER NOT NULL DEFAULT 0,
  started_at   INTEGER,
  finished_at  INTEGER,
  output       TEXT,
  error        TEXT
);
CREATE INDEX idx_workflow_run_steps_run ON workflow_run_steps(run_id);
```

- [ ] **Step 4: Register it** — in `migrations/index.ts`, add after the `load(16, …)` line:

```ts
  load(17, '017_workflow_runs_pause.sql'),
```

- [ ] **Step 5: Run, expect PASS** — `pnpm vitest run packages/conversation/tests/db/migrations-017.test.ts` → PASS.

- [ ] **Step 6: Mirror the enum in the seed scripts (optional but keeps fresh-DB seeding valid)** — in `scripts/create-test-workflow.mjs` and `scripts/create-content-pipeline-workflow.mjs`, the inline migration-004 `CHECK` lists — update both CHECK clauses to the widened sets above. (Only affects DBs created from scratch by the seed script.)

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/migrations/017_workflow_runs_pause.sql packages/conversation/src/db/migrations/index.ts packages/conversation/tests/db/migrations-017.test.ts scripts/create-test-workflow.mjs scripts/create-content-pipeline-workflow.mjs
git commit -m "feat(db): migration 017 — awaiting_approval/rejected/awaiting + step iteration"
```

---

## Task 9: WorkflowRunManager — approvals, experience, workspaceId, new events/statuses

**Files:**
- Modify: `packages/backend/src/workflow-run-manager.ts`
- Test: `packages/backend/tests/workflow-approval.test.ts` (create)

- [ ] **Step 1: Write the failing test** (drives the parking API + decision resolution)

```ts
import { describe, it, expect } from 'vitest'
import { WorkflowRunManager } from '../src/workflow-run-manager.js'
// Use the same in-memory stack helper the existing workflow.test.ts uses.
import { makeTestStack } from './helpers/test-stack.js' // (reuse/ad/ create per existing pattern)

it('parks an approval and resolves it via decide()', async () => {
  const { stack, dataDir } = await makeTestStack()
  // seed a workflow whose published graph is: humanApproval -> markdownDisplay(approved)
  // (build the graph inline; publish it)
  const mgr = new WorkflowRunManager(stack, dataDir)
  // ...start the run, wait for a node-awaiting event, then:
  // mgr.decide(runId, { nodeId: 'gate', decision: 'approved' })
  // assert the run finishes 'succeeded'
})
```

> The existing `packages/backend/tests/workflow.test.ts` already constructs a stack + run manager; mirror its setup (`makeTestStack`/inline). Keep this test focused on: (a) `awaiting_approval` status while parked, (b) `decide()` resolves, (c) abort rejects the parked promise.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** In `workflow-run-manager.ts`:

a) Track pending approvals on the `ActiveRun`:

```ts
interface ActiveRun {
  runId: string
  controller: AbortController
  listeners: Set<Listener>
  buffered: RunEvent[]
  finished: boolean
  pendingApprovals: Map<string, { resolve: (d: { decision: 'approved' | 'rejected'; notes?: string }) => void; reject: (e: Error) => void }>
}
```
(initialise `pendingApprovals: new Map()` where the run is created.)

b) Add a `decide` method:

```ts
  decide(runId: string, input: { nodeId: string; decision: 'approved' | 'rejected'; notes?: string }): boolean {
    const active = this.active.get(runId)
    const pending = active?.pendingApprovals.get(input.nodeId)
    if (!active || !pending) return false
    active.pendingApprovals.delete(input.nodeId)
    pending.resolve({ decision: input.decision, notes: input.notes })
    return true
  }
```

c) In `runAndPersist`, add `workspaceId` (read from the workflow row) and the new ctx deps. Resolve the workflow's workspaceId:

```ts
    const workflow = this.stack.workflows.get(/* workflowId — thread it into runAndPersist via active or a field */)
    const workspaceId = workflow?.workspaceId ?? 'default-workspace'
```
(Thread `workflowId` into `runAndPersist`/`ActiveRun` so it's available here.)

d) Add to the `ctx` object:

```ts
        approvals: {
          waitFor: (nodeId, opts) => new Promise((resolve, reject) => {
            active.pendingApprovals.set(nodeId, { resolve, reject })
            emit({ kind: 'node-awaiting', nodeId, at: Date.now(), title: opts.title, instructions: opts.instructions })
            active.controller.signal.addEventListener('abort', () => {
              active.pendingApprovals.delete(nodeId)
              reject(new Error('run cancelled'))
            }, { once: true })
          }),
        },
        experience: {
          recordCandidate: (i) => this.stack.experience.recordCandidate(i),
        },
        workspaceId,
```

e) In `wrappedEmit`, handle the new event kinds for persistence: on `node-awaiting`, upsert the step as `awaiting`; on `node-decided`, no-op (or record notes). Emit a `node-decided` event from `decide()` too (push through `emit`). Update the run status to `awaiting_approval` when any approval is pending and back to `running` after a decision (track via a counter or recompute on each event).

f) Map the runtime `RunStatus` ('rejected') through to `setRunStatus` (already string-typed; ensure the repo/migration accept it — done in Task 8).

- [ ] **Step 4: Run, expect PASS.** Then rebuild runtime if needed and run `pnpm vitest run packages/backend/tests/workflow-approval.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/workflow-run-manager.ts packages/backend/tests/workflow-approval.test.ts
git commit -m "feat(backend): park human-approval decisions in the run manager"
```

---

## Task 10: Decision endpoint

**Files:**
- Modify: `packages/backend/src/workflow.ts`
- Test: `packages/backend/tests/workflow-approval.test.ts` (extend — HTTP path)

- [ ] **Step 1: Write the failing test** — add a case that POSTs `/workflows/runs/:runId/decisions` and asserts 200 + run resumes; 404 when no pending decision.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in `workflow.ts`, add:

```ts
const DecisionBody = z.object({
  nodeId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
})

workflowRoutes.post('/runs/:runId/decisions', async (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  const body = DecisionBody.parse(await c.req.json())
  const ok = mgr.decide(c.req.param('runId'), body)
  if (!ok) return c.json({ error: 'no_pending_decision' }, 404)
  return c.json({ ok: true })
})
```

- [ ] **Step 4: Run, expect PASS** — `pnpm vitest run packages/backend/tests/workflow-approval.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/workflow.ts packages/backend/tests/workflow-approval.test.ts
git commit -m "feat(backend): POST /workflows/runs/:id/decisions endpoint"
```

---

## Task 11: Frontend api + store — statuses, events, decide()

**Files:**
- Modify: `packages/frontend/src/api/workflows.ts`
- Modify: `packages/frontend/src/components/workflow-editor/editor-store.ts`

- [ ] **Step 1: Extend the SSE event union + add `decide`** in `api/workflows.ts`:

```ts
export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }
  | { kind: 'node-awaiting';  nodeId: string; at: number; title?: string; instructions?: string }
  | { kind: 'node-decided';   nodeId: string; at: number; decision: 'approved' | 'rejected'; notes?: string }
  | { kind: 'run-started';    runId: string; at: number }
  | { kind: 'run-finished';   runId: string; at: number; status: string; error?: string }
```
Add to `workflowsApi`:
```ts
  decide: (runId: string, body: { nodeId: string; decision: 'approved' | 'rejected'; notes?: string }) =>
            jsonFetch<{ ok: true }>(`/workflows/runs/${runId}/decisions`, { method: 'POST', body: JSON.stringify(body) }),
```

- [ ] **Step 2: Extend the store** in `editor-store.ts`:
  - `StepState.status` add `'awaiting'`; `ActiveRun.status` add `'awaiting_approval' | 'rejected'`.
  - Add to `StepState` an optional `{ title?: string; instructions?: string }`.
  - In `applyRunEvent`, handle:
    ```ts
    } else if (event.kind === 'node-awaiting') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'awaiting', title: event.title, instructions: event.instructions }
    } else if (event.kind === 'node-decided') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'running' }
    }
    ```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/api/workflows.ts packages/frontend/src/components/workflow-editor/editor-store.ts
git commit -m "feat(frontend): approval events + decide() in api/store"
```

---

## Task 12: Frontend nodes — humanApproval, lessonWriter, palette, configs

**Files:**
- Create: `executable-nodes/human-approval.tsx`, `executable-nodes/lesson-writer.tsx`
- Create: `inspector/config/human-approval-config.tsx`, `inspector/config/lesson-writer-config.tsx`
- Modify: `executable-nodes/index.ts`, `inspector-panel.tsx`, `components/workflow/handles.tsx`

- [ ] **Step 1: Two-handle support** — in `handles.tsx`, add an approval variant rendering two source handles:

```tsx
export function ApprovalHandles() {
  return (
    <>
      <NodeHandle type='target' position={Position.Left}  id={WORKFLOW_TARGET_HANDLE} label='IN' />
      <NodeHandle type='source' position={Position.Right} id='approved' label='OK' />
      <Handle id='rejected' type='source' position={Position.Bottom}
        className={HANDLE_CLASS} style={{ background: 'var(--destructive)' }}>
        <span className='pointer-events-none select-none leading-none'>NO</span>
      </Handle>
    </>
  )
}
```
(Export `NodeHandle`/`HANDLE_CLASS` or inline. `sourceHandle` ids MUST be `'approved'`/`'rejected'` to match the runtime branch logic.)

- [ ] **Step 2: humanApproval node card** — `executable-nodes/human-approval.tsx`: a `NodeShell` with `<ApprovalHandles/>` instead of default handles (render `disableMotion`/custom — `NodeShell` accepts `handles` only as a variant, so render the card without `NodeShell`'s handles or extend `NodeShell` to accept a `handlesNode` prop). Show title/instructions and, when `useNodeRunStatus(id) === 'awaiting'`, render **Approve** / **Reject** buttons calling `workflowsApi.decide(activeRun.runId, { nodeId: id, decision })`.

```tsx
import { memo, useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { Button } from '@/components/ui/button'
import { workflowsApi } from '@/api/workflows'
import { useEditorStore } from '../editor-store'
import { useNodeRunStatus } from './_use-run-status'

export interface HumanApprovalNodeData { title?: string; instructions?: string; maxIterations?: number }

export const HumanApprovalExecutableNode = memo(function HumanApprovalExecutableNode(
  { id, data }: { id: string; data: HumanApprovalNodeData },
) {
  const status = useNodeRunStatus(id)
  const runId = useEditorStore((s) => s.activeRun?.runId)
  const [busy, setBusy] = useState(false)
  const decide = async (decision: 'approved' | 'rejected') => {
    if (!runId) return
    setBusy(true)
    try { await workflowsApi.decide(runId, { nodeId: id, decision }) } finally { setBusy(false) }
  }
  return (
    <NodeShell icon={ShieldQuestion} title={data.title ?? 'Human Review'}
      subtitle={data.instructions ?? 'Approve or reject the content'} accent={ACCENT_GRADIENTS.review}
      runStatus={status} handles='both'>
      {status === 'awaiting' ? (
        <div className='flex gap-2'>
          <Button size='sm' disabled={busy} onClick={() => decide('approved')}>Approve</Button>
          <Button size='sm' variant='destructive' disabled={busy} onClick={() => decide('rejected')}>Reject</Button>
        </div>
      ) : <p className='text-xs text-muted-foreground'>Pauses the run for your decision.</p>}
    </NodeShell>
  )
})
```

> If wiring the two custom handles via `NodeShell` is awkward, extend `NodeShell` with an optional `handlesNode?: ReactNode` that, when present, replaces `<NodeDirectionalHandles/>`. Keep that change minimal and covered by the existing node render.

- [ ] **Step 3: lessonWriter node card** — `executable-nodes/lesson-writer.tsx`: like `ai-agent-conversation.tsx` but icon `GraduationCap`, subtitle shows `lessonType`. Default handles `'both'`.

- [ ] **Step 4: Inspector configs** — `human-approval-config.tsx` (title, instructions, maxIterations number input) and `lesson-writer-config.tsx` (profile picker like `ai-agent-conversation-config.tsx` + `lessonType` select + optional prompt).

- [ ] **Step 5: Register** — in `executable-nodes/index.ts`: add to `executableNodeTypes` (`humanApproval`, `lessonWriter`) and `NODE_PALETTE` (`{ type:'humanApproval', label:'Human Review', category:'agent' }`, `{ type:'lessonWriter', label:'Lesson Writer', category:'agent' }`). In `inspector-panel.tsx`: add both to `CONFIG_FORMS`.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/components/workflow-editor/executable-nodes/human-approval.tsx \
        packages/frontend/src/components/workflow-editor/executable-nodes/lesson-writer.tsx \
        packages/frontend/src/components/workflow-editor/inspector/config/human-approval-config.tsx \
        packages/frontend/src/components/workflow-editor/inspector/config/lesson-writer-config.tsx \
        packages/frontend/src/components/workflow-editor/executable-nodes/index.ts \
        packages/frontend/src/components/workflow-editor/inspector-panel.tsx \
        packages/frontend/src/components/workflow/handles.tsx
git commit -m "feat(frontend): humanApproval + lessonWriter nodes, configs, palette, approve/reject UI"
```

---

## Task 13: Loop edges in the builder

Allow a backward connection to be created as a loop edge instead of being refused.

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/editor-canvas.tsx`

- [ ] **Step 1: Implement** — change `onConnect` so a would-be cycle becomes a loop edge:

```ts
  const onConnect: OnConnect = useCallback((conn) => {
    const loop = wouldCreateCycle(nodes, edges, conn)
    pushHistory()
    setEdges(addEdge({
      ...conn,
      id: `e-${Date.now()}`,
      type: 'separated',
      ...(loop ? { data: { loop: true }, animated: true } : {}),
    }, edges))
  }, [nodes, edges, setEdges, pushHistory])
```
(Keep the `source === target` self-loop guard: early-return inside `wouldCreateCycle` already returns true for that; if you want to forbid self-loops, special-case `conn.source === conn.target` to `return`.)

- [ ] **Step 2: Manual check** — `pnpm --filter @anubis/frontend typecheck`. (Visual verification happens in Task 14.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/editor-canvas.tsx
git commit -m "feat(frontend): backward connections become loop edges"
```

---

## Task 14: End-to-end — extend the seed workflow & run it

**Files:**
- Modify: `scripts/create-content-pipeline-workflow.mjs` (add approval + lesson + loop nodes/edges)

- [ ] **Step 1: Extend the seeded graph** — after `ai-review`/`md-final`, add:
  - `human-approval` (`type:'humanApproval'`, `data:{ title:'Human Review', maxIterations:3 }`), fed by `ai-review`.
  - `md-final` fed by `human-approval` via `sourceHandle:'approved'`.
  - `lesson-approved` (`type:'lessonWriter'`, `data:{ profileId:'claude-research', lessonType:'lesson' }`) fed by `human-approval` `approved`.
  - `lesson-rejected` (`type:'lessonWriter'`, `data:{ profileId:'claude-research', lessonType:'mistake' }`) fed by `human-approval` `rejected`.
  - loop edge `lesson-rejected → ai-improve` with `data:{ loop:true }`.

- [ ] **Step 2: Build everything in order**

```bash
pnpm --filter @anubis/workflow-runtime build
pnpm --filter @anubis/backend build
node scripts/create-content-pipeline-workflow.mjs
```

- [ ] **Step 3: Validate the stored graph** (reuse the validation snippet from the prior session):

```bash
node --input-type=module -e "import Database from 'better-sqlite3'; import { WorkflowGraphSchema, executorRegistry } from './packages/workflow-runtime/dist/index.js'; const db=new Database(process.env.APPDATA + '/Electron/anubis/anubis.db',{readonly:true}); const wf=db.prepare('SELECT published_graph g FROM workflows WHERE name LIKE ?').get('Real:%'); const gr=WorkflowGraphSchema.parse(JSON.parse(wf.g)); for(const n of gr.nodes){ executorRegistry[n.type].validateConfig(n.data); } console.log('OK', gr.nodes.length, 'nodes'); db.close();"
```
Expected: `OK <n> nodes`.

- [ ] **Step 4: Run in the app** — launch the app, open the workflow, Run published; verify: it pauses at Human Review (node turns `awaiting`, Approve/Reject buttons appear); Reject → lesson writes + loops back to Improve (bounded to 3); Approve → `md-final` + approved lesson; rejected-thrice ends `rejected`.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-content-pipeline-workflow.mjs
git commit -m "test(workflow): seed end-to-end approval + lesson + loop pipeline"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** §4.1 edges → T1; §4.2 scheduler → T2; §4.3 loop → T3; §4.4 pause/ctx → T4/T9/T10; §4.5 nodes → T1/T5/T6/T12; §5 migration → T8; §6 api/events → T4/T10/T11; §7 frontend → T11/T12/T13; §8 testing → woven; end-to-end → T14.
- **Type names to keep consistent:** edge fields `sourceHandle` / `data.loop`; approval output `{ kind:'approval', decision, notes, reviewed }`; lesson output `{ kind:'lesson', text, memoryId }`; ctx `approvals.waitFor`, `experience.recordCandidate`, `workspaceId`; events `node-awaiting` / `node-decided`; handle ids exactly `'approved'` / `'rejected'`; statuses `awaiting_approval` / `rejected` (run) and `awaiting` (step).
- **Watch:** Task 2's scheduler MUST keep the existing 72 runtime tests green. Task 3's loop-body reset is the highest-risk piece — if the two loop tests pass and existing tests stay green, it's sound. Rebuild `@anubis/workflow-runtime` before backend tests (vitest resolves `@anubis/*` to `dist`).
