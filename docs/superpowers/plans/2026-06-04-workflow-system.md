# Workflow System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 workflow system end-to-end: SQLite storage, a `workflow-runtime` package with engine + six executors, backend REST + SSE routes, and a Tier 3 frontend editor that authors draft/published workflows and runs them with live per-node status.

**Architecture:** New `packages/workflow-runtime` package owns the executor interface, graph validation, and the topological DAG runner. The existing `packages/conversation` SQLite database gains three tables (`workflows`, `workflow_runs`, `workflow_run_steps`) via migration `004`. Backend module `packages/backend/src/workflow.ts` exposes REST + SSE; the runner lives in-process in the backend child. Frontend gets a list page, a Tier 3 editor (palette + canvas + multi-select + undo/redo + clipboard + keymap + autosave), and a dual-mode right-side inspector (config form OR live run viewer). The existing `components/workflow/` visual library is reused as the rendering substrate.

**Tech Stack:** TypeScript ESM, Zod (validation), better-sqlite3 (existing), Hono (backend), Node SSE, React 19, `@xyflow/react` v12, Tailwind v4 + shadcn UI, `motion/react`, `zustand`, vitest.

**Spec:** [docs/superpowers/specs/2026-06-04-workflow-system-design.md](../specs/2026-06-04-workflow-system-design.md)

**Pre-flight:** start a worktree (`/worktree` or `EnterWorktree` if available). Baseline tests should pass before Task 1.

---

## File Structure

Created (relative to repo root):

```
packages/workflow-runtime/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── graph.ts
│   ├── context.ts
│   ├── runner.ts
│   └── executors/
│       ├── index.ts
│       ├── table.ts
│       ├── transformer-brief.ts
│       ├── ai-agent.ts
│       ├── instagram-post.ts
│       ├── transformer-media.ts
│       └── ocr-extractor.ts
└── tests/
    ├── graph.test.ts
    ├── runner.test.ts
    └── executors/
        ├── table.test.ts
        ├── transformer-brief.test.ts
        ├── ai-agent.test.ts
        ├── instagram-post.test.ts
        ├── transformer-media.test.ts
        └── ocr-extractor.test.ts

packages/conversation/src/db/
├── migrations/004_workflows.sql                       # new
└── repositories/
    ├── workflows-repo.ts                              # new
    └── workflow-runs-repo.ts                          # new (handles runs + steps)

packages/backend/src/
├── workflow.ts                                        # new (REST + SSE routes)
└── workflow-run-manager.ts                            # new (per-run lifecycle, SSE channels)

packages/backend/tests/
└── workflow.test.ts                                   # new (integration over REST + SSE)

packages/frontend/src/
├── api/workflows.ts                                   # new (REST client + EventSource helper)
├── pages/
│   ├── workflows.tsx                                  # new (list page)
│   └── workflow-editor.tsx                            # new (editor page)
├── components/workflow-editor/                        # new module
│   ├── editor-store.ts
│   ├── editor-canvas.tsx
│   ├── node-palette.tsx
│   ├── inspector-panel.tsx
│   ├── keymap.ts
│   ├── autosave.ts
│   ├── history/use-editor-history.ts
│   ├── clipboard/use-editor-clipboard.ts
│   ├── executable-nodes/
│   │   ├── ai-agent.tsx
│   │   ├── instagram-post.tsx
│   │   ├── transformer-media.tsx
│   │   ├── transformer-brief.tsx
│   │   ├── ocr-extractor.tsx
│   │   └── table.tsx
│   └── inspector/
│       ├── run-viewer.tsx
│       └── config/
│           ├── ai-agent-config.tsx
│           ├── instagram-post-config.tsx
│           ├── transformer-media-config.tsx
│           ├── transformer-brief-config.tsx
│           ├── ocr-extractor-config.tsx
│           └── table-config.tsx
└── components/workflow-editor/tests would live under packages/frontend/tests/workflow-editor/
    ├── use-editor-history.test.ts                     # new
    └── use-editor-clipboard.test.ts                   # new
```

Modified:

```
packages/conversation/src/db/migrations/index.ts       # register migration 004
packages/conversation/src/index.ts                     # add workflows/runs repos to ConversationStack
packages/backend/src/app.ts                            # mount workflow routes
packages/frontend/src/lib/navigation.tsx               # add 'workflows' + 'workflow-editor' to Route union
packages/frontend/src/components/dashboard/data.ts     # replace 'workflow-demo' nav entry with 'workflows'
packages/frontend/src/components/dashboard/sidebar.tsx # add 'workflows' + 'workflow-editor' to itemRoute switch
packages/frontend/src/components/dashboard/index.tsx   # add page imports + BREADCRUMBS + switch cases
```

---

## Task 1: Migration 004 — workflows tables

**Files:**
- Create: `packages/conversation/src/db/migrations/004_workflows.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Test: starts via existing migration runner on next backend boot

- [ ] **Step 1: Write the migration SQL**

Create `packages/conversation/src/db/migrations/004_workflows.sql`:

```sql
CREATE TABLE workflows (
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

CREATE TABLE workflow_runs (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
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
  status       TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  started_at   INTEGER,
  finished_at  INTEGER,
  output       TEXT,
  error        TEXT
);
CREATE INDEX idx_workflow_run_steps_run ON workflow_run_steps(run_id);
```

- [ ] **Step 2: Register migration 004 in the list**

Edit `packages/conversation/src/db/migrations/index.ts`, append the entry:

```ts
export const MIGRATIONS: Migration[] = [
  load(1, '001_init.sql'),
  load(2, '002_competitors.sql'),
  load(3, '003_captured_posts.sql'),
  load(4, '004_workflows.sql'),
]
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `pnpm --filter @anubis/conversation typecheck && pnpm --filter @anubis/conversation test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/db/migrations/004_workflows.sql \
        packages/conversation/src/db/migrations/index.ts
git commit -m "feat(workflow): add migration 004 — workflows, runs, run_steps tables"
```

---

## Task 2: WorkflowsRepo — CRUD on the workflows table

**Files:**
- Create: `packages/conversation/src/db/repositories/workflows-repo.ts`

- [ ] **Step 1: Create the repository file**

```ts
// packages/conversation/src/db/repositories/workflows-repo.ts
import type { Db } from '../client.js'

export interface WorkflowRow {
  id: string
  name: string
  description: string | null
  draft_graph: string
  published_graph: string | null
  draft_updated_at: number
  published_at: number | null
  created_at: number
  updated_at: number
}

export interface Workflow {
  id: string
  name: string
  description?: string
  draftGraph: string
  publishedGraph?: string
  draftUpdatedAt: number
  publishedAt?: number
  createdAt: number
  updatedAt: number
}

function toWorkflow(r: WorkflowRow): Workflow {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    draftGraph: r.draft_graph,
    publishedGraph: r.published_graph ?? undefined,
    draftUpdatedAt: r.draft_updated_at,
    publishedAt: r.published_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] })

export class WorkflowsRepo {
  constructor(private db: Db) {}

  create(input: { id: string; name: string; description?: string; now: number }): Workflow {
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, description, draft_graph, published_graph,
          draft_updated_at, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(input.id, input.name, input.description ?? null, EMPTY_GRAPH, input.now, input.now, input.now)
    return this.getOrThrow(input.id)
  }

  list(): Workflow[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflows ORDER BY updated_at DESC`)
      .all() as WorkflowRow[]
    return rows.map(toWorkflow)
  }

  get(id: string): Workflow | null {
    const row = this.db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as WorkflowRow | undefined
    return row ? toWorkflow(row) : null
  }

  getOrThrow(id: string): Workflow {
    const w = this.get(id)
    if (!w) throw new Error(`workflow ${id} not found`)
    return w
  }

  updateMeta(id: string, patch: { name?: string; description?: string | null }, now: number): Workflow {
    const current = this.getOrThrow(id)
    this.db
      .prepare(`UPDATE workflows SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description ?? null : patch.description,
        now,
        id,
      )
    return this.getOrThrow(id)
  }

  writeDraft(id: string, draftGraph: string, now: number): Workflow {
    this.db
      .prepare(`UPDATE workflows SET draft_graph = ?, draft_updated_at = ?, updated_at = ? WHERE id = ?`)
      .run(draftGraph, now, now, id)
    return this.getOrThrow(id)
  }

  publish(id: string, now: number): Workflow {
    const current = this.getOrThrow(id)
    this.db
      .prepare(`UPDATE workflows SET published_graph = ?, published_at = ?, updated_at = ? WHERE id = ?`)
      .run(current.draftGraph, now, now, id)
    return this.getOrThrow(id)
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/conversation/src/db/repositories/workflows-repo.ts
git commit -m "feat(workflow): add WorkflowsRepo with CRUD + draft/publish methods"
```

---

## Task 3: WorkflowRunsRepo — runs and run-steps

**Files:**
- Create: `packages/conversation/src/db/repositories/workflow-runs-repo.ts`

- [ ] **Step 1: Create the repository file**

```ts
// packages/conversation/src/db/repositories/workflow-runs-repo.ts
import type { Db } from '../client.js'

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface WorkflowRun {
  id: string
  workflowId: string
  status: RunStatus
  graphSnapshot: string
  startedAt: number
  finishedAt?: number
  error?: string
}

export interface WorkflowRunStep {
  id: string
  runId: string
  nodeId: string
  status: StepStatus
  startedAt?: number
  finishedAt?: number
  output?: string
  error?: string
}

interface RunRow {
  id: string; workflow_id: string; status: RunStatus; graph_snapshot: string
  started_at: number; finished_at: number | null; error: string | null
}

interface StepRow {
  id: string; run_id: string; node_id: string; status: StepStatus
  started_at: number | null; finished_at: number | null
  output: string | null; error: string | null
}

function toRun(r: RunRow): WorkflowRun {
  return {
    id: r.id, workflowId: r.workflow_id, status: r.status, graphSnapshot: r.graph_snapshot,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    error: r.error ?? undefined,
  }
}

function toStep(r: StepRow): WorkflowRunStep {
  return {
    id: r.id, runId: r.run_id, nodeId: r.node_id, status: r.status,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    output: r.output ?? undefined,
    error: r.error ?? undefined,
  }
}

export class WorkflowRunsRepo {
  constructor(private db: Db) {}

  createRun(input: { id: string; workflowId: string; graphSnapshot: string; now: number }): WorkflowRun {
    this.db
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_id, status, graph_snapshot, started_at, finished_at, error)
         VALUES (?, ?, 'running', ?, ?, NULL, NULL)`,
      )
      .run(input.id, input.workflowId, input.graphSnapshot, input.now)
    return this.getRunOrThrow(input.id)
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as RunRow | undefined
    return row ? toRun(row) : null
  }

  getRunOrThrow(id: string): WorkflowRun {
    const r = this.getRun(id)
    if (!r) throw new Error(`run ${id} not found`)
    return r
  }

  listRunsForWorkflow(workflowId: string, limit = 50): WorkflowRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(workflowId, limit) as RunRow[]
    return rows.map(toRun)
  }

  setRunStatus(id: string, status: RunStatus, finishedAt: number | null, error: string | null): void {
    this.db
      .prepare(`UPDATE workflow_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`)
      .run(status, finishedAt, error, id)
  }

  deleteRun(id: string): void {
    this.db.prepare(`DELETE FROM workflow_runs WHERE id = ?`).run(id)
  }

  upsertStep(step: {
    id: string; runId: string; nodeId: string; status: StepStatus
    startedAt?: number; finishedAt?: number; output?: string; error?: string
  }): WorkflowRunStep {
    this.db
      .prepare(
        `INSERT INTO workflow_run_steps (id, run_id, node_id, status, started_at, finished_at, output, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           output = excluded.output,
           error = excluded.error`,
      )
      .run(
        step.id, step.runId, step.nodeId, step.status,
        step.startedAt ?? null, step.finishedAt ?? null,
        step.output ?? null, step.error ?? null,
      )
    return this.getStepOrThrow(step.id)
  }

  listSteps(runId: string): WorkflowRunStep[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY started_at ASC`)
      .all(runId) as StepRow[]
    return rows.map(toStep)
  }

  getStepOrThrow(id: string): WorkflowRunStep {
    const row = this.db.prepare(`SELECT * FROM workflow_run_steps WHERE id = ?`).get(id) as StepRow | undefined
    if (!row) throw new Error(`step ${id} not found`)
    return toStep(row)
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @anubis/conversation typecheck
git add packages/conversation/src/db/repositories/workflow-runs-repo.ts
git commit -m "feat(workflow): add WorkflowRunsRepo (runs + steps)"
```

---

## Task 4: Add repos to the ConversationStack

**Files:**
- Modify: `packages/conversation/src/index.ts`

- [ ] **Step 1: Import the repos and add to the stack**

In `packages/conversation/src/index.ts`, add imports after the existing repository imports (around line 16):

```ts
import { WorkflowsRepo } from './db/repositories/workflows-repo.js'
import { WorkflowRunsRepo } from './db/repositories/workflow-runs-repo.js'
```

Add fields to the `ConversationStack` interface (around line 33):

```ts
export interface ConversationStack {
  conversation: ConversationService
  profiles: ProfileService
  competitors: CompetitorsService
  capturedPosts: CapturedPostsRepo
  workflows: WorkflowsRepo
  workflowRuns: WorkflowRunsRepo
  appConfig: AppConfigService
  // ...existing fields kept as-is
  skills: SkillLoader
  sse: SseBroadcaster
  cron: CronService
  taskManager: TaskManager
  aiAgent: AiAgentService
  agentHomeRoot: string
  shutdown(): Promise<void>
}
```

Wire them inside `createConversationService`, right after the existing repo instantiations:

```ts
const workflowsRepo = new WorkflowsRepo(db)
const workflowRunsRepo = new WorkflowRunsRepo(db)
```

Add to the returned object:

```ts
return {
  conversation, profiles, competitors, capturedPosts,
  workflows: workflowsRepo,
  workflowRuns: workflowRunsRepo,
  appConfig, skills, sse, cron, taskManager: tm, aiAgent,
  agentHomeRoot,
  async shutdown() { /* ...unchanged */ },
}
```

Add exports at the bottom of the file:

```ts
export type { Workflow } from './db/repositories/workflows-repo.js'
export { WorkflowsRepo } from './db/repositories/workflows-repo.js'
export type { WorkflowRun, WorkflowRunStep, RunStatus, StepStatus } from './db/repositories/workflow-runs-repo.js'
export { WorkflowRunsRepo } from './db/repositories/workflow-runs-repo.js'
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @anubis/conversation typecheck
git add packages/conversation/src/index.ts
git commit -m "feat(workflow): expose Workflows + WorkflowRuns repos on ConversationStack"
```

---

## Task 5: Scaffold the workflow-runtime package

**Files:**
- Create: `packages/workflow-runtime/package.json`
- Create: `packages/workflow-runtime/tsconfig.json`
- Create: `packages/workflow-runtime/src/index.ts`
- Create: `packages/workflow-runtime/vitest.config.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@anubis/workflow-runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "tests"]
}
```

- [ ] **Step 3: src/index.ts skeleton**

```ts
// further exports added in later tasks
export {}
```

- [ ] **Step 4: vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
})
```

- [ ] **Step 5: Install + verify typecheck**

```bash
pnpm install
pnpm --filter @anubis/workflow-runtime typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-runtime/
git commit -m "feat(workflow-runtime): scaffold package"
```

---

## Task 6: Engine types — Executor interface + NodeRunEvent

**Files:**
- Create: `packages/workflow-runtime/src/types.ts`
- Modify: `packages/workflow-runtime/src/index.ts`

- [ ] **Step 1: types.ts**

```ts
// packages/workflow-runtime/src/types.ts
import { z } from 'zod'

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: NodePositionSchema,
  config: z.unknown(),
})

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
})

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
})

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface ExecutorInput<TConfig> {
  nodeId: string
  config: TConfig
  upstream: Record<string, unknown>
}

export interface Executor<TConfig = unknown> {
  type: string
  validateConfig(raw: unknown): TConfig
  run(input: ExecutorInput<TConfig>, ctx: ExecutorContext): Promise<unknown>
}

export interface CapturedPost {
  id: string
  caption?: string
  mediaUrls: string[]
  metrics?: { likes?: number; comments?: number }
  [key: string]: unknown
}

export interface AgentRunRequest {
  profileId: string
  reasoning: 'low' | 'medium' | 'high'
  prompt: string
}

export interface AgentRunResult {
  text: string
}

export interface ExecutorContext {
  agent:   { run: (req: AgentRunRequest) => Promise<AgentRunResult> }
  crawler: { captureProfile: (url: string) => Promise<CapturedPost> }
  ocr:     { extractFromImage: (path: string) => Promise<string> }
  db:      { getCapturedPost: (id: string) => Promise<CapturedPost> }
  fs:      { writeRunArtifact: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string> }
  runId:   string
  signal:  AbortSignal
  emit:    (event: NodeRunEvent) => void
}

export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }

export type RunLifecycleEvent =
  | { kind: 'run-started';  runId: string; at: number }
  | { kind: 'run-finished'; runId: string; at: number; status: RunStatus; error?: string }

export type RunEvent = NodeRunEvent | RunLifecycleEvent
```

- [ ] **Step 2: Re-export from index.ts**

```ts
// packages/workflow-runtime/src/index.ts
export * from './types.js'
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @anubis/workflow-runtime typecheck
git add packages/workflow-runtime/src/types.ts packages/workflow-runtime/src/index.ts
git commit -m "feat(workflow-runtime): add types — Executor, graphs, events"
```

---

## Task 7: TDD graph.ts — validation + topological sort

**Files:**
- Create: `packages/workflow-runtime/tests/graph.test.ts`
- Create: `packages/workflow-runtime/src/graph.ts`
- Modify: `packages/workflow-runtime/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/graph.test.ts
import { describe, it, expect } from 'vitest'
import { topologicalSort, validateGraphStructure } from '../src/graph.js'
import type { WorkflowGraph } from '../src/types.js'

function g(nodes: string[], edges: Array<[string, string]>): WorkflowGraph {
  return {
    nodes: nodes.map((id) => ({ id, type: 'table', position: { x: 0, y: 0 }, config: {} })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t })),
  }
}

describe('topologicalSort', () => {
  it('returns sources first for a linear chain', () => {
    const order = topologicalSort(g(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]))
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('keeps both branches before sink in a diamond', () => {
    const order = topologicalSort(g(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]))
    expect(order[0]).toBe('a')
    expect(order[3]).toBe('d')
    expect(order.slice(1, 3).sort()).toEqual(['b', 'c'])
  })

  it('throws on cycle', () => {
    expect(() => topologicalSort(g(['a', 'b'], [['a', 'b'], ['b', 'a']])))
      .toThrowError(/cycle/i)
  })
})

describe('validateGraphStructure', () => {
  it('rejects edges that reference missing nodes', () => {
    expect(() => validateGraphStructure(g(['a'], [['a', 'b']])))
      .toThrowError(/edge.*references missing node/i)
  })

  it('rejects duplicate node ids', () => {
    const bad: WorkflowGraph = {
      nodes: [
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, config: {} },
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
    }
    expect(() => validateGraphStructure(bad)).toThrowError(/duplicate node/i)
  })

  it('accepts an empty graph', () => {
    expect(() => validateGraphStructure({ nodes: [], edges: [] })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test — should fail with "Cannot find module ../src/graph.js"**

```bash
pnpm --filter @anubis/workflow-runtime test
```
Expected: FAIL.

- [ ] **Step 3: Implement graph.ts**

```ts
// packages/workflow-runtime/src/graph.ts
import type { WorkflowGraph } from './types.js'

export function validateGraphStructure(graph: WorkflowGraph): void {
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new Error(`duplicate node id: ${node.id}`)
    ids.add(node.id)
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) throw new Error(`edge ${edge.id} references missing node: ${edge.source}`)
    if (!ids.has(edge.target)) throw new Error(`edge ${edge.id} references missing node: ${edge.target}`)
  }
}

export function topologicalSort(graph: WorkflowGraph): string[] {
  validateGraphStructure(graph)
  const inDegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }
  const queue: string[] = []
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('graph contains a cycle')
  }
  return order
}

export function incomingEdges(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.target === nodeId).map((e) => e.source)
}
```

- [ ] **Step 4: Run test — should pass**

```bash
pnpm --filter @anubis/workflow-runtime test
```
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export from index.ts**

Append to `packages/workflow-runtime/src/index.ts`:

```ts
export { topologicalSort, validateGraphStructure, incomingEdges } from './graph.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-runtime/src/graph.ts packages/workflow-runtime/tests/graph.test.ts packages/workflow-runtime/src/index.ts
git commit -m "feat(workflow-runtime): add graph validation + topological sort"
```

---

## Task 8: Table executor (simplest — proves the executor interface)

**Files:**
- Create: `packages/workflow-runtime/tests/executors/table.test.ts`
- Create: `packages/workflow-runtime/src/executors/table.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/executors/table.test.ts
import { describe, it, expect } from 'vitest'
import { tableExecutor } from '../../src/executors/table.js'

const stubCtx = {
  agent: { run: async () => ({ text: '' }) },
  crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
  ocr: { extractFromImage: async () => '' },
  db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
  fs: { writeRunArtifact: async () => '' },
  runId: 'r1',
  signal: new AbortController().signal,
  emit: () => {},
} as const

describe('tableExecutor', () => {
  it('passes upstream values through as rows', async () => {
    const out = await tableExecutor.run(
      { nodeId: 'n1', config: {}, upstream: { up1: { a: 1 } } },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'table', rows: [{ a: 1 }] })
  })

  it('falls back to staticData when upstream is empty', async () => {
    const out = await tableExecutor.run(
      { nodeId: 'n1', config: { staticData: [{ a: 1 }, { a: 2 }] }, upstream: {} },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'table', rows: [{ a: 1 }, { a: 2 }] })
  })

  it('returns empty rows when no upstream and no staticData', async () => {
    const out = await tableExecutor.run({ nodeId: 'n1', config: {}, upstream: {} }, stubCtx)
    expect(out).toEqual({ kind: 'table', rows: [] })
  })

  it('rejects invalid config via validateConfig', () => {
    expect(() => tableExecutor.validateConfig({ staticData: 'not-an-array' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test — should fail**

```bash
pnpm --filter @anubis/workflow-runtime test tests/executors/table.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the executor**

```ts
// packages/workflow-runtime/src/executors/table.ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  staticData: z.array(z.record(z.string(), z.unknown())).optional(),
})

export type TableConfig = z.infer<typeof ConfigSchema>

export const tableExecutor: Executor<TableConfig> = {
  type: 'table',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const upstreamValues = Object.values(input.upstream)
    if (upstreamValues.length > 0) return { kind: 'table', rows: upstreamValues }
    return { kind: 'table', rows: input.config.staticData ?? [] }
  },
}
```

- [ ] **Step 4: Run test — should pass**

```bash
pnpm --filter @anubis/workflow-runtime test
```
Expected: PASS (4 tests + 4 from graph).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/table.ts packages/workflow-runtime/tests/executors/table.test.ts
git commit -m "feat(workflow-runtime): add table executor (passthrough + static rows)"
```

---

## Task 9: Transformer Brief executor — JSON template substitution

**Files:**
- Create: `packages/workflow-runtime/tests/executors/transformer-brief.test.ts`
- Create: `packages/workflow-runtime/src/executors/transformer-brief.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/executors/transformer-brief.test.ts
import { describe, it, expect } from 'vitest'
import { transformerBriefExecutor } from '../../src/executors/transformer-brief.js'

const stubCtx = {
  agent: { run: async () => ({ text: '' }) },
  crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
  ocr: { extractFromImage: async () => '' },
  db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
  fs: { writeRunArtifact: async () => '' },
  runId: 'r1',
  signal: new AbortController().signal,
  emit: () => {},
} as const

describe('transformerBriefExecutor', () => {
  it('substitutes simple path tokens', async () => {
    const out = await transformerBriefExecutor.run(
      {
        nodeId: 'n1',
        config: { jsonTemplate: '{"topic":"{{n2.text}}"}' },
        upstream: { n2: { text: 'hello world' } },
      },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'json', value: { topic: 'hello world' } })
  })

  it('substitutes nested path tokens', async () => {
    const out = await transformerBriefExecutor.run(
      {
        nodeId: 'n1',
        config: { jsonTemplate: '{"first":"{{n2.post.mediaUrls.0}}"}' },
        upstream: { n2: { post: { mediaUrls: ['https://a', 'https://b'] } } },
      },
      stubCtx,
    )
    expect(out).toEqual({ kind: 'json', value: { first: 'https://a' } })
  })

  it('throws on invalid JSON after substitution', async () => {
    await expect(
      transformerBriefExecutor.run(
        { nodeId: 'n1', config: { jsonTemplate: 'not json' }, upstream: {} },
        stubCtx,
      ),
    ).rejects.toThrow()
  })

  it('throws on missing token path', async () => {
    await expect(
      transformerBriefExecutor.run(
        { nodeId: 'n1', config: { jsonTemplate: '{"x":"{{missing.path}}"}' }, upstream: {} },
        stubCtx,
      ),
    ).rejects.toThrow(/missing/i)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @anubis/workflow-runtime test tests/executors/transformer-brief.test.ts
```

- [ ] **Step 3: Implement the executor**

```ts
// packages/workflow-runtime/src/executors/transformer-brief.ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({ jsonTemplate: z.string() })
export type TransformerBriefConfig = z.infer<typeof ConfigSchema>

const TOKEN_RE = /\{\{([^}]+)\}\}/g

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = root
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      throw new Error(`missing path: ${path}`)
    }
    current = (current as Record<string, unknown>)[part]
    if (current === undefined) throw new Error(`missing path: ${path}`)
  }
  return current
}

function renderTemplate(template: string, upstream: Record<string, unknown>): string {
  return template.replace(TOKEN_RE, (_, raw) => {
    const path = String(raw).trim()
    const value = resolvePath(upstream, path)
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  })
}

export const transformerBriefExecutor: Executor<TransformerBriefConfig> = {
  type: 'transformerBrief',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const rendered = renderTemplate(input.config.jsonTemplate, input.upstream)
    const value = JSON.parse(rendered)
    return { kind: 'json', value }
  },
}
```

- [ ] **Step 4: Run test — PASS**

```bash
pnpm --filter @anubis/workflow-runtime test
```

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/transformer-brief.ts packages/workflow-runtime/tests/executors/transformer-brief.test.ts
git commit -m "feat(workflow-runtime): add transformer-brief executor (JSON template)"
```

---

## Task 10: AI Agent executor

**Files:**
- Create: `packages/workflow-runtime/tests/executors/ai-agent.test.ts`
- Create: `packages/workflow-runtime/src/executors/ai-agent.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/executors/ai-agent.test.ts
import { describe, it, expect, vi } from 'vitest'
import { aiAgentExecutor } from '../../src/executors/ai-agent.js'

function ctxWithAgent(agentRun: (req: any) => Promise<{ text: string }>) {
  return {
    agent: { run: agentRun },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('aiAgentExecutor', () => {
  it('embeds upstream into a <context> block', async () => {
    const agentRun = vi.fn().mockResolvedValue({ text: 'agent reply' })
    const out = await aiAgentExecutor.run(
      {
        nodeId: 'n3',
        config: { profileId: 'p1', reasoning: 'medium', prompt: 'analyze' },
        upstream: { n1: { caption: 'hello' } },
      },
      ctxWithAgent(agentRun),
    )
    expect(agentRun).toHaveBeenCalledTimes(1)
    const call = agentRun.mock.calls[0][0]
    expect(call.profileId).toBe('p1')
    expect(call.reasoning).toBe('medium')
    expect(call.prompt).toMatch(/^<context>\n.*\n<\/context>\n\nanalyze$/s)
    expect(call.prompt).toContain('"caption": "hello"')
    expect(out).toEqual({ kind: 'text', text: 'agent reply' })
  })

  it('rejects invalid reasoning', () => {
    expect(() =>
      aiAgentExecutor.validateConfig({ profileId: 'p1', reasoning: 'bogus', prompt: 'x' }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @anubis/workflow-runtime test tests/executors/ai-agent.test.ts
```

- [ ] **Step 3: Implement the executor**

```ts
// packages/workflow-runtime/src/executors/ai-agent.ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['low', 'medium', 'high']),
  prompt: z.string(),
})

export type AiAgentConfig = z.infer<typeof ConfigSchema>

export const aiAgentExecutor: Executor<AiAgentConfig> = {
  type: 'aiAgent',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const upstreamBlock = JSON.stringify(input.upstream, null, 2)
    const composedPrompt = `<context>\n${upstreamBlock}\n</context>\n\n${input.config.prompt}`
    const result = await ctx.agent.run({
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      prompt: composedPrompt,
    })
    return { kind: 'text', text: result.text }
  },
}
```

- [ ] **Step 4: Run test — PASS, commit**

```bash
pnpm --filter @anubis/workflow-runtime test
git add packages/workflow-runtime/src/executors/ai-agent.ts packages/workflow-runtime/tests/executors/ai-agent.test.ts
git commit -m "feat(workflow-runtime): add ai-agent executor (composes <context> + prompt)"
```

---

## Task 11: Instagram Post executor

**Files:**
- Create: `packages/workflow-runtime/tests/executors/instagram-post.test.ts`
- Create: `packages/workflow-runtime/src/executors/instagram-post.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/executors/instagram-post.test.ts
import { describe, it, expect, vi } from 'vitest'
import { instagramPostExecutor } from '../../src/executors/instagram-post.js'

function ctxWith(opts: { dbGet?: any; crawlerCapture?: any }) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: opts.crawlerCapture ?? (async () => ({ id: 'x', mediaUrls: [] })) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: opts.dbGet ?? (async () => ({ id: 'x', mediaUrls: [] })) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('instagramPostExecutor', () => {
  it('reads existing post from db when source=existing', async () => {
    const dbGet = vi.fn().mockResolvedValue({ id: 'p99', mediaUrls: ['https://a'] })
    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'existing', postId: 'p99' }, upstream: {} },
      ctxWith({ dbGet }),
    )
    expect(dbGet).toHaveBeenCalledWith('p99')
    expect(out).toEqual({ kind: 'instagramPost', post: { id: 'p99', mediaUrls: ['https://a'] } })
  })

  it('calls crawler.captureProfile when source=url', async () => {
    const crawlerCapture = vi.fn().mockResolvedValue({ id: 'fresh', mediaUrls: ['https://b'] })
    const out = await instagramPostExecutor.run(
      { nodeId: 'n1', config: { source: 'url', url: 'https://instagram.com/x' }, upstream: {} },
      ctxWith({ crawlerCapture }),
    )
    expect(crawlerCapture).toHaveBeenCalledWith('https://instagram.com/x')
    expect(out).toEqual({ kind: 'instagramPost', post: { id: 'fresh', mediaUrls: ['https://b'] } })
  })

  it('rejects invalid url in source=url', () => {
    expect(() =>
      instagramPostExecutor.validateConfig({ source: 'url', url: 'not-a-url' }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @anubis/workflow-runtime test tests/executors/instagram-post.test.ts
```

- [ ] **Step 3: Implement the executor**

```ts
// packages/workflow-runtime/src/executors/instagram-post.ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('existing'), postId: z.string().min(1) }),
  z.object({ source: z.literal('url'), url: z.string().url() }),
])

export type InstagramPostConfig = z.infer<typeof ConfigSchema>

export const instagramPostExecutor: Executor<InstagramPostConfig> = {
  type: 'instagramPost',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    if (input.config.source === 'existing') {
      const post = await ctx.db.getCapturedPost(input.config.postId)
      return { kind: 'instagramPost', post }
    }
    const captured = await ctx.crawler.captureProfile(input.config.url)
    return { kind: 'instagramPost', post: captured }
  },
}
```

- [ ] **Step 4: PASS + commit**

```bash
pnpm --filter @anubis/workflow-runtime test
git add packages/workflow-runtime/src/executors/instagram-post.ts packages/workflow-runtime/tests/executors/instagram-post.test.ts
git commit -m "feat(workflow-runtime): add instagram-post executor (existing | url)"
```

---

## Task 12: Transformer Media executor — downloads URL → file artifact

**Files:**
- Create: `packages/workflow-runtime/tests/executors/transformer-media.test.ts`
- Create: `packages/workflow-runtime/src/executors/transformer-media.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/executors/transformer-media.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transformerMediaExecutor } from '../../src/executors/transformer-media.js'

const ORIG_FETCH = global.fetch

function ctxWith(writeArtifact: (...args: any[]) => Promise<string>) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: writeArtifact },
    runId: 'r99',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    arrayBuffer: async () => new TextEncoder().encode('PAYLOAD').buffer,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
  })) as unknown as typeof fetch)
})
afterEach(() => { global.fetch = ORIG_FETCH })

describe('transformerMediaExecutor', () => {
  it('downloads config.url and writes a run artifact', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/runs/r99/n1.jpg')
    const out = await transformerMediaExecutor.run(
      { nodeId: 'n1', config: { url: 'https://example.com/a.jpg' }, upstream: {} },
      ctxWith(writeArtifact),
    )
    expect(writeArtifact).toHaveBeenCalledWith('r99', 'n1', 'jpg', expect.any(Buffer))
    expect(out).toMatchObject({ kind: 'file', path: '/tmp/runs/r99/n1.jpg', mimeType: 'image/jpeg' })
  })

  it('falls back to first upstream media url', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/x')
    await transformerMediaExecutor.run(
      {
        nodeId: 'n1',
        config: {},
        upstream: { n2: { kind: 'instagramPost', post: { mediaUrls: ['https://example.com/b.png'] } } },
      },
      ctxWith(writeArtifact),
    )
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/b.png')
  })

  it('throws when no url available', async () => {
    await expect(
      transformerMediaExecutor.run(
        { nodeId: 'n1', config: {}, upstream: {} },
        ctxWith(async () => ''),
      ),
    ).rejects.toThrow(/no.*url/i)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @anubis/workflow-runtime test tests/executors/transformer-media.test.ts
```

- [ ] **Step 3: Implement the executor**

```ts
// packages/workflow-runtime/src/executors/transformer-media.ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  url: z.string().url().optional(),
})

export type TransformerMediaConfig = z.infer<typeof ConfigSchema>

function findFirstMediaUrl(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const post = (value as { post?: { mediaUrls?: unknown } }).post
      const urls = post?.mediaUrls
      if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
    }
  }
  return null
}

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm',
}

function pickExt(mimeType: string | null, url: string): string {
  if (mimeType && EXT_FROM_MIME[mimeType]) return EXT_FROM_MIME[mimeType]
  const m = url.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)
  return m ? m[1].toLowerCase() : 'bin'
}

export const transformerMediaExecutor: Executor<TransformerMediaConfig> = {
  type: 'transformerMedia',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const url = input.config.url ?? findFirstMediaUrl(input.upstream)
    if (!url) throw new Error('transformerMedia: no url provided or found upstream')
    const response = await fetch(url)
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type')
    const ext = pickExt(mimeType, url)
    const path = await ctx.fs.writeRunArtifact(ctx.runId, input.nodeId, ext, buffer)
    return { kind: 'file', path, mimeType: mimeType ?? undefined, sizeBytes: buffer.length }
  },
}
```

- [ ] **Step 4: PASS + commit**

```bash
pnpm --filter @anubis/workflow-runtime test
git add packages/workflow-runtime/src/executors/transformer-media.ts packages/workflow-runtime/tests/executors/transformer-media.test.ts
git commit -m "feat(workflow-runtime): add transformer-media executor (download → artifact)"
```

---

## Task 13: OCR Extractor executor

**Files:**
- Create: `packages/workflow-runtime/tests/executors/ocr-extractor.test.ts`
- Create: `packages/workflow-runtime/src/executors/ocr-extractor.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/executors/ocr-extractor.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ocrExtractorExecutor } from '../../src/executors/ocr-extractor.js'

function ctxWithOcr(ocrFn: (path: string) => Promise<string>) {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: ocrFn },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('ocrExtractorExecutor', () => {
  it('uses config.imagePath when provided', async () => {
    const ocr = vi.fn().mockResolvedValue('extracted text')
    const out = await ocrExtractorExecutor.run(
      { nodeId: 'n1', config: { imagePath: '/p/x.png' }, upstream: {} },
      ctxWithOcr(ocr),
    )
    expect(ocr).toHaveBeenCalledWith('/p/x.png')
    expect(out).toEqual({ kind: 'text', text: 'extracted text' })
  })

  it('falls back to first upstream file path', async () => {
    const ocr = vi.fn().mockResolvedValue('OCR!')
    await ocrExtractorExecutor.run(
      {
        nodeId: 'n1',
        config: {},
        upstream: { n2: { kind: 'file', path: '/p/up.png' } },
      },
      ctxWithOcr(ocr),
    )
    expect(ocr).toHaveBeenCalledWith('/p/up.png')
  })

  it('throws when no image source available', async () => {
    await expect(
      ocrExtractorExecutor.run({ nodeId: 'n1', config: {}, upstream: {} }, ctxWithOcr(async () => '')),
    ).rejects.toThrow(/no.*image/i)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @anubis/workflow-runtime test tests/executors/ocr-extractor.test.ts
```

- [ ] **Step 3: Implement the executor**

```ts
// packages/workflow-runtime/src/executors/ocr-extractor.ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  imagePath: z.string().optional(),
})

export type OcrExtractorConfig = z.infer<typeof ConfigSchema>

function findFirstFilePath(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const v = value as { kind?: string; path?: unknown }
      if (v.kind === 'file' && typeof v.path === 'string') return v.path
    }
  }
  return null
}

export const ocrExtractorExecutor: Executor<OcrExtractorConfig> = {
  type: 'ocrExtractor',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const path = input.config.imagePath ?? findFirstFilePath(input.upstream)
    if (!path) throw new Error('ocrExtractor: no image path provided or found upstream')
    const text = await ctx.ocr.extractFromImage(path)
    return { kind: 'text', text }
  },
}
```

- [ ] **Step 4: PASS + commit**

```bash
pnpm --filter @anubis/workflow-runtime test
git add packages/workflow-runtime/src/executors/ocr-extractor.ts packages/workflow-runtime/tests/executors/ocr-extractor.test.ts
git commit -m "feat(workflow-runtime): add ocr-extractor executor"
```

---

## Task 14: Executor registry

**Files:**
- Create: `packages/workflow-runtime/src/executors/index.ts`
- Modify: `packages/workflow-runtime/src/index.ts`

- [ ] **Step 1: Create the registry**

```ts
// packages/workflow-runtime/src/executors/index.ts
import type { Executor } from '../types.js'
import { tableExecutor }            from './table.js'
import { transformerBriefExecutor } from './transformer-brief.js'
import { aiAgentExecutor }          from './ai-agent.js'
import { instagramPostExecutor }    from './instagram-post.js'
import { transformerMediaExecutor } from './transformer-media.js'
import { ocrExtractorExecutor }     from './ocr-extractor.js'

export const executorRegistry: Record<string, Executor<unknown>> = {
  table:            tableExecutor as Executor<unknown>,
  transformerBrief: transformerBriefExecutor as Executor<unknown>,
  aiAgent:          aiAgentExecutor as Executor<unknown>,
  instagramPost:    instagramPostExecutor as Executor<unknown>,
  transformerMedia: transformerMediaExecutor as Executor<unknown>,
  ocrExtractor:     ocrExtractorExecutor as Executor<unknown>,
}

export type ExecutorKey = keyof typeof executorRegistry

export {
  tableExecutor, transformerBriefExecutor, aiAgentExecutor,
  instagramPostExecutor, transformerMediaExecutor, ocrExtractorExecutor,
}
```

- [ ] **Step 2: Re-export from src/index.ts**

Append:

```ts
export { executorRegistry } from './executors/index.js'
export type { ExecutorKey } from './executors/index.js'
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @anubis/workflow-runtime typecheck
git add packages/workflow-runtime/src/executors/index.ts packages/workflow-runtime/src/index.ts
git commit -m "feat(workflow-runtime): add executor registry"
```

---

## Task 15: TDD runner.ts — DAG walker with events + cancellation

**Files:**
- Create: `packages/workflow-runtime/tests/runner.test.ts`
- Create: `packages/workflow-runtime/src/runner.ts`
- Modify: `packages/workflow-runtime/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow-runtime/tests/runner.test.ts
import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, NodeRunEvent, WorkflowGraph } from '../src/types.js'

const fakeExecutor = (type: string, run: (i: any) => Promise<unknown>): Executor<unknown> => ({
  type,
  validateConfig: (raw) => raw,
  run: (input) => run(input),
})

function makeCtx(emit: (e: NodeRunEvent) => void, signal: AbortSignal = new AbortController().signal): ExecutorContext {
  return {
    agent: { run: async () => ({ text: '' }) },
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    runId: 'r1',
    signal,
    emit,
  }
}

function g(): WorkflowGraph {
  return {
    nodes: [
      { id: 'a', type: 'echo', position: { x: 0, y: 0 }, config: { v: 'A' } },
      { id: 'b', type: 'echo', position: { x: 0, y: 0 }, config: { v: 'B' } },
      { id: 'c', type: 'merge', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'c' },
      { id: 'e2', source: 'b', target: 'c' },
    ],
  }
}

describe('runWorkflow', () => {
  it('runs in topological order and emits started+succeeded for each node', async () => {
    const events: NodeRunEvent[] = []
    const registry = {
      echo: fakeExecutor('echo', async (i) => i.config.v),
      merge: fakeExecutor('merge', async (i) => Object.values(i.upstream).join('+')),
    }
    const ctx = makeCtx((e) => events.push(e))
    const result = await runWorkflow(g(), registry, ctx)
    expect(result.status).toBe('succeeded')
    const lastSucceeded = events.filter((e) => e.kind === 'node-succeeded').at(-1)
    expect(lastSucceeded?.nodeId).toBe('c')
    expect((lastSucceeded as any).output).toBe('A+B')
  })

  it('halts on first failure and marks remaining nodes skipped', async () => {
    const events: NodeRunEvent[] = []
    const registry = {
      echo: fakeExecutor('echo', async () => { throw new Error('boom') }),
      merge: fakeExecutor('merge', async () => 'should not run'),
    }
    const result = await runWorkflow(g(), registry, makeCtx((e) => events.push(e)))
    expect(result.status).toBe('failed')
    expect(events.some((e) => e.kind === 'node-failed')).toBe(true)
    expect(result.stepStatuses.c).toBe('skipped')
  })

  it('cancels remaining nodes when signal aborts', async () => {
    const ctrl = new AbortController()
    const events: NodeRunEvent[] = []
    const registry = {
      echo: fakeExecutor('echo', async () => { ctrl.abort(); return 'ok' }),
      merge: fakeExecutor('merge', async () => 'should not run'),
    }
    const result = await runWorkflow(g(), registry, makeCtx((e) => events.push(e), ctrl.signal))
    expect(result.status).toBe('cancelled')
    expect(result.stepStatuses.c).toBe('skipped')
  })

  it('rejects an invalid graph before any node runs', async () => {
    const cyclic: WorkflowGraph = {
      nodes: [
        { id: 'a', type: 'echo', position: { x: 0, y: 0 }, config: {} },
        { id: 'b', type: 'echo', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    }
    const events: NodeRunEvent[] = []
    const registry = { echo: fakeExecutor('echo', async () => 'x') }
    await expect(runWorkflow(cyclic, registry, makeCtx((e) => events.push(e))))
      .rejects.toThrow(/cycle/i)
    expect(events.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @anubis/workflow-runtime test tests/runner.test.ts
```

- [ ] **Step 3: Implement the runner**

```ts
// packages/workflow-runtime/src/runner.ts
import { topologicalSort, incomingEdges } from './graph.js'
import type {
  Executor, ExecutorContext, RunStatus, StepStatus, WorkflowGraph,
} from './types.js'

export interface RunResult {
  status: RunStatus
  outputs: Record<string, unknown>
  stepStatuses: Record<string, StepStatus>
  error?: string
}

export async function runWorkflow(
  graph: WorkflowGraph,
  registry: Record<string, Executor<unknown>>,
  ctx: ExecutorContext,
): Promise<RunResult> {
  const order = topologicalSort(graph)
  for (const node of graph.nodes) {
    if (!registry[node.type]) throw new Error(`unknown node type: ${node.type}`)
    registry[node.type].validateConfig(node.config)
  }

  const outputs: Record<string, unknown> = {}
  const stepStatuses: Record<string, StepStatus> = {}
  for (const id of order) stepStatuses[id] = 'pending'

  for (const nodeId of order) {
    if (ctx.signal.aborted) {
      for (const id of order) if (stepStatuses[id] === 'pending') stepStatuses[id] = 'skipped'
      return { status: 'cancelled', outputs, stepStatuses }
    }

    const node = graph.nodes.find((n) => n.id === nodeId)!
    const executor = registry[node.type]
    const upstream: Record<string, unknown> = {}
    for (const src of incomingEdges(graph, nodeId)) upstream[src] = outputs[src]

    stepStatuses[nodeId] = 'running'
    ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })

    try {
      const output = await executor.run(
        { nodeId, config: node.config as never, upstream },
        ctx,
      )
      outputs[nodeId] = output
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stepStatuses[nodeId] = 'failed'
      ctx.emit({ kind: 'node-failed', nodeId, at: Date.now(), error: message })
      for (const id of order) if (stepStatuses[id] === 'pending') stepStatuses[id] = 'skipped'
      return { status: 'failed', outputs, stepStatuses, error: message }
    }

    if (ctx.signal.aborted) {
      for (const id of order) if (stepStatuses[id] === 'pending') stepStatuses[id] = 'skipped'
      return { status: 'cancelled', outputs, stepStatuses }
    }
  }

  return { status: 'succeeded', outputs, stepStatuses }
}
```

- [ ] **Step 4: PASS — re-export from index**

Append to `packages/workflow-runtime/src/index.ts`:

```ts
export { runWorkflow } from './runner.js'
export type { RunResult } from './runner.js'
```

- [ ] **Step 5: Commit**

```bash
pnpm --filter @anubis/workflow-runtime test
git add packages/workflow-runtime/src/runner.ts packages/workflow-runtime/tests/runner.test.ts packages/workflow-runtime/src/index.ts
git commit -m "feat(workflow-runtime): add runner.ts (sequential DAG walker)"
```

---

## Task 16: Backend run manager — service that owns active runs + SSE channels

**Files:**
- Create: `packages/backend/src/workflow-run-manager.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/backend/src/workflow-run-manager.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConversationStack, WorkflowRun, WorkflowRunsRepo } from '@anubis/conversation'
import {
  executorRegistry,
  runWorkflow,
  WorkflowGraphSchema,
  type NodeRunEvent,
  type RunEvent,
  type RunStatus,
} from '@anubis/workflow-runtime'
import type { Agent } from '@anubis/ai-agent'

type Listener = (event: RunEvent) => void

interface ActiveRun {
  runId: string
  controller: AbortController
  listeners: Set<Listener>
  buffered: RunEvent[]
  finished: boolean
}

const INLINE_OUTPUT_LIMIT = 256 * 1024

export class WorkflowRunManager {
  private active = new Map<string, ActiveRun>()
  private runsByWorkflow = new Map<string, string>()      // workflowId → active runId

  constructor(
    private stack: ConversationStack,
    private dataDir: string,
  ) {}

  async start(workflowId: string): Promise<{ runId: string }> {
    if (this.runsByWorkflow.has(workflowId)) {
      const err = new Error('workflow already has an active run')
      ;(err as { code?: number }).code = 409
      throw err
    }
    const workflow = this.stack.workflows.get(workflowId)
    if (!workflow) throw new Error(`workflow ${workflowId} not found`)
    if (!workflow.publishedGraph) {
      const err = new Error('workflow has no published version')
      ;(err as { code?: number }).code = 400
      throw err
    }

    WorkflowGraphSchema.parse(JSON.parse(workflow.publishedGraph))

    const runId = randomUUID()
    const controller = new AbortController()
    const listeners = new Set<Listener>()
    const buffered: RunEvent[] = []
    const active: ActiveRun = { runId, controller, listeners, buffered, finished: false }
    this.active.set(runId, active)
    this.runsByWorkflow.set(workflowId, runId)

    const now = Date.now()
    this.stack.workflowRuns.createRun({
      id: runId,
      workflowId,
      graphSnapshot: workflow.publishedGraph,
      now,
    })

    const emit = (event: RunEvent) => {
      if (active.finished) return
      buffered.push(event)
      for (const l of listeners) l(event)
    }

    void this.runAndPersist(active, JSON.parse(workflow.publishedGraph), emit, now).finally(() => {
      this.active.delete(runId)
      this.runsByWorkflow.delete(workflowId)
    })

    return { runId }
  }

  cancel(runId: string): boolean {
    const active = this.active.get(runId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  subscribe(runId: string, listener: Listener): { unsubscribe: () => void; replay: RunEvent[] } {
    const active = this.active.get(runId)
    if (!active) return { unsubscribe: () => {}, replay: [] }
    active.listeners.add(listener)
    return {
      unsubscribe: () => active.listeners.delete(listener),
      replay: [...active.buffered],
    }
  }

  isActive(runId: string): boolean {
    return this.active.has(runId)
  }

  private async runAndPersist(
    active: ActiveRun,
    graph: ReturnType<typeof WorkflowGraphSchema.parse>,
    emit: (event: RunEvent) => void,
    startedAt: number,
  ): Promise<void> {
    emit({ kind: 'run-started', runId: active.runId, at: startedAt })

    const wrappedEmit = async (event: NodeRunEvent) => {
      const repo = this.stack.workflowRuns
      const stepId = `${active.runId}:${event.nodeId}`
      if (event.kind === 'node-started') {
        repo.upsertStep({
          id: stepId, runId: active.runId, nodeId: event.nodeId,
          status: 'running', startedAt: event.at,
        })
      } else if (event.kind === 'node-succeeded') {
        const stored = await this.maybeMaterializeOutput(active.runId, event.nodeId, event.output)
        repo.upsertStep({
          id: stepId, runId: active.runId, nodeId: event.nodeId,
          status: 'succeeded', finishedAt: event.at, output: JSON.stringify(stored),
        })
      } else {
        repo.upsertStep({
          id: stepId, runId: active.runId, nodeId: event.nodeId,
          status: 'failed', finishedAt: event.at, error: event.error,
        })
      }
      emit(event)
    }

    let status: RunStatus = 'failed'
    let runError: string | undefined
    try {
      const ctx = {
        agent: { run: async (req: { profileId: string; reasoning: 'low' | 'medium' | 'high'; prompt: string }) => {
          const resolved = this.stack.profiles.resolve(req.profileId)
          const agentName: Agent = resolved.agent as Agent
          const dataDir = this.dataDir
          const cwd = join(dataDir, 'workflow-runs', active.runId, 'agent-cwd')
          await mkdir(cwd, { recursive: true })
          const result = await this.stack.aiAgent.runAgent({
            agent: agentName, cwd, prompt: req.prompt,
            model: resolved.model, reasoningEffort: req.reasoning,
            claudeCliProfile: resolved.claudeCliProfile,
          })
          return { text: result.text }
        }},
        crawler: { captureProfile: async (_url: string) => {
          throw new Error('crawler.captureProfile not yet wired in v1 backend (planned for follow-up integration)')
        }},
        ocr: { extractFromImage: async (_path: string) => {
          throw new Error('ocr.extractFromImage not yet wired (anubis-extractor integration is follow-up)')
        }},
        db: { getCapturedPost: async (id: string) => {
          const post = this.stack.capturedPosts.get(id)
          if (!post) throw new Error(`captured post ${id} not found`)
          return { id: post.id, mediaUrls: post.mediaUrls ?? [], caption: post.caption }
        }},
        fs: { writeRunArtifact: async (runId: string, nodeId: string, ext: string, data: Buffer) => {
          const dir = join(this.dataDir, 'workflow-runs', runId)
          await mkdir(dir, { recursive: true })
          const path = join(dir, `${nodeId}.${ext}`)
          await writeFile(path, data)
          return path
        }},
        runId: active.runId,
        signal: active.controller.signal,
        emit: (e: NodeRunEvent) => { void wrappedEmit(e) },
      }
      const result = await runWorkflow(graph, executorRegistry, ctx)
      status = result.status
      runError = result.error
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err)
      status = 'failed'
    }

    const finishedAt = Date.now()
    this.stack.workflowRuns.setRunStatus(active.runId, status, finishedAt, runError ?? null)
    emit({ kind: 'run-finished', runId: active.runId, at: finishedAt, status, error: runError })
    active.finished = true
  }

  private async maybeMaterializeOutput(
    runId: string,
    nodeId: string,
    output: unknown,
  ): Promise<unknown> {
    const serialized = JSON.stringify(output)
    if (serialized.length <= INLINE_OUTPUT_LIMIT) return output
    const dir = join(this.dataDir, 'workflow-runs', runId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${nodeId}.output.json`)
    await writeFile(path, serialized)
    return { kind: 'file', path, mimeType: 'application/json', sizeBytes: serialized.length }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: PASS (after build of workflow-runtime + conversation). If it fails because workflow-runtime isn't built, run `pnpm --filter @anubis/workflow-runtime build` first.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/workflow-run-manager.ts
git commit -m "feat(backend): add WorkflowRunManager (lifecycle + SSE channels)"
```

---

## Task 17: Add workflow-runtime as a backend dependency

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/workflow-runtime/package.json` (add to repo workspace if needed — covered by pnpm-workspace.yaml already)

- [ ] **Step 1: Add the dep**

In `packages/backend/package.json`, add to the `dependencies` block alongside `@anubis/conversation`, `@anubis/ai-agent`:

```json
"@anubis/workflow-runtime": "workspace:*"
```

- [ ] **Step 2: Re-install**

```bash
pnpm install
```

- [ ] **Step 3: Build workflow-runtime so its dist/ exists for backend's tsc**

```bash
pnpm --filter @anubis/workflow-runtime build
```

- [ ] **Step 4: Verify backend typecheck**

```bash
pnpm --filter @anubis/backend typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): depend on @anubis/workflow-runtime"
```

---

## Task 18: Backend Hono module — REST routes for workflows

**Files:**
- Create: `packages/backend/src/workflow.ts`

- [ ] **Step 1: Create the routes**

```ts
// packages/backend/src/workflow.ts
import { Hono } from 'hono'
import { z, ZodError } from 'zod'
import { randomUUID } from 'node:crypto'
import { getStack, getDataDir } from './services.js'
import { WorkflowGraphSchema } from '@anubis/workflow-runtime'
import { WorkflowRunManager } from './workflow-run-manager.js'
import type { ConversationStack } from '@anubis/conversation'

let runManager: WorkflowRunManager | null = null
function getRunManager(stack: ConversationStack): WorkflowRunManager {
  if (!runManager) runManager = new WorkflowRunManager(stack, getDataDir())
  return runManager
}

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
})

const PatchMetaBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
})

const DraftBody = z.object({ draftGraph: z.string().min(2) })

export const workflowRoutes = new Hono()

workflowRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const stack = getStack()
  const now = Date.now()
  const wf = stack.workflows.create({ id: randomUUID(), name: body.name, description: body.description, now })
  return c.json(wf, 201)
})

workflowRoutes.get('/', (c) => {
  const stack = getStack()
  const items = stack.workflows.list().map((wf) => {
    const lastRun = stack.workflowRuns.listRunsForWorkflow(wf.id, 1)[0]
    return {
      id: wf.id, name: wf.name, description: wf.description,
      hasPublished: wf.publishedGraph != null,
      draftAhead: wf.publishedGraph != null && wf.draftGraph !== wf.publishedGraph,
      draftUpdatedAt: wf.draftUpdatedAt, publishedAt: wf.publishedAt,
      lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt } : undefined,
    }
  })
  return c.json({ items })
})

workflowRoutes.get('/:id', (c) => {
  const stack = getStack()
  const wf = stack.workflows.get(c.req.param('id'))
  if (!wf) return c.json({ error: 'not_found' }, 404)
  return c.json(wf)
})

workflowRoutes.patch('/:id', async (c) => {
  const stack = getStack()
  const body = PatchMetaBody.parse(await c.req.json())
  const wf = stack.workflows.updateMeta(c.req.param('id'), body, Date.now())
  return c.json(wf)
})

workflowRoutes.put('/:id/draft', async (c) => {
  const stack = getStack()
  const body = DraftBody.parse(await c.req.json())
  WorkflowGraphSchema.parse(JSON.parse(body.draftGraph))
  const wf = stack.workflows.writeDraft(c.req.param('id'), body.draftGraph, Date.now())
  return c.json(wf)
})

workflowRoutes.post('/:id/publish', (c) => {
  const stack = getStack()
  const wf = stack.workflows.publish(c.req.param('id'), Date.now())
  return c.json(wf)
})

workflowRoutes.delete('/:id', (c) => {
  const stack = getStack()
  stack.workflows.delete(c.req.param('id'))
  return c.body(null, 204)
})

workflowRoutes.post('/:id/runs', async (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  try {
    const { runId } = await mgr.start(c.req.param('id'))
    return c.json({ runId }, 201)
  } catch (err) {
    const code = (err as { code?: number }).code
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ZodError) return c.json({ error: 'invalid_graph', issues: err.issues }, 400)
    if (code === 409) return c.json({ error: 'already_running', message }, 409)
    if (code === 400) return c.json({ error: 'bad_request', message }, 400)
    return c.json({ error: 'internal', message }, 500)
  }
})

workflowRoutes.get('/:id/runs', (c) => {
  const stack = getStack()
  const runs = stack.workflowRuns.listRunsForWorkflow(c.req.param('id'))
  return c.json({ items: runs })
})

workflowRoutes.get('/runs/:runId', (c) => {
  const stack = getStack()
  const runId = c.req.param('runId')
  const run = stack.workflowRuns.getRun(runId)
  if (!run) return c.json({ error: 'not_found' }, 404)
  const steps = stack.workflowRuns.listSteps(runId)
  return c.json({ run, steps })
})

workflowRoutes.delete('/runs/:runId', (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  const runId = c.req.param('runId')
  if (mgr.isActive(runId)) {
    mgr.cancel(runId)
    return c.body(null, 204)
  }
  stack.workflowRuns.deleteRun(runId)
  return c.body(null, 204)
})

workflowRoutes.get('/runs/:runId/events', (c) => {
  const stack = getStack()
  const mgr = getRunManager(stack)
  const runId = c.req.param('runId')

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const sub = mgr.subscribe(runId, send)
      for (const e of sub.replay) send(e)
      if (!mgr.isActive(runId)) {
        // run already finished — replay was the whole stream; close
        controller.close()
        return
      }
      const close = () => {
        sub.unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      }
      c.req.raw.signal.addEventListener('abort', close)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
})
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @anubis/backend typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/workflow.ts
git commit -m "feat(backend): add /workflows + /workflows/runs routes (REST + SSE)"
```

---

## Task 19: Mount workflow routes in app.ts

**Files:**
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Add the import and mount**

In `packages/backend/src/app.ts`, add the import alongside the other route imports:

```ts
import { workflowRoutes } from './workflow.js'
```

Add the mount alongside the existing `app.route(...)` calls:

```ts
app.route('/workflows', workflowRoutes)
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @anubis/backend typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat(backend): mount workflow routes"
```

---

## Task 20: Backend integration test — workflow lifecycle smoke

**Files:**
- Create: `packages/backend/tests/workflow.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/backend/tests/workflow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-wf-test-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  // Dynamic import after env is set so services pick up tmpDir.
  const mod = await import('../src/app.js')
  return mod.app ?? mod.default
}

describe('workflow REST', () => {
  it('creates, saves draft, publishes, lists', async () => {
    const app = await loadApp()
    const created = await app.request('/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke' }),
    })
    expect(created.status).toBe(201)
    const wf = await created.json()
    expect(wf.id).toBeTruthy()

    const draft = JSON.stringify({
      nodes: [{ id: 'n1', type: 'table', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    })
    const saved = await app.request(`/workflows/${wf.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftGraph: draft }),
    })
    expect(saved.status).toBe(200)

    const published = await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })
    expect(published.status).toBe(200)

    const list = await app.request('/workflows')
    const body = await list.json()
    const found = body.items.find((i: { id: string }) => i.id === wf.id)
    expect(found).toBeTruthy()
    expect(found.hasPublished).toBe(true)
  })

  it('rejects run with no published version', async () => {
    const app = await loadApp()
    const created = await app.request('/workflows', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NoPub' }),
    })
    const wf = await created.json()
    const run = await app.request(`/workflows/${wf.id}/runs`, { method: 'POST' })
    expect(run.status).toBe(400)
  })
})
```

- [ ] **Step 2: Check what backend test infra exists; add minimal vitest config if missing**

If `packages/backend` has no `vitest.config.ts`, add:

```ts
// packages/backend/vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.{test,spec}.ts'] },
})
```

And add `"test": "vitest run"` to `packages/backend/package.json` `scripts` if not present.

- [ ] **Step 3: Run + verify PASS**

```bash
pnpm --filter @anubis/backend test
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/tests/workflow.test.ts packages/backend/vitest.config.ts packages/backend/package.json
git commit -m "test(backend): smoke workflow lifecycle via REST"
```

---

## Task 21: Frontend API client — REST + EventSource helper

**Files:**
- Create: `packages/frontend/src/api/workflows.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/frontend/src/api/workflows.ts
import { getApiBaseUrl } from '@/api'

export interface WorkflowSummary {
  id: string
  name: string
  description?: string
  hasPublished: boolean
  draftAhead: boolean
  draftUpdatedAt: number
  publishedAt?: number
  lastRun?: { id: string; status: string; startedAt: number }
}

export interface WorkflowDetail {
  id: string
  name: string
  description?: string
  draftGraph: string
  publishedGraph?: string
  draftUpdatedAt: number
  publishedAt?: number
  createdAt: number
  updatedAt: number
}

export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }
  | { kind: 'run-started';    runId: string; at: number }
  | { kind: 'run-finished';   runId: string; at: number; status: string; error?: string }

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBaseUrl()
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw Object.assign(new Error(text || res.statusText), { status: res.status })
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const workflowsApi = {
  list:        () => jsonFetch<{ items: WorkflowSummary[] }>('/workflows'),
  create:      (name: string, description?: string) =>
                jsonFetch<WorkflowDetail>('/workflows', { method: 'POST', body: JSON.stringify({ name, description }) }),
  get:         (id: string) => jsonFetch<WorkflowDetail>(`/workflows/${id}`),
  patchMeta:   (id: string, patch: { name?: string; description?: string | null }) =>
                jsonFetch<WorkflowDetail>(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  saveDraft:   (id: string, draftGraph: string) =>
                jsonFetch<WorkflowDetail>(`/workflows/${id}/draft`, { method: 'PUT', body: JSON.stringify({ draftGraph }) }),
  publish:     (id: string) => jsonFetch<WorkflowDetail>(`/workflows/${id}/publish`, { method: 'POST' }),
  remove:      (id: string) => jsonFetch<void>(`/workflows/${id}`, { method: 'DELETE' }),
  startRun:    (id: string) => jsonFetch<{ runId: string }>(`/workflows/${id}/runs`, { method: 'POST' }),
  listRuns:    (id: string) => jsonFetch<{ items: Array<{ id: string; status: string; startedAt: number }> }>(`/workflows/${id}/runs`),
  getRun:      (runId: string) =>
                jsonFetch<{ run: { id: string; status: string; startedAt: number; finishedAt?: number; error?: string },
                            steps: Array<{ id: string; nodeId: string; status: string; output?: string; error?: string }> }>(`/workflows/runs/${runId}`),
  cancelRun:   (runId: string) => jsonFetch<void>(`/workflows/runs/${runId}`, { method: 'DELETE' }),
}

export async function openRunEventStream(
  runId: string,
  onEvent: (event: NodeRunEvent) => void,
): Promise<() => void> {
  const base = await getApiBaseUrl()
  const es = new EventSource(`${base}/workflows/runs/${runId}/events`)
  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as NodeRunEvent
      onEvent(parsed)
      if (parsed.kind === 'run-finished') es.close()
    } catch { /* skip malformed */ }
  }
  es.onerror = () => { /* EventSource auto-reconnects */ }
  return () => es.close()
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @anubis/frontend typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api/workflows.ts
git commit -m "feat(frontend): add workflows API client + SSE event stream helper"
```

---

## Task 22: Editor zustand store

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/editor-store.ts`

- [ ] **Step 1: Install zustand if not already present**

```bash
pnpm --filter @anubis/frontend add zustand
```

- [ ] **Step 2: Create the store**

```ts
// packages/frontend/src/components/workflow-editor/editor-store.ts
import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'
import type { NodeRunEvent } from '@/api/workflows'

export type StepState = {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  startedAt?: number
  finishedAt?: number
  output?: unknown
  error?: string
}

export type ActiveRun = {
  runId: string
  steps: Record<string, StepState>
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
}

export interface Snapshot { nodes: Node[]; edges: Edge[] }

interface EditorState {
  workflowId: string | null
  name: string
  description?: string
  draft: Snapshot
  published: Snapshot | null
  draftUpdatedAt: number | null
  publishedAt: number | null
  isDirty: boolean

  selection: string[]
  history: { past: Snapshot[]; future: Snapshot[] }
  clipboard: string | null      // JSON-serialized subgraph
  activeRun: ActiveRun | null
  inspectorMode: 'config' | 'run'

  // actions
  hydrate(args: {
    workflowId: string; name: string; description?: string
    draft: Snapshot; published: Snapshot | null
    draftUpdatedAt: number; publishedAt: number | null
  }): void
  setNodes(nodes: Node[]): void
  setEdges(edges: Edge[]): void
  setName(name: string): void
  pushHistory(): void
  undo(): void
  redo(): void
  setSelection(ids: string[]): void
  markSaved(at: number): void
  markPublished(at: number, snapshot: Snapshot): void
  setClipboard(serialized: string | null): void
  setActiveRun(run: ActiveRun | null): void
  applyRunEvent(event: NodeRunEvent): void
  setInspectorMode(mode: 'config' | 'run'): void
}

function clone(snap: Snapshot): Snapshot {
  return { nodes: snap.nodes.map((n) => ({ ...n })), edges: snap.edges.map((e) => ({ ...e })) }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  workflowId: null,
  name: '',
  description: undefined,
  draft: { nodes: [], edges: [] },
  published: null,
  draftUpdatedAt: null,
  publishedAt: null,
  isDirty: false,

  selection: [],
  history: { past: [], future: [] },
  clipboard: null,
  activeRun: null,
  inspectorMode: 'config',

  hydrate(a) {
    set({
      workflowId: a.workflowId,
      name: a.name, description: a.description,
      draft: a.draft, published: a.published,
      draftUpdatedAt: a.draftUpdatedAt, publishedAt: a.publishedAt,
      isDirty: false, selection: [], history: { past: [], future: [] }, clipboard: null,
      activeRun: null, inspectorMode: 'config',
    })
  },
  setNodes(nodes) { set((s) => ({ draft: { ...s.draft, nodes }, isDirty: true })) },
  setEdges(edges) { set((s) => ({ draft: { ...s.draft, edges }, isDirty: true })) },
  setName(name) { set({ name, isDirty: true }) },
  pushHistory() {
    set((s) => ({ history: { past: [...s.history.past, clone(s.draft)], future: [] } }))
  },
  undo() {
    const s = get()
    if (s.history.past.length === 0) return
    const prev = s.history.past[s.history.past.length - 1]
    set({
      draft: prev,
      history: {
        past: s.history.past.slice(0, -1),
        future: [clone(s.draft), ...s.history.future],
      },
      isDirty: true,
    })
  },
  redo() {
    const s = get()
    if (s.history.future.length === 0) return
    const next = s.history.future[0]
    set({
      draft: next,
      history: {
        past: [...s.history.past, clone(s.draft)],
        future: s.history.future.slice(1),
      },
      isDirty: true,
    })
  },
  setSelection(ids) { set({ selection: ids }) },
  markSaved(at) { set({ draftUpdatedAt: at, isDirty: false }) },
  markPublished(at, snapshot) { set({ publishedAt: at, published: snapshot }) },
  setClipboard(s) { set({ clipboard: s }) },
  setActiveRun(run) { set({ activeRun: run, inspectorMode: run ? 'run' : 'config' }) },
  applyRunEvent(event) {
    const s = get()
    if (!s.activeRun) return
    const steps = { ...s.activeRun.steps }
    if (event.kind === 'node-started') {
      steps[event.nodeId] = { status: 'running', startedAt: event.at }
    } else if (event.kind === 'node-succeeded') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'succeeded', finishedAt: event.at, output: event.output }
    } else if (event.kind === 'node-failed') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'failed', finishedAt: event.at, error: event.error }
    } else if (event.kind === 'run-finished') {
      set({ activeRun: { ...s.activeRun, status: event.status as ActiveRun['status'], steps } })
      return
    }
    set({ activeRun: { ...s.activeRun, steps } })
  },
  setInspectorMode(mode) { set({ inspectorMode: mode }) },
}))
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/components/workflow-editor/editor-store.ts packages/frontend/package.json pnpm-lock.yaml
git commit -m "feat(frontend): add editor zustand store with history + run state"
```

---

## Task 23: TDD undo/redo history hook

**Files:**
- Create: `packages/frontend/tests/workflow-editor/use-editor-history.test.ts`
- Create: `packages/frontend/src/components/workflow-editor/history/use-editor-history.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/frontend/tests/workflow-editor/use-editor-history.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '@/components/workflow-editor/editor-store'

beforeEach(() => {
  useEditorStore.setState({
    workflowId: 'w1', name: 'W', draft: { nodes: [], edges: [] }, published: null,
    draftUpdatedAt: 0, publishedAt: null, isDirty: false, selection: [],
    history: { past: [], future: [] }, clipboard: null, activeRun: null, inspectorMode: 'config',
  })
})

describe('editor history', () => {
  it('undo restores the previous snapshot', () => {
    const s = useEditorStore.getState()
    s.pushHistory()
    s.setNodes([{ id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    expect(useEditorStore.getState().draft.nodes.length).toBe(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().draft.nodes.length).toBe(0)
  })

  it('redo restores the undone snapshot', () => {
    const s = useEditorStore.getState()
    s.pushHistory()
    s.setNodes([{ id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    s.undo()
    s.redo()
    expect(useEditorStore.getState().draft.nodes.length).toBe(1)
  })

  it('pushing history after an undo clears the future', () => {
    const s = useEditorStore.getState()
    s.pushHistory()
    s.setNodes([{ id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    s.undo()
    s.pushHistory()
    s.setNodes([{ id: 'b', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    expect(useEditorStore.getState().history.future.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run — should PASS (the store already implements undo/redo)**

```bash
cd packages/frontend && pnpm exec vitest run tests/workflow-editor/use-editor-history.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 3: Create the hook wrapper for ergonomic usage**

```ts
// packages/frontend/src/components/workflow-editor/history/use-editor-history.ts
import { useEditorStore } from '../editor-store'

export function useEditorHistory() {
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.history.past.length > 0)
  const canRedo = useEditorStore((s) => s.history.future.length > 0)
  return { pushHistory, undo, redo, canUndo, canRedo }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/tests/workflow-editor/use-editor-history.test.ts \
        packages/frontend/src/components/workflow-editor/history/use-editor-history.ts
git commit -m "feat(workflow-editor): add useEditorHistory + tests"
```

---

## Task 24: TDD copy/paste clipboard hook

**Files:**
- Create: `packages/frontend/tests/workflow-editor/use-editor-clipboard.test.ts`
- Create: `packages/frontend/src/components/workflow-editor/clipboard/use-editor-clipboard.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/frontend/tests/workflow-editor/use-editor-clipboard.test.ts
import { describe, it, expect } from 'vitest'
import { serializeSelection, deserializeSelection } from '@/components/workflow-editor/clipboard/use-editor-clipboard'

describe('clipboard serialization', () => {
  it('serializes only selected nodes and edges where both endpoints are selected', () => {
    const nodes = [
      { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'table', position: { x: 100, y: 0 }, data: {} },
      { id: 'c', type: 'table', position: { x: 200, y: 0 }, data: {} },
    ]
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ]
    const json = serializeSelection(nodes as never, edges as never, ['a', 'b'])
    const parsed = JSON.parse(json)
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b'])
    expect(parsed.edges.map((e: { id: string }) => e.id)).toEqual(['e1'])
  })

  it('rewrites IDs and offsets positions on deserialize', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'table', position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    })
    let n = 0
    const { nodes, edges } = deserializeSelection(json, () => `id-${n++}`, { dx: 20, dy: 20 })
    expect(nodes.map((node) => node.id)).toEqual(['id-0', 'id-1'])
    expect(edges[0].source).toBe('id-0')
    expect(edges[0].target).toBe('id-1')
    expect(nodes[0].position).toEqual({ x: 20, y: 20 })
  })
})
```

- [ ] **Step 2: Run — FAIL**

```bash
cd packages/frontend && pnpm exec vitest run tests/workflow-editor/use-editor-clipboard.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/components/workflow-editor/clipboard/use-editor-clipboard.ts
import type { Edge, Node } from '@xyflow/react'

export function serializeSelection(nodes: Node[], edges: Edge[], selectedIds: string[]): string {
  const set = new Set(selectedIds)
  const selectedNodes = nodes.filter((n) => set.has(n.id))
  const selectedEdges = edges.filter((e) => set.has(e.source) && set.has(e.target))
  return JSON.stringify({ nodes: selectedNodes, edges: selectedEdges })
}

export function deserializeSelection(
  json: string,
  newId: () => string,
  offset: { dx: number; dy: number },
): { nodes: Node[]; edges: Edge[] } {
  const parsed = JSON.parse(json) as { nodes: Node[]; edges: Edge[] }
  const idMap = new Map<string, string>()
  const nodes: Node[] = parsed.nodes.map((n) => {
    const id = newId()
    idMap.set(n.id, id)
    return { ...n, id, position: { x: n.position.x + offset.dx, y: n.position.y + offset.dy }, selected: true }
  })
  const edges: Edge[] = parsed.edges.map((e) => ({
    ...e, id: newId(),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }))
  return { nodes, edges }
}

import { useCallback } from 'react'
import { useEditorStore } from '../editor-store'

export function useEditorClipboard() {
  const draft = useEditorStore((s) => s.draft)
  const selection = useEditorStore((s) => s.selection)
  const setClipboard = useEditorStore((s) => s.setClipboard)
  const clipboard = useEditorStore((s) => s.clipboard)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const setNodes = useEditorStore((s) => s.setNodes)
  const setEdges = useEditorStore((s) => s.setEdges)

  const copy = useCallback(() => {
    if (selection.length === 0) return
    const serialized = serializeSelection(draft.nodes, draft.edges, selection)
    setClipboard(serialized)
    void navigator.clipboard?.writeText(serialized).catch(() => {})
  }, [draft, selection, setClipboard])

  const paste = useCallback(async () => {
    let src = clipboard
    if (!src) {
      try { src = await navigator.clipboard.readText() } catch { return }
      if (!src.startsWith('{')) return
    }
    let counter = Date.now()
    const newId = () => `n${counter++}`
    const { nodes: pastedNodes, edges: pastedEdges } = deserializeSelection(src, newId, { dx: 20, dy: 20 })
    pushHistory()
    setNodes([...draft.nodes, ...pastedNodes])
    setEdges([...draft.edges, ...pastedEdges])
  }, [clipboard, draft, pushHistory, setNodes, setEdges])

  return { copy, paste }
}
```

- [ ] **Step 4: PASS + commit**

```bash
cd packages/frontend && pnpm exec vitest run tests/workflow-editor/use-editor-clipboard.test.ts
git add packages/frontend/src/components/workflow-editor/clipboard/use-editor-clipboard.ts \
        packages/frontend/tests/workflow-editor/use-editor-clipboard.test.ts
git commit -m "feat(workflow-editor): add useEditorClipboard + subgraph (de)serialize"
```

---

## Task 25: Workflows list page

**Files:**
- Create: `packages/frontend/src/pages/workflows.tsx`

- [ ] **Step 1: Build the page**

```tsx
// packages/frontend/src/pages/workflows.tsx
import { useEffect, useState } from 'react'
import { workflowsApi, type WorkflowSummary } from '@/api/workflows'
import { useNavigation } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function WorkflowsPage() {
  const { navigate } = useNavigation()
  const [items, setItems] = useState<WorkflowSummary[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    workflowsApi.list().then((r) => setItems(r.items)).catch((e) => console.error(e))
  }, [])

  async function handleCreate() {
    if (!draftName.trim()) return
    const wf = await workflowsApi.create(draftName.trim())
    setIsCreating(false); setDraftName('')
    navigate({ page: 'workflow-editor', workflowId: wf.id })
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this workflow? Runs will also be removed.')) return
    await workflowsApi.remove(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleRun(id: string) {
    try {
      const r = await workflowsApi.startRun(id)
      navigate({ page: 'workflow-editor', workflowId: id })
      console.log('Run started:', r.runId)
    } catch (e) {
      console.error(e)
    }
  }

  function statusLabel(item: WorkflowSummary): string {
    if (!item.hasPublished) return 'Draft only'
    if (item.draftAhead) return 'Draft ahead of published'
    return 'Up to date'
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-4 flex items-center justify-between'>
        <div>
          <p className='text-xs uppercase tracking-[0.3em] text-[#fd551d]'>Workflows</p>
          <h1 className='mt-2 text-2xl font-semibold tracking-tight'>Your workflows</h1>
        </div>
        <Button onClick={() => setIsCreating(true)}>+ New workflow</Button>
      </div>
      <div className='min-h-0 flex-1 overflow-auto p-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {items.length === 0 ? (
          <p className='text-sm text-muted-foreground col-span-full'>No workflows yet. Click "New workflow" to get started.</p>
        ) : items.map((item) => (
          <div key={item.id} className='rounded-2xl border border-border bg-card p-5 space-y-3'>
            <div>
              <p className='text-base font-medium'>{item.name}</p>
              {item.description ? <p className='text-xs text-muted-foreground'>{item.description}</p> : null}
              <p className='mt-2 text-[11px] uppercase tracking-wider text-muted-foreground'>{statusLabel(item)}</p>
              <p className='text-xs text-muted-foreground'>
                {item.lastRun ? `Last run: ${item.lastRun.status}` : 'Never run'}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' variant='secondary' onClick={() => navigate({ page: 'workflow-editor', workflowId: item.id })}>Open</Button>
              <Button size='sm' disabled={!item.hasPublished} onClick={() => handleRun(item.id)}>Run</Button>
              <Button size='sm' variant='ghost' onClick={() => handleDelete(item.id)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New workflow</DialogTitle></DialogHeader>
          <Input autoFocus placeholder='Workflow name' value={draftName} onChange={(e) => setDraftName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }} />
          <DialogFooter>
            <Button variant='ghost' onClick={() => setIsCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @anubis/frontend typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/workflows.tsx
git commit -m "feat(workflow-editor): add workflows list page"
```

---

## Task 26: Six executable-node renderer wrappers

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/{ai-agent,instagram-post,transformer-media,transformer-brief,ocr-extractor,table}.tsx`

Each wrapper reuses the existing `NodeShell` from `components/workflow/` and surfaces run state (running/succeeded/failed) via the bottom of the card.

- [ ] **Step 1: Shared helper for run-state badge**

Add to the same folder, `_run-state-badge.tsx`:

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/_run-state-badge.tsx
import { StatusBadge } from '@/components/workflow'
import { useEditorStore } from '../editor-store'

export function RunStateBadge({ nodeId }: { nodeId: string }) {
  const step = useEditorStore((s) => s.activeRun?.steps[nodeId])
  if (!step) return null
  if (step.status === 'running')   return <StatusBadge tone='info'>Running…</StatusBadge>
  if (step.status === 'succeeded') return <StatusBadge tone='success'>Succeeded</StatusBadge>
  if (step.status === 'failed')    return <StatusBadge tone='warning'>Failed</StatusBadge>
  if (step.status === 'skipped')   return <StatusBadge>Skipped</StatusBadge>
  return <StatusBadge>Pending</StatusBadge>
}
```

- [ ] **Step 2: AI Agent renderer**

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent.tsx
import { memo } from 'react'
import { Bot } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'

export interface AiAgentNodeData {
  profileId?: string
  reasoning?: 'low' | 'medium' | 'high'
  prompt?: string
}

export const AiAgentExecutableNode = memo(function AiAgentExecutableNode({ id, data }: { id: string; data: AiAgentNodeData }) {
  return (
    <NodeShell
      icon={Bot}
      title='AI Agent'
      subtitle={data.profileId ? `Profile: ${data.profileId}` : 'No profile selected'}
      accent='from-[#fd551d] to-white'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge>{data.reasoning ?? 'medium'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs leading-relaxed text-zinc-300 line-clamp-4'>{data.prompt ?? '<no prompt set>'}</p>
    </NodeShell>
  )
})
```

- [ ] **Step 3: Instagram Post renderer**

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/instagram-post.tsx
import { memo } from 'react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='3' y='3' width='18' height='18' rx='5' />
      <circle cx='12' cy='12' r='4' />
      <circle cx='17.5' cy='6.5' r='0.8' fill='currentColor' stroke='none' />
    </svg>
  )
}

export interface InstagramPostNodeData {
  source?: 'existing' | 'url'
  postId?: string
  url?: string
}

export const InstagramPostExecutableNode = memo(function InstagramPostExecutableNode({ id, data }: { id: string; data: InstagramPostNodeData }) {
  return (
    <NodeShell
      icon={InstagramIcon}
      title='Instagram Post'
      subtitle={data.source === 'url' ? data.url ?? 'No URL' : data.postId ? `Captured: ${data.postId}` : 'No source selected'}
      accent='from-[#fd551d] via-[#ff6b35] to-[#ff9b7a]'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>{data.source ?? 'unset'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-zinc-300'>{data.source === 'url' ? 'Captures via research-crawler' : 'Reads from captured_posts table'}</p>
    </NodeShell>
  )
})
```

- [ ] **Step 4: Transformer Media renderer**

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/transformer-media.tsx
import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'

export interface TransformerMediaNodeData { url?: string }

export const TransformerMediaExecutableNode = memo(function TransformerMediaExecutableNode({ id, data }: { id: string; data: TransformerMediaNodeData }) {
  return (
    <NodeShell
      icon={ImageIcon}
      title='Transformer · Media'
      subtitle={data.url ? `URL: ${data.url}` : 'Pulls upstream media URL'}
      accent='from-[#fd551d] to-[#8b5cf6]'
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-zinc-300'>Downloads to a run artifact</p>
    </NodeShell>
  )
})
```

- [ ] **Step 5: Transformer Brief renderer**

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/transformer-brief.tsx
import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'

export interface TransformerBriefNodeData { jsonTemplate?: string }

export const TransformerBriefExecutableNode = memo(function TransformerBriefExecutableNode({ id, data }: { id: string; data: TransformerBriefNodeData }) {
  return (
    <NodeShell
      icon={FileText}
      title='Transformer · Brief'
      subtitle='Renders JSON template with {{paths}}'
      accent='from-[#fd551d] to-[#ff9b7a]'
      footer={<RunStateBadge nodeId={id} />}
    >
      <pre className='text-[10px] text-zinc-300 whitespace-pre-wrap break-words'>{data.jsonTemplate ?? '<empty template>'}</pre>
    </NodeShell>
  )
})
```

- [ ] **Step 6: OCR Extractor renderer**

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/ocr-extractor.tsx
import { memo } from 'react'
import { Search } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'

export interface OcrExtractorNodeData { imagePath?: string }

export const OcrExtractorExecutableNode = memo(function OcrExtractorExecutableNode({ id, data }: { id: string; data: OcrExtractorNodeData }) {
  return (
    <NodeShell
      icon={Search}
      title='OCR Extractor'
      subtitle={data.imagePath ?? 'Falls back to upstream file path'}
      accent='from-[#fd551d] to-[#3b82f6]'
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-zinc-300'>Extracts text via anubis-extractor</p>
    </NodeShell>
  )
})
```

- [ ] **Step 7: Table renderer**

```tsx
// packages/frontend/src/components/workflow-editor/executable-nodes/table.tsx
import { memo } from 'react'
import { Table as TableIcon } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'

export interface TableNodeData { staticData?: Array<Record<string, unknown>> }

export const TableExecutableNode = memo(function TableExecutableNode({ id, data }: { id: string; data: TableNodeData }) {
  const count = data.staticData?.length ?? 0
  return (
    <NodeShell
      icon={TableIcon}
      title='Table'
      subtitle='Passive — displays input or static rows'
      accent='from-[#fd551d] to-[#22c55e]'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge>{count} static rows</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-zinc-300'>Whatever flows in shows up here.</p>
    </NodeShell>
  )
})
```

- [ ] **Step 8: Aggregate map of executable node types**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`:

```ts
import type { NodeTypes } from '@xyflow/react'
import { AiAgentExecutableNode }          from './ai-agent'
import { InstagramPostExecutableNode }    from './instagram-post'
import { TransformerMediaExecutableNode } from './transformer-media'
import { TransformerBriefExecutableNode } from './transformer-brief'
import { OcrExtractorExecutableNode }     from './ocr-extractor'
import { TableExecutableNode }            from './table'

export const executableNodeTypes: NodeTypes = {
  aiAgent:          AiAgentExecutableNode as never,
  instagramPost:    InstagramPostExecutableNode as never,
  transformerMedia: TransformerMediaExecutableNode as never,
  transformerBrief: TransformerBriefExecutableNode as never,
  ocrExtractor:     OcrExtractorExecutableNode as never,
  table:            TableExecutableNode as never,
}

export const NODE_PALETTE = [
  { type: 'aiAgent',          label: 'AI Agent' },
  { type: 'instagramPost',    label: 'Instagram Post' },
  { type: 'transformerMedia', label: 'Transformer · Media' },
  { type: 'transformerBrief', label: 'Transformer · Brief' },
  { type: 'ocrExtractor',     label: 'OCR Extractor' },
  { type: 'table',            label: 'Table' },
] as const
```

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/components/workflow-editor/executable-nodes/
git commit -m "feat(workflow-editor): add 6 executable node renderers + palette map"
```

---

## Task 27: Editor canvas + palette + connection validation

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/editor-canvas.tsx`
- Create: `packages/frontend/src/components/workflow-editor/node-palette.tsx`

- [ ] **Step 1: Node palette (left sidebar)**

```tsx
// packages/frontend/src/components/workflow-editor/node-palette.tsx
import { NODE_PALETTE } from './executable-nodes'

export function NodePalette() {
  return (
    <aside className='w-48 shrink-0 border-r border-border bg-sidebar p-3'>
      <p className='mb-2 text-[10px] uppercase tracking-wider text-muted-foreground'>Palette</p>
      <div className='space-y-1.5'>
        {NODE_PALETTE.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('application/x-anubis-node', item.type); e.dataTransfer.effectAllowed = 'move' }}
            className='cursor-grab rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-[#fd551d]/40'
          >
            {item.label}
          </div>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Editor canvas with drag-from-palette + cycle-rejecting connection validation**

```tsx
// packages/frontend/src/components/workflow-editor/editor-canvas.tsx
import { useCallback } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow,
  type Connection, type Edge, type Node, type OnConnect, type OnEdgesChange, type OnNodesChange,
  applyEdgeChanges, applyNodeChanges, addEdge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { workflowEdgeTypes } from '@/components/workflow'
import { applyVisualEdgeRouting } from '@/components/workflow'
import { executableNodeTypes } from './executable-nodes'
import { useEditorStore } from './editor-store'

function wouldCreateCycle(nodes: Node[], edges: Edge[], candidate: Connection): boolean {
  if (!candidate.source || !candidate.target) return false
  if (candidate.source === candidate.target) return true
  const next = [...edges, { id: 'tmp', source: candidate.source, target: candidate.target } as Edge]
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of next) (adj.get(e.source) ?? []).push(e.target)
  // BFS from target — if we reach source, there's a cycle
  const queue: string[] = [candidate.target]
  const seen = new Set<string>()
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === candidate.source) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    queue.push(...(adj.get(cur) ?? []))
  }
  return false
}

export function EditorCanvas() {
  const nodes = useEditorStore((s) => s.draft.nodes)
  const edges = useEditorStore((s) => s.draft.edges)
  const setNodes = useEditorStore((s) => s.setNodes)
  const setEdges = useEditorStore((s) => s.setEdges)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const setSelection = useEditorStore((s) => s.setSelection)

  const onNodesChange: OnNodesChange = useCallback((changes) => {
    setNodes(applyNodeChanges(changes, nodes))
    setSelection(applyNodeChanges(changes, nodes).filter((n) => n.selected).map((n) => n.id))
  }, [nodes, setNodes, setSelection])

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEdges(applyEdgeChanges(changes, edges))
  }, [edges, setEdges])

  const onConnect: OnConnect = useCallback((conn) => {
    if (wouldCreateCycle(nodes, edges, conn)) return
    pushHistory()
    setEdges(addEdge({ ...conn, id: `e-${Date.now()}`, type: 'separated' }, edges))
  }, [nodes, edges, setEdges, pushHistory])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-anubis-node')) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-anubis-node')
    if (!type) return
    const bounds = (e.target as HTMLElement).getBoundingClientRect()
    pushHistory()
    const id = `n-${Date.now()}`
    const newNode: Node = {
      id, type, position: { x: e.clientX - bounds.left, y: e.clientY - bounds.top }, data: {},
    }
    setNodes([...nodes, newNode])
  }, [nodes, setNodes, pushHistory])

  const routedEdges = applyVisualEdgeRouting(edges)

  return (
    <div className='relative h-full w-full bg-[#0b0b0c]' onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={routedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={executableNodeTypes}
        edgeTypes={workflowEdgeTypes}
        selectionOnDrag
        panOnDrag={[1, 2]}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color='rgba(253, 85, 29, 0.16)' />
        <Controls className='!border-[#fd551d]/20 !bg-[#161617]/90 !text-white' />
        <MiniMap pannable zoomable nodeStrokeWidth={3}
          className='!border !border-[#fd551d]/20 !bg-[#161617]/90' maskColor='rgba(0,0,0,0.55)' />
      </ReactFlow>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/components/workflow-editor/editor-canvas.tsx \
        packages/frontend/src/components/workflow-editor/node-palette.tsx
git commit -m "feat(workflow-editor): editor canvas + node palette with drag-to-add + cycle rejection"
```

---

## Task 28: Inspector panel + 6 config forms

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`
- Create: `packages/frontend/src/components/workflow-editor/inspector/run-viewer.tsx`
- Create: `packages/frontend/src/components/workflow-editor/inspector/config/*.tsx` (6 files)

- [ ] **Step 1: Inspector panel shell**

```tsx
// packages/frontend/src/components/workflow-editor/inspector-panel.tsx
import { useEditorStore } from './editor-store'
import { AiAgentConfigForm }          from './inspector/config/ai-agent-config'
import { InstagramPostConfigForm }    from './inspector/config/instagram-post-config'
import { TransformerMediaConfigForm } from './inspector/config/transformer-media-config'
import { TransformerBriefConfigForm } from './inspector/config/transformer-brief-config'
import { OcrExtractorConfigForm }     from './inspector/config/ocr-extractor-config'
import { TableConfigForm }            from './inspector/config/table-config'
import { RunViewer } from './inspector/run-viewer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CONFIG_FORMS: Record<string, React.FC<{ nodeId: string }>> = {
  aiAgent:          AiAgentConfigForm,
  instagramPost:    InstagramPostConfigForm,
  transformerMedia: TransformerMediaConfigForm,
  transformerBrief: TransformerBriefConfigForm,
  ocrExtractor:     OcrExtractorConfigForm,
  table:            TableConfigForm,
}

export function InspectorPanel() {
  const selection = useEditorStore((s) => s.selection)
  const draft     = useEditorStore((s) => s.draft)
  const name      = useEditorStore((s) => s.name)
  const setName   = useEditorStore((s) => s.setName)
  const mode      = useEditorStore((s) => s.inspectorMode)
  const setMode   = useEditorStore((s) => s.setInspectorMode)
  const activeRun = useEditorStore((s) => s.activeRun)
  const setNodes  = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)

  const selectedNodes = draft.nodes.filter((n) => selection.includes(n.id))

  function handleBulkDelete() {
    pushHistory()
    setNodes(draft.nodes.filter((n) => !selection.includes(n.id)))
  }

  return (
    <aside className='w-[360px] shrink-0 border-l border-border bg-sidebar p-4 overflow-auto'>
      {activeRun ? (
        <div className='mb-3 flex items-center justify-between'>
          <p className='text-xs uppercase tracking-wider text-muted-foreground'>Mode</p>
          <div className='flex gap-1'>
            <Button size='sm' variant={mode === 'config' ? 'default' : 'ghost'} onClick={() => setMode('config')}>Config</Button>
            <Button size='sm' variant={mode === 'run' ? 'default' : 'ghost'} onClick={() => setMode('run')}>Run</Button>
          </div>
        </div>
      ) : null}

      {mode === 'run' && activeRun ? (
        <RunViewer />
      ) : selectedNodes.length === 0 ? (
        <div className='space-y-3'>
          <p className='text-xs uppercase tracking-wider text-muted-foreground'>Workflow</p>
          <label className='block text-xs'>Name
            <Input className='mt-1' value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
      ) : selectedNodes.length > 1 ? (
        <div className='space-y-3'>
          <p className='text-sm font-medium'>{selectedNodes.length} nodes selected</p>
          <Button size='sm' variant='destructive' onClick={handleBulkDelete}>Delete selection</Button>
        </div>
      ) : (() => {
        const node = selectedNodes[0]
        const Form = CONFIG_FORMS[node.type ?? '']
        if (!Form) return <p className='text-xs text-muted-foreground'>No config form for type "{node.type}"</p>
        return <Form nodeId={node.id} />
      })()}
    </aside>
  )
}
```

- [ ] **Step 2: AI Agent config form**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/config/ai-agent-config.tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listProfiles } from '@/api'

export function AiAgentConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)!
  const data = node.data as { profileId?: string; reasoning?: 'low' | 'medium' | 'high'; prompt?: string }
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => { listProfiles().then((r) => setProfiles(r.items.map((p) => ({ id: p.id, name: p.name })))).catch(console.error) }, [])

  function update(patch: Partial<typeof data>) {
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>AI Agent</p>
      <label className='block text-xs'>Profile
        <Select value={data.profileId ?? ''} onValueChange={(v) => update({ profileId: v })}>
          <SelectTrigger className='mt-1'><SelectValue placeholder='Pick a profile' /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Reasoning
        <Select value={data.reasoning ?? 'medium'} onValueChange={(v) => update({ reasoning: v as never })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='low'>low</SelectItem>
            <SelectItem value='medium'>medium</SelectItem>
            <SelectItem value='high'>high</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Prompt
        <Textarea className='mt-1' rows={6} value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} />
      </label>
    </div>
  )
}
```

(If `listProfiles` doesn't exist in the frontend `@/api` module, add a thin wrapper in `packages/frontend/src/api.ts` that calls `GET /profiles` — pattern matches the existing exports.)

- [ ] **Step 3: Instagram Post config form**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/config/instagram-post-config.tsx
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function InstagramPostConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)!
  const data = node.data as { source?: 'existing' | 'url'; postId?: string; url?: string }

  function update(patch: Partial<typeof data>) {
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Instagram Post</p>
      <label className='block text-xs'>Source
        <Select value={data.source ?? 'existing'} onValueChange={(v) => update({ source: v as never })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='existing'>Existing captured post</SelectItem>
            <SelectItem value='url'>URL (will trigger crawler)</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {data.source === 'url' ? (
        <label className='block text-xs'>URL
          <Input className='mt-1' value={data.url ?? ''} onChange={(e) => update({ url: e.target.value })} placeholder='https://instagram.com/p/...' />
        </label>
      ) : (
        <label className='block text-xs'>Captured Post ID
          <Input className='mt-1' value={data.postId ?? ''} onChange={(e) => update({ postId: e.target.value })} />
        </label>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Transformer Media config form**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/config/transformer-media-config.tsx
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'

export function TransformerMediaConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)!
  const data = node.data as { url?: string }

  function update(patch: Partial<typeof data>) {
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Transformer · Media</p>
      <label className='block text-xs'>URL override (optional)
        <Input className='mt-1' value={data.url ?? ''} onChange={(e) => update({ url: e.target.value })} placeholder='Falls back to upstream' />
      </label>
    </div>
  )
}
```

- [ ] **Step 5: Transformer Brief config form**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/config/transformer-brief-config.tsx
import { useEditorStore } from '../../editor-store'
import { Textarea } from '@/components/ui/textarea'

export function TransformerBriefConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)!
  const data = node.data as { jsonTemplate?: string }

  function update(patch: Partial<typeof data>) {
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Transformer · Brief</p>
      <label className='block text-xs'>JSON template
        <Textarea className='mt-1' rows={10} value={data.jsonTemplate ?? ''} onChange={(e) => update({ jsonTemplate: e.target.value })}
                  placeholder={'{\n  "topic": "{{n1.text}}"\n}'} />
      </label>
    </div>
  )
}
```

- [ ] **Step 6: OCR Extractor config form**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/config/ocr-extractor-config.tsx
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'

export function OcrExtractorConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)!
  const data = node.data as { imagePath?: string }

  function update(patch: Partial<typeof data>) {
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>OCR Extractor</p>
      <label className='block text-xs'>Image path (optional)
        <Input className='mt-1' value={data.imagePath ?? ''} onChange={(e) => update({ imagePath: e.target.value })} placeholder='Falls back to upstream file path' />
      </label>
    </div>
  )
}
```

- [ ] **Step 7: Table config form**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/config/table-config.tsx
import { useEditorStore } from '../../editor-store'
import { Textarea } from '@/components/ui/textarea'

export function TableConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)!
  const data = node.data as { staticData?: Array<Record<string, unknown>> }

  function update(text: string) {
    pushHistory()
    let parsed: Array<Record<string, unknown>> | undefined
    try {
      const v = JSON.parse(text)
      parsed = Array.isArray(v) ? v : undefined
    } catch { parsed = undefined }
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, staticData: parsed } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Table</p>
      <label className='block text-xs'>Static rows (JSON array, used when no upstream)
        <Textarea className='mt-1' rows={8} defaultValue={JSON.stringify(data.staticData ?? [], null, 2)} onBlur={(e) => update(e.target.value)} />
      </label>
    </div>
  )
}
```

- [ ] **Step 8: Run viewer**

```tsx
// packages/frontend/src/components/workflow-editor/inspector/run-viewer.tsx
import { useEditorStore } from '../editor-store'

export function RunViewer() {
  const selection = useEditorStore((s) => s.selection)
  const activeRun = useEditorStore((s) => s.activeRun)
  if (!activeRun) return <p className='text-xs text-muted-foreground'>No active run.</p>
  if (selection.length !== 1) return <p className='text-xs text-muted-foreground'>Select a node to inspect its run output.</p>
  const nodeId = selection[0]
  const step = activeRun.steps[nodeId]
  if (!step) return <p className='text-xs text-muted-foreground'>This node has no run state yet.</p>

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Run · {nodeId}</p>
      <p className='text-sm'>Status: <b>{step.status}</b></p>
      {step.startedAt ? <p className='text-xs'>Started: {new Date(step.startedAt).toLocaleTimeString()}</p> : null}
      {step.finishedAt ? <p className='text-xs'>Finished: {new Date(step.finishedAt).toLocaleTimeString()}</p> : null}
      {step.error ? (
        <pre className='whitespace-pre-wrap rounded-md bg-red-500/10 p-2 text-[11px] text-red-200'>{step.error}</pre>
      ) : null}
      {step.output != null ? (
        <pre className='whitespace-pre-wrap rounded-md bg-white/[0.04] p-2 text-[11px] text-zinc-200'>{JSON.stringify(step.output, null, 2)}</pre>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/components/workflow-editor/inspector-panel.tsx \
        packages/frontend/src/components/workflow-editor/inspector/
git commit -m "feat(workflow-editor): inspector panel + 6 config forms + run viewer"
```

---

## Task 29: Editor page wrapper — orchestrates layout + hydration + autosave + keymap

**Files:**
- Create: `packages/frontend/src/pages/workflow-editor.tsx`
- Create: `packages/frontend/src/components/workflow-editor/autosave.ts`
- Create: `packages/frontend/src/components/workflow-editor/keymap.ts`

- [ ] **Step 1: Autosave hook (debounced draft writeback)**

```ts
// packages/frontend/src/components/workflow-editor/autosave.ts
import { useEffect, useRef } from 'react'
import { workflowsApi } from '@/api/workflows'
import { useEditorStore } from './editor-store'

const DEBOUNCE_MS = 800

export function useAutosaveDraft() {
  const workflowId = useEditorStore((s) => s.workflowId)
  const draft = useEditorStore((s) => s.draft)
  const name = useEditorStore((s) => s.name)
  const isDirty = useEditorStore((s) => s.isDirty)
  const markSaved = useEditorStore((s) => s.markSaved)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!workflowId || !isDirty) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        await workflowsApi.saveDraft(workflowId, JSON.stringify(draft))
        await workflowsApi.patchMeta(workflowId, { name })
        markSaved(Date.now())
      } catch (e) {
        console.error('autosave failed', e)
      }
    }, DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [draft, name, workflowId, isDirty, markSaved])
}
```

- [ ] **Step 2: Keymap hook**

```ts
// packages/frontend/src/components/workflow-editor/keymap.ts
import { useEffect } from 'react'
import { useEditorStore } from './editor-store'
import { useEditorClipboard } from './clipboard/use-editor-clipboard'
import { workflowsApi } from '@/api/workflows'

export function useEditorKeymap() {
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const selection = useEditorStore((s) => s.selection)
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const setEdges = useEditorStore((s) => s.setEdges)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const workflowId = useEditorStore((s) => s.workflowId)
  const markSaved = useEditorStore((s) => s.markSaved)
  const markPublished = useEditorStore((s) => s.markPublished)
  const name = useEditorStore((s) => s.name)
  const { copy, paste } = useEditorClipboard()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const cmd = e.ctrlKey || e.metaKey

      if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((cmd && e.key.toLowerCase() === 'y') || (cmd && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); return }
      if (cmd && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); return }
      if (cmd && e.key.toLowerCase() === 'v') { e.preventDefault(); void paste(); return }
      if (cmd && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault()
        if (!workflowId) return
        workflowsApi.saveDraft(workflowId, JSON.stringify(draft)).then(() => workflowsApi.patchMeta(workflowId, { name })).then(() => markSaved(Date.now())).catch(console.error)
        return
      }
      if (cmd && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!workflowId) return
        workflowsApi.publish(workflowId).then((wf) => {
          if (wf.publishedAt) markPublished(wf.publishedAt, JSON.parse(wf.publishedGraph ?? '{"nodes":[],"edges":[]}'))
        }).catch(console.error)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.length === 0) return
        e.preventDefault()
        pushHistory()
        setNodes(draft.nodes.filter((n) => !selection.includes(n.id)))
        setEdges(draft.edges.filter((e) => !selection.includes(e.source) && !selection.includes(e.target)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, copy, paste, selection, draft, setNodes, setEdges, pushHistory, workflowId, markSaved, markPublished, name])
}
```

- [ ] **Step 3: Editor page**

```tsx
// packages/frontend/src/pages/workflow-editor.tsx
import { useEffect, useState } from 'react'
import { workflowsApi, openRunEventStream } from '@/api/workflows'
import { useNavigation } from '@/lib/navigation'
import { useEditorStore } from '@/components/workflow-editor/editor-store'
import { useAutosaveDraft } from '@/components/workflow-editor/autosave'
import { useEditorKeymap } from '@/components/workflow-editor/keymap'
import { NodePalette } from '@/components/workflow-editor/node-palette'
import { EditorCanvas } from '@/components/workflow-editor/editor-canvas'
import { InspectorPanel } from '@/components/workflow-editor/inspector-panel'
import { Button } from '@/components/ui/button'
import { ReactFlowProvider } from '@xyflow/react'

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const { navigate } = useNavigation()
  const hydrate       = useEditorStore((s) => s.hydrate)
  const name          = useEditorStore((s) => s.name)
  const isDirty       = useEditorStore((s) => s.isDirty)
  const publishedAt   = useEditorStore((s) => s.publishedAt)
  const setActiveRun  = useEditorStore((s) => s.setActiveRun)
  const applyRunEvent = useEditorStore((s) => s.applyRunEvent)
  const activeRun     = useEditorStore((s) => s.activeRun)
  const markPublished = useEditorStore((s) => s.markPublished)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    workflowsApi.get(workflowId).then((wf) => {
      hydrate({
        workflowId: wf.id, name: wf.name, description: wf.description,
        draft: JSON.parse(wf.draftGraph),
        published: wf.publishedGraph ? JSON.parse(wf.publishedGraph) : null,
        draftUpdatedAt: wf.draftUpdatedAt, publishedAt: wf.publishedAt ?? null,
      })
    }).catch((e) => setError(String(e)))
  }, [workflowId, hydrate])

  useAutosaveDraft()
  useEditorKeymap()

  async function publish() {
    try {
      const wf = await workflowsApi.publish(workflowId)
      if (wf.publishedAt) markPublished(wf.publishedAt, JSON.parse(wf.publishedGraph ?? '{"nodes":[],"edges":[]}'))
    } catch (e) { setError(String(e)) }
  }

  async function startRun() {
    try {
      const { runId } = await workflowsApi.startRun(workflowId)
      setActiveRun({ runId, steps: {}, status: 'running' })
      await openRunEventStream(runId, (ev) => applyRunEvent(ev as never))
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-3 flex items-center justify-between gap-4'>
        <Button size='sm' variant='ghost' onClick={() => navigate({ page: 'workflows' })}>← Workflows</Button>
        <p className='text-sm font-medium truncate'>{name}{isDirty ? ' •' : ''}</p>
        <div className='flex gap-2'>
          <Button size='sm' variant='secondary' onClick={publish}>{publishedAt ? 'Re-publish' : 'Publish'}</Button>
          <Button size='sm' onClick={startRun} disabled={!publishedAt || activeRun?.status === 'running'}>▶ Run published</Button>
        </div>
      </div>
      {error ? <p className='px-6 py-2 text-xs text-red-300'>{error}</p> : null}
      <div className='flex min-h-0 flex-1'>
        <NodePalette />
        <div className='flex-1 min-w-0'>
          <ReactFlowProvider><EditorCanvas /></ReactFlowProvider>
        </div>
        <InspectorPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @anubis/frontend typecheck
git add packages/frontend/src/pages/workflow-editor.tsx \
        packages/frontend/src/components/workflow-editor/autosave.ts \
        packages/frontend/src/components/workflow-editor/keymap.ts
git commit -m "feat(workflow-editor): page wrapper + autosave + keymap + run wiring"
```

---

## Task 30: Wire routes — navigation + dashboard + sidebar

**Files:**
- Modify: `packages/frontend/src/lib/navigation.tsx`
- Modify: `packages/frontend/src/components/dashboard/index.tsx`
- Modify: `packages/frontend/src/components/dashboard/sidebar.tsx`
- Modify: `packages/frontend/src/components/dashboard/data.ts`

- [ ] **Step 1: Extend Route union**

In `packages/frontend/src/lib/navigation.tsx`, replace the existing `'workflow-demo'` entry with:

```ts
  | { page: 'workflows' }
  | { page: 'workflow-editor'; workflowId: string }
  | { page: 'workflow-demo' }     // keep — still reachable internally
```

- [ ] **Step 2: Replace sidebar entry in `data.ts`**

In the `navItems` array, replace:

```ts
{ label: 'Workflow demo', icon: WorkflowIcon, page: 'workflow-demo' },
```

with:

```ts
{ label: 'Workflows', icon: WorkflowIcon, page: 'workflows' },
```

- [ ] **Step 3: Sidebar — add case for `'workflows'`**

In `sidebar.tsx`'s `itemRoute`, add (replacing the previous `case 'workflow-demo'`):

```ts
case 'workflows':
  return { page: 'workflows' }
```

- [ ] **Step 4: Dashboard — imports + BREADCRUMBS + switch**

In `packages/frontend/src/components/dashboard/index.tsx`:

- Replace the workflow-demo import with both pages:
  ```ts
  import { WorkflowsPage } from '@/pages/workflows'
  import { WorkflowEditorPage } from '@/pages/workflow-editor'
  import { WorkflowDemoPage } from '@/components/workflow'   // keep for /workflow-demo
  ```
- Update the `BREADCRUMBS` object — replace the existing `'workflow-demo': 'Workflow demo'` entry with all three:
  ```ts
  workflows: 'Workflows',
  'workflow-editor': 'Workflows · Editor',
  'workflow-demo': 'Workflow demo',
  ```
- In the `CurrentPage` switch, replace the `'workflow-demo'` case with all three:
  ```ts
  case 'workflows':
    return <WorkflowsPage />
  case 'workflow-editor':
    return <WorkflowEditorPage workflowId={route.workflowId} />
  case 'workflow-demo':
    return <WorkflowDemoPage />
  ```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @anubis/frontend typecheck
```
Expected: PASS. (TypeScript exhaustiveness on `Record<PageKey, string>` ensures `BREADCRUMBS` covers every route variant.)

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/navigation.tsx \
        packages/frontend/src/components/dashboard/data.ts \
        packages/frontend/src/components/dashboard/sidebar.tsx \
        packages/frontend/src/components/dashboard/index.tsx
git commit -m "feat(workflow): wire workflows + workflow-editor routes"
```

---

## Task 31: Final verification — workspace tests + manual smoke

**Files:** none modified.

- [ ] **Step 1: Build the workflow-runtime package (consumed by backend)**

```bash
pnpm --filter @anubis/workflow-runtime build
```

- [ ] **Step 2: Workspace typecheck**

```bash
pnpm typecheck
```
Expected: PASS for all 9 packages.

- [ ] **Step 3: Run full test suite (root)**

```bash
pnpm test
```
Expected: PASS — includes the new workflow-runtime tests (graph, runner, 6 executors), backend workflow smoke, and frontend editor unit tests.

- [ ] **Step 4: Manual smoke (desktop dev loop)**

Run: `pnpm dev` from the repo root.

Verify:
1. App opens, "Workflows" appears in the sidebar.
2. Click Workflows → empty list page → click "+ New workflow" → enter name → editor opens.
3. Drag an `AI Agent` onto the canvas; drag a `Table` onto the canvas; connect AI Agent → Table.
4. Click the AI Agent node → inspector populates with profile/reasoning/prompt; pick a profile, write a short prompt.
5. Click Publish (Ctrl+Shift+S also works). Sidebar status updates.
6. Click "▶ Run published". Right panel switches to Run mode; clicking each node shows its run state (running → succeeded) as events stream in.
7. After completion, click the Table node → its `output` JSON renders.
8. Test cancellation: start another run, click cancel via `DELETE /workflows/runs/:runId` (use devtools to call `workflowsApi.cancelRun(runId)` if no UI button) and confirm run status updates.

- [ ] **Step 5: Stop short of committing any manual-smoke artifacts**

If `App.tsx` was temporarily modified to skip directly into the editor for testing, revert with `git checkout -- packages/frontend/src/App.tsx`. `git status` should be clean.

---

## Self-review checklist

This plan was checked against the spec after writing:

- **Spec coverage** — every spec section maps to a task:
  - Migration + tables (spec §Database schema) → Task 1.
  - Repos + ConversationStack wiring (spec §Architecture, §Integration) → Tasks 2, 3, 4.
  - workflow-runtime package layout (spec §File layout, §Execution engine) → Tasks 5, 6, 7, 14, 15.
  - Six executors (spec §The 6 executors) → Tasks 8–13.
  - Backend run manager + routes + SSE (spec §Backend routes, §Data flow, §Error handling) → Tasks 16, 17, 18, 19, 20.
  - Frontend API client (spec §Data flow) → Task 21.
  - Zustand store (spec §Editor state) → Task 22.
  - Tier 3 editor behaviors — undo/redo, copy/paste (spec §Tier 3 editor behaviors) → Tasks 23, 24.
  - Workflow list (spec §List page) → Task 25.
  - Six executable node renderers (spec §Integration with existing code) → Task 26.
  - Editor canvas + palette + connection validation (spec §Tier 3 editor behaviors) → Task 27.
  - Inspector panel dual-mode + 6 config forms + run viewer (spec §Inspector panel) → Task 28.
  - Editor page wrapper + autosave + keymap + run wiring (spec §Tier 3 editor behaviors, §Data flow) → Task 29.
  - Sidebar swap + routing (spec §Sidebar changes) → Task 30.
  - Verification (spec §Testing strategy) → Task 31.

- **Placeholder scan** — every step contains the exact code or command. No TBD/TODO.

- **Type consistency** — `WorkflowGraph` / `WorkflowGraphSchema` are defined in Task 6 and used in Tasks 16, 18, 27. `Executor` shape is defined in Task 6 and obeyed by Tasks 8–13. `ExecutorContext.db.getCapturedPost` is added in Task 6's types and supplied in Task 16's run manager. Frontend `NodeRunEvent` type matches backend's emit-event shape (Task 21 mirrors Task 6's `NodeRunEvent` + `RunLifecycleEvent` shapes via the API client). `workflowsApi.saveDraft` (Task 21) is used by Tasks 25, 29 and matches the backend `PUT /workflows/:id/draft` route (Task 18).
