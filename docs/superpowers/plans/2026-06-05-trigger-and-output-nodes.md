# Trigger & Output Workflow Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two Output display nodes (Markdown, Media) and the entire Trigger category (Schedule, File-watcher) — fully wired so a trigger fires `WorkflowRunManager.start()` on its own — to the workflow editor and runtime.

**Architecture:** Output nodes are passthrough executors + terminal (input-only) display components, following the existing 3-registry node pattern. Triggers add: runtime payload-injection into `runWorkflow`, a `TriggerManager` backend singleton (parallel to `WorkflowRunManager`) that owns interval/cron timers (node-cron) and a chokidar file watcher, a `workflow_triggers` table for restart recovery, arm/disarm HTTP routes, and an Arm/Disarm toggle that replaces the Run button when a published graph contains a trigger node.

**Tech Stack:** TypeScript ESM monorepo, Zod, React 19 + React Flow (`@xyflow/react`), Zustand, Hono, better-sqlite3, node-cron (already a transitive dep), chokidar (new backend dep), vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-trigger-and-output-nodes-design.md`

**Phasing:** Phase 1 (Output nodes) is independently shippable and has no backend changes — complete and verify it before starting Phase 2+. Phases 2–6 build Triggers.

**Per-package commands:**
- Runtime tests: `pnpm vitest run packages/workflow-runtime/tests/<file>`
- Backend tests: `pnpm --filter @anubis/backend test`
- Frontend typecheck: `pnpm --filter @anubis/frontend typecheck`
- Build a package: `pnpm --filter @anubis/<pkg> build`

**Conventions to follow:** Imports inside `@anubis/workflow-runtime` and `@anubis/conversation` use explicit `.js` extensions on relative paths. All packages are ESM.

---

## File Structure

**Phase 1 — Output nodes**
- Create `packages/workflow-runtime/src/executors/markdown-display.ts` — passthrough → `{ kind:'markdown', text }`
- Create `packages/workflow-runtime/src/executors/media-display.ts` — passthrough → `{ kind:'file', path, mimeType? }`
- Modify `packages/workflow-runtime/src/executors/index.ts` — register both
- Create `packages/workflow-runtime/tests/executors/output-display.test.ts`
- Modify `packages/frontend/src/components/workflow/handles.tsx` — `variant` on `NodeDirectionalHandles`
- Modify `packages/frontend/src/components/workflow/node-shell.tsx` — `handles` prop
- Create `packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx`
- Create `packages/frontend/src/components/workflow-editor/executable-nodes/media-display.tsx`
- Create `packages/frontend/src/components/workflow-editor/inspector/config/markdown-display-config.tsx`
- Modify `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts` — register + palette
- Modify `packages/frontend/src/components/workflow-editor/inspector-panel.tsx` — register config forms

**Phase 2 — Runtime trigger support**
- Modify `packages/workflow-runtime/src/runner.ts` — `opts.seed` injection
- Create `packages/workflow-runtime/src/executors/schedule-trigger.ts`
- Create `packages/workflow-runtime/src/executors/file-watch-trigger.ts`
- Modify `packages/workflow-runtime/src/executors/index.ts` — register both
- Modify `packages/workflow-runtime/src/index.ts` — export the new executors/types
- Create `packages/workflow-runtime/tests/runner-seed.test.ts`
- Create `packages/workflow-runtime/tests/executors/trigger-executors.test.ts`

**Phase 3 — Persistence**
- Create `packages/conversation/src/db/migrations/006_workflow_triggers.sql`
- Modify `packages/conversation/src/db/migrations/index.ts` — register migration
- Create `packages/conversation/src/db/repositories/workflow-triggers-repo.ts`
- Modify `packages/conversation/src/index.ts` — wire repo into stack + export

**Phase 4 — Backend TriggerManager + wiring**
- Modify `packages/backend/package.json` — add `chokidar`, `node-cron`
- Modify `packages/backend/src/workflow-run-manager.ts` — `start(workflowId, triggerContext?)`
- Create `packages/backend/src/trigger-manager.ts`
- Modify `packages/backend/src/workflow.ts` — routes + manager singleton + boot/shutdown exports + summary fields
- Modify `packages/backend/src/server.ts` — boot rearm + shutdown
- Create `packages/backend/tests/workflow-triggers.test.ts`

**Phase 5 — Frontend trigger UI**
- Create `packages/frontend/src/components/workflow-editor/executable-nodes/schedule-trigger.tsx`
- Create `packages/frontend/src/components/workflow-editor/executable-nodes/file-watch-trigger.tsx`
- Create `packages/frontend/src/components/workflow-editor/inspector/config/schedule-trigger-config.tsx`
- Create `packages/frontend/src/components/workflow-editor/inspector/config/file-watch-trigger-config.tsx`
- Modify `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts` — register + palette
- Modify `packages/frontend/src/components/workflow-editor/inspector-panel.tsx` — register config forms
- Modify `packages/frontend/src/api/workflows.ts` — `arm`/`disarm` + types
- Modify `packages/frontend/src/pages/workflow-editor.tsx` — Arm/Disarm toggle

---

## Phase 1 — Output nodes

### Task 1.1: Markdown & Media display executors (runtime)

**Files:**
- Create: `packages/workflow-runtime/src/executors/markdown-display.ts`
- Create: `packages/workflow-runtime/src/executors/media-display.ts`
- Modify: `packages/workflow-runtime/src/executors/index.ts`
- Test: `packages/workflow-runtime/tests/executors/output-display.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/executors/output-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { markdownDisplayExecutor } from '../../src/executors/markdown-display.js'
import { mediaDisplayExecutor } from '../../src/executors/media-display.js'

const ctx = {} as never
const base = { nodeId: 'n1', downstream: [] as Array<{ nodeId: string; type: string }> }

describe('markdownDisplayExecutor', () => {
  it('passes through upstream text', async () => {
    const out = await markdownDisplayExecutor.run(
      { ...base, config: {}, upstream: { up: { text: '# Hello' } } }, ctx,
    )
    expect(out).toEqual({ kind: 'markdown', text: '# Hello' })
  })

  it('accepts a bare upstream string', async () => {
    const out = await markdownDisplayExecutor.run(
      { ...base, config: {}, upstream: { up: 'plain' } }, ctx,
    )
    expect(out).toEqual({ kind: 'markdown', text: 'plain' })
  })

  it('falls back to static text when no upstream text', async () => {
    const out = await markdownDisplayExecutor.run(
      { ...base, config: { staticText: 'fallback' }, upstream: {} }, ctx,
    )
    expect(out).toEqual({ kind: 'markdown', text: 'fallback' })
  })
})

describe('mediaDisplayExecutor', () => {
  it('passes through the first upstream file', async () => {
    const out = await mediaDisplayExecutor.run(
      { ...base, config: {}, upstream: { up: { kind: 'file', path: '/a/b.png', mimeType: 'image/png' } } }, ctx,
    )
    expect(out).toEqual({ kind: 'file', path: '/a/b.png', mimeType: 'image/png' })
  })

  it('throws when no file is found upstream', async () => {
    await expect(
      mediaDisplayExecutor.run({ ...base, config: {}, upstream: { up: { text: 'nope' } } }, ctx),
    ).rejects.toThrow(/no file/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/output-display.test.ts`
Expected: FAIL — cannot find `../../src/executors/markdown-display.js` / `media-display.js`.

- [ ] **Step 3: Implement `markdown-display.ts`**

Create `packages/workflow-runtime/src/executors/markdown-display.ts`:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  staticText: z.string().optional(),
})

export type MarkdownDisplayConfig = z.infer<typeof ConfigSchema>

function findFirstText(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const t = (value as { text?: unknown }).text
      if (typeof t === 'string') return t
    }
  }
  return null
}

export const markdownDisplayExecutor: Executor<MarkdownDisplayConfig> = {
  type: 'markdownDisplay',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const text = findFirstText(input.upstream) ?? input.config.staticText ?? ''
    return { kind: 'markdown', text }
  },
}
```

- [ ] **Step 4: Implement `media-display.ts`**

Create `packages/workflow-runtime/src/executors/media-display.ts`:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({})

export type MediaDisplayConfig = z.infer<typeof ConfigSchema>

interface FileValue { kind?: string; path?: unknown; mimeType?: unknown }

function findFirstFile(upstream: Record<string, unknown>): { path: string; mimeType?: string } | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const v = value as FileValue
      if (v.kind === 'file' && typeof v.path === 'string') {
        return { path: v.path, mimeType: typeof v.mimeType === 'string' ? v.mimeType : undefined }
      }
    }
  }
  return null
}

export const mediaDisplayExecutor: Executor<MediaDisplayConfig> = {
  type: 'mediaDisplay',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const file = findFirstFile(input.upstream)
    if (!file) throw new Error('mediaDisplay: no file found upstream')
    return { kind: 'file', path: file.path, ...(file.mimeType ? { mimeType: file.mimeType } : {}) }
  },
}
```

- [ ] **Step 5: Register both in the executor registry**

In `packages/workflow-runtime/src/executors/index.ts`, add imports after the existing executor imports and entries to `executorRegistry` + the re-export block:

```ts
import { markdownDisplayExecutor }      from './markdown-display.js'
import { mediaDisplayExecutor }         from './media-display.js'
```

Add to `executorRegistry`:

```ts
  markdownDisplay:      markdownDisplayExecutor as Executor<unknown>,
  mediaDisplay:         mediaDisplayExecutor as Executor<unknown>,
```

Add to the bottom `export { ... }` list: `markdownDisplayExecutor, mediaDisplayExecutor`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/output-display.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-runtime/src/executors/markdown-display.ts packages/workflow-runtime/src/executors/media-display.ts packages/workflow-runtime/src/executors/index.ts packages/workflow-runtime/tests/executors/output-display.test.ts
git commit -m "feat(workflow-runtime): markdown + media display executors"
```

---

### Task 1.2: NodeShell handle variants (input-only / output-only)

`NodeShell` always renders both IN and OUT handles. Output nodes need IN-only; later triggers need OUT-only.

**Files:**
- Modify: `packages/frontend/src/components/workflow/handles.tsx`
- Modify: `packages/frontend/src/components/workflow/node-shell.tsx`

- [ ] **Step 1: Add a `variant` to `NodeDirectionalHandles`**

In `packages/frontend/src/components/workflow/handles.tsx`, replace the `NodeDirectionalHandles` function:

```tsx
export type HandleVariant = 'both' | 'in' | 'out'

export function NodeDirectionalHandles({ variant = 'both' }: { variant?: HandleVariant } = {}) {
  return (
    <>
      {variant !== 'out' ? (
        <NodeHandle type='target' position={Position.Left}  id={WORKFLOW_TARGET_HANDLE} label='IN' />
      ) : null}
      {variant !== 'in' ? (
        <NodeHandle type='source' position={Position.Right} id={WORKFLOW_SOURCE_HANDLE} label='OUT' />
      ) : null}
    </>
  )
}
```

- [ ] **Step 2: Thread a `handles` prop through `NodeShell`**

In `packages/frontend/src/components/workflow/node-shell.tsx`:

Update the import: `import { NodeDirectionalHandles, type HandleVariant } from './handles'`

Add to `NodeShellProps`:

```tsx
  /** Which connection handles to render. Defaults to both. */
  handles?: HandleVariant
```

Add `handles = 'both'` to the destructured params, and change the render line `<NodeDirectionalHandles />` to `<NodeDirectionalHandles variant={handles} />`.

- [ ] **Step 3: Export the type from the barrel**

In `packages/frontend/src/components/workflow/index.ts`, change the handles export block to also export the type:

```ts
export {
  NodeDirectionalHandles,
  WORKFLOW_SOURCE_HANDLE,
  WORKFLOW_TARGET_HANDLE,
} from './handles'
export type { HandleVariant } from './handles'
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/workflow/handles.tsx packages/frontend/src/components/workflow/node-shell.tsx packages/frontend/src/components/workflow/index.ts
git commit -m "feat(frontend): NodeShell input-only/output-only handle variants"
```

---

### Task 1.3: Output node UI (display components + config + registries)

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx`
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/media-display.tsx`
- Create: `packages/frontend/src/components/workflow-editor/inspector/config/markdown-display-config.tsx`
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`
- Modify: `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`

- [ ] **Step 1: Markdown display component**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx`:

```tsx
import { memo } from 'react'
import { FileText } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { MessageResponse } from '@/components/ai-elements/message'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface MarkdownDisplayNodeData { staticText?: string }

export const MarkdownDisplayExecutableNode = memo(function MarkdownDisplayExecutableNode(
  { id, data }: { id: string; data: MarkdownDisplayNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'markdown'; text: string } | undefined
  const text = output?.kind === 'markdown' ? output.text : data.staticText ?? ''
  return (
    <NodeShell
      icon={FileText}
      title='Markdown'
      subtitle='Passive — renders upstream text as markdown'
      accent='from-[#fd551d] to-[#22c55e]'
      handles='in'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>output</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      {text ? (
        <div className='max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs'>
          <MessageResponse>{text}</MessageResponse>
        </div>
      ) : (
        <p className='text-xs text-zinc-300'>Connect a node that outputs text.</p>
      )}
    </NodeShell>
  )
})
```

- [ ] **Step 2: Media display component**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/media-display.tsx`:

```tsx
import { memo } from 'react'
import { Film } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { FileThumb } from '@/components/workflow/file-thumb'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface MediaDisplayNodeData {}

export const MediaDisplayExecutableNode = memo(function MediaDisplayExecutableNode(
  { id }: { id: string; data: MediaDisplayNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'file'; path: string; mimeType?: string } | undefined
  return (
    <NodeShell
      icon={Film}
      title='Media'
      subtitle='Passive — displays an upstream image / video'
      accent='from-[#fd551d] to-[#8b5cf6]'
      handles='in'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>output</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      {output?.kind === 'file' ? (
        <div className='mt-1 rounded-xl border border-white/10 bg-black/30 p-2'>
          <FileThumb path={output.path} />
          {output.mimeType ? <p className='mt-1 truncate text-[10px] text-zinc-500'>{output.mimeType}</p> : null}
        </div>
      ) : (
        <p className='text-xs text-zinc-300'>Connect a node that outputs a file.</p>
      )}
    </NodeShell>
  )
})
```

- [ ] **Step 3: Markdown config form** (media has no config)

Create `packages/frontend/src/components/workflow-editor/inspector/config/markdown-display-config.tsx`:

```tsx
import { useEditorStore } from '../../editor-store'

type Data = { staticText?: string }

export function MarkdownDisplayConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Markdown</p>
      <label className='block text-xs'>Fallback text (shown when no input is connected)
        <textarea
          className='mt-1 w-full rounded-md border border-border bg-background p-2 text-xs'
          rows={6}
          value={data.staticText ?? ''}
          onChange={(e) => update({ staticText: e.target.value })}
          placeholder='# Heading\n\nMarkdown body…'
        />
      </label>
      <p className='text-[10px] text-muted-foreground'>
        When an upstream node provides text, it overrides this fallback at run time.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Register node types + palette entries**

In `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`:

Add imports:

```ts
import { MarkdownDisplayExecutableNode }       from './markdown-display'
import { MediaDisplayExecutableNode }          from './media-display'
```

Add to `executableNodeTypes`:

```ts
  markdownDisplay:     MarkdownDisplayExecutableNode as never,
  mediaDisplay:        MediaDisplayExecutableNode as never,
```

Add to `NODE_PALETTE` (inside the array, in the `output` category group):

```ts
  { type: 'markdownDisplay',     label: 'Markdown',               category: 'output'    },
  { type: 'mediaDisplay',        label: 'Media',                  category: 'output'    },
```

- [ ] **Step 5: Register config forms**

In `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`:

Add imports:

```ts
import { MarkdownDisplayConfigForm } from './inspector/config/markdown-display-config'
```

Add to `CONFIG_FORMS`:

```ts
  markdownDisplay:     MarkdownDisplayConfigForm,
```

(Media needs no config form — `InspectorPanel` already shows a graceful "No config form for type" message; that is acceptable for a config-less node. Do NOT register a media form.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/markdown-display.tsx packages/frontend/src/components/workflow-editor/executable-nodes/media-display.tsx packages/frontend/src/components/workflow-editor/inspector/config/markdown-display-config.tsx packages/frontend/src/components/workflow-editor/executable-nodes/index.ts packages/frontend/src/components/workflow-editor/inspector-panel.tsx
git commit -m "feat(frontend): Markdown + Media output nodes"
```

**Phase 1 verification:** `pnpm --filter @anubis/workflow-runtime build && pnpm --filter @anubis/frontend typecheck`. Output nodes are now usable end-to-end.

---

## Phase 2 — Runtime trigger support

### Task 2.1: `runWorkflow` seed injection

When a run is initiated by a trigger, the trigger node's output is supplied externally (the changed file path / fire time) rather than computed. Seeded nodes skip their executor but still emit started/succeeded so the UI and persistence stay consistent.

**Files:**
- Modify: `packages/workflow-runtime/src/runner.ts`
- Test: `packages/workflow-runtime/tests/runner-seed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/runner-seed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function makeCtx(): ExecutorContext {
  return { signal: new AbortController().signal, emit: () => {}, runId: 'r1' } as unknown as ExecutorContext
}

// Echoes its upstream so we can assert the seeded payload flowed downstream.
const echo: Executor<unknown> = {
  type: 'echo',
  validateConfig: (raw) => raw,
  run: async (input) => ({ seen: input.upstream }),
}

// Should never run when seeded.
const boom: Executor<unknown> = {
  type: 'trigger',
  validateConfig: (raw) => raw,
  run: async () => { throw new Error('executor must not run when seeded') },
}

const graph: WorkflowGraph = {
  nodes: [
    { id: 'trig', type: 'trigger', position: { x: 0, y: 0 }, data: {} },
    { id: 'down', type: 'echo', position: { x: 1, y: 0 }, data: {} },
  ],
  edges: [{ id: 'e1', source: 'trig', target: 'down' }],
}

describe('runWorkflow seed', () => {
  it('injects a seeded node output and skips its executor', async () => {
    const registry = { trigger: boom, echo } as Record<string, Executor<unknown>>
    const result = await runWorkflow(graph, registry, makeCtx(), {
      seed: { trig: { kind: 'trigger', event: 'file', path: '/x.png' } },
    })
    expect(result.status).toBe('succeeded')
    expect(result.outputs.trig).toEqual({ kind: 'trigger', event: 'file', path: '/x.png' })
    expect(result.outputs.down).toEqual({ seen: { trig: { kind: 'trigger', event: 'file', path: '/x.png' } } })
    expect(result.stepStatuses.trig).toBe('succeeded')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/runner-seed.test.ts`
Expected: FAIL — `runWorkflow` ignores the 4th arg, so `boom.run` throws / outputs.trig is undefined.

- [ ] **Step 3: Add the `opts.seed` parameter**

In `packages/workflow-runtime/src/runner.ts`, change the signature and add seed handling at the top of the per-node loop.

Change the function signature:

```ts
export async function runWorkflow(
  graph: WorkflowGraph,
  registry: Record<string, Executor<unknown>>,
  ctx: ExecutorContext,
  opts?: { seed?: Record<string, unknown> },
): Promise<RunResult> {
```

Inside the `for (const nodeId of order) {` loop, immediately after the existing `if (ctx.signal.aborted) { ... }` block and before `const node = graph.nodes.find(...)`, insert:

```ts
    if (opts?.seed && Object.prototype.hasOwnProperty.call(opts.seed, nodeId)) {
      const seeded = opts.seed[nodeId]
      outputs[nodeId] = seeded
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output: seeded })
      continue
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/runner-seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full runtime suite (no regressions)**

Run: `pnpm vitest run packages/workflow-runtime`
Expected: PASS (all existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-runtime/src/runner.ts packages/workflow-runtime/tests/runner-seed.test.ts
git commit -m "feat(workflow-runtime): runWorkflow seed injection for trigger payloads"
```

---

### Task 2.2: Trigger executors (schedule + file-watch)

Trigger executors exist so the graph validates and (rarely) so a manual run has a defined fallback. Their `run()` is normally bypassed by seed injection.

**Files:**
- Create: `packages/workflow-runtime/src/executors/schedule-trigger.ts`
- Create: `packages/workflow-runtime/src/executors/file-watch-trigger.ts`
- Modify: `packages/workflow-runtime/src/executors/index.ts`
- Modify: `packages/workflow-runtime/src/index.ts`
- Test: `packages/workflow-runtime/tests/executors/trigger-executors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/executors/trigger-executors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scheduleTriggerExecutor } from '../../src/executors/schedule-trigger.js'
import { fileWatchTriggerExecutor } from '../../src/executors/file-watch-trigger.js'

const ctx = {} as never
const base = { nodeId: 'n1', upstream: {}, downstream: [] as Array<{ nodeId: string; type: string }> }

describe('scheduleTriggerExecutor', () => {
  it('validates interval config', () => {
    expect(() => scheduleTriggerExecutor.validateConfig({ everyValue: 5, everyUnit: 'minute' })).not.toThrow()
  })
  it('validates cron config', () => {
    expect(() => scheduleTriggerExecutor.validateConfig({ everyValue: 1, everyUnit: 'hour', cron: '*/5 * * * *' })).not.toThrow()
  })
  it('rejects a non-positive interval', () => {
    expect(() => scheduleTriggerExecutor.validateConfig({ everyValue: 0, everyUnit: 'minute' })).toThrow()
  })
  it('fallback run emits a schedule payload', async () => {
    const out = await scheduleTriggerExecutor.run({ ...base, config: { everyValue: 1, everyUnit: 'minute' } }, ctx) as { kind: string; event: string }
    expect(out.kind).toBe('trigger')
    expect(out.event).toBe('schedule')
  })
})

describe('fileWatchTriggerExecutor', () => {
  it('validates folder config with events', () => {
    expect(() => fileWatchTriggerExecutor.validateConfig({ path: '/tmp', watchKind: 'folder', events: ['add', 'change'] })).not.toThrow()
  })
  it('requires at least one event', () => {
    expect(() => fileWatchTriggerExecutor.validateConfig({ path: '/tmp', watchKind: 'folder', events: [] })).toThrow()
  })
  it('fallback run throws (no file context in a manual run)', async () => {
    await expect(
      fileWatchTriggerExecutor.run({ ...base, config: { path: '/tmp', watchKind: 'folder', events: ['add'] } }, ctx),
    ).rejects.toThrow(/armed/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/trigger-executors.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `schedule-trigger.ts`**

Create `packages/workflow-runtime/src/executors/schedule-trigger.ts`:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  everyValue: z.number().int().positive(),
  everyUnit: z.enum(['minute', 'hour']),
  cron: z.string().optional(),
})

export type ScheduleTriggerConfig = z.infer<typeof ConfigSchema>

export const scheduleTriggerExecutor: Executor<ScheduleTriggerConfig> = {
  type: 'scheduleTrigger',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  // Normally bypassed via seed injection. Fallback for a manual run.
  async run() {
    return { kind: 'trigger', event: 'schedule', firedAt: Date.now() }
  },
}
```

- [ ] **Step 4: Implement `file-watch-trigger.ts`**

Create `packages/workflow-runtime/src/executors/file-watch-trigger.ts`:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  path: z.string().min(1),
  watchKind: z.enum(['file', 'folder']),
  glob: z.string().optional(),
  events: z.array(z.enum(['add', 'change', 'unlink'])).min(1),
})

export type FileWatchTriggerConfig = z.infer<typeof ConfigSchema>

export const fileWatchTriggerExecutor: Executor<FileWatchTriggerConfig> = {
  type: 'fileWatchTrigger',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  // A file-watch run only makes sense when armed (the changed path is injected
  // via seed). A manual run has no file context.
  async run() {
    throw new Error('fileWatchTrigger has no file context — run this workflow via an armed trigger')
  },
}
```

- [ ] **Step 5: Register in the executor registry**

In `packages/workflow-runtime/src/executors/index.ts` add imports:

```ts
import { scheduleTriggerExecutor }       from './schedule-trigger.js'
import { fileWatchTriggerExecutor }      from './file-watch-trigger.js'
```

Add to `executorRegistry`:

```ts
  scheduleTrigger:      scheduleTriggerExecutor as Executor<unknown>,
  fileWatchTrigger:     fileWatchTriggerExecutor as Executor<unknown>,
```

Add to the bottom `export { ... }`: `scheduleTriggerExecutor, fileWatchTriggerExecutor`.

- [ ] **Step 6: Export executors + config types from the package root**

`packages/workflow-runtime/src/index.ts` currently exports only `executorRegistry` from the executors barrel — the individual executors are NOT re-exported. The backend's `TriggerManager` (Task 4.3) imports the trigger executors and their config types from `@anubis/workflow-runtime`, so add these lines to `src/index.ts`:

```ts
export { scheduleTriggerExecutor } from './executors/schedule-trigger.js'
export type { ScheduleTriggerConfig } from './executors/schedule-trigger.js'
export { fileWatchTriggerExecutor } from './executors/file-watch-trigger.js'
export type { FileWatchTriggerConfig } from './executors/file-watch-trigger.js'
```

Note `WorkflowGraphSchema` is already exported (via `export * from './types.js'`), so `TriggerManager` can import it from the package root without further changes.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/trigger-executors.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Build the runtime (downstream packages import from dist)**

Run: `pnpm --filter @anubis/workflow-runtime build`
Expected: tsc succeeds.

- [ ] **Step 9: Commit**

```bash
git add packages/workflow-runtime/src/executors/schedule-trigger.ts packages/workflow-runtime/src/executors/file-watch-trigger.ts packages/workflow-runtime/src/executors/index.ts packages/workflow-runtime/src/index.ts packages/workflow-runtime/tests/executors/trigger-executors.test.ts
git commit -m "feat(workflow-runtime): schedule + file-watch trigger executors"
```

---

## Phase 3 — Persistence

### Task 3.1: `workflow_triggers` table + repo + stack wiring

**Files:**
- Create: `packages/conversation/src/db/migrations/006_workflow_triggers.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Create: `packages/conversation/src/db/repositories/workflow-triggers-repo.ts`
- Modify: `packages/conversation/src/index.ts`

- [ ] **Step 1: Migration SQL**

Create `packages/conversation/src/db/migrations/006_workflow_triggers.sql`:

```sql
CREATE TABLE workflow_triggers (
  workflow_id  TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  armed        INTEGER NOT NULL DEFAULT 0,
  armed_at     INTEGER
);
```

- [ ] **Step 2: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, append to the `MIGRATIONS` array:

```ts
  load(6, '006_workflow_triggers.sql'),
```

- [ ] **Step 3: Implement the repo**

Create `packages/conversation/src/db/repositories/workflow-triggers-repo.ts`:

```ts
import type { Db } from '../client.js'

export interface WorkflowTriggerState {
  workflowId: string
  armed: boolean
  armedAt?: number
}

interface TriggerRow {
  workflow_id: string
  armed: number
  armed_at: number | null
}

export class WorkflowTriggersRepo {
  constructor(private db: Db) {}

  setArmed(workflowId: string, armed: boolean, armedAt: number | null): void {
    this.db
      .prepare(
        `INSERT INTO workflow_triggers (workflow_id, armed, armed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workflow_id) DO UPDATE SET
           armed = excluded.armed,
           armed_at = excluded.armed_at`,
      )
      .run(workflowId, armed ? 1 : 0, armedAt ?? null)
  }

  getArmed(workflowId: string): boolean {
    const row = this.db
      .prepare(`SELECT armed FROM workflow_triggers WHERE workflow_id = ?`)
      .get(workflowId) as { armed: number } | undefined
    return row?.armed === 1
  }

  listArmed(): WorkflowTriggerState[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_triggers WHERE armed = 1`)
      .all() as TriggerRow[]
    return rows.map((r) => ({
      workflowId: r.workflow_id,
      armed: r.armed === 1,
      armedAt: r.armed_at ?? undefined,
    }))
  }
}
```

- [ ] **Step 4: Wire the repo into the stack**

In `packages/conversation/src/index.ts`:

Add the import near the other repo imports:

```ts
import { WorkflowTriggersRepo } from './db/repositories/workflow-triggers-repo.js'
```

Add to the `ConversationStack` interface (after `workflowRuns`):

```ts
  workflowTriggers: WorkflowTriggersRepo
```

Construct it after `workflowRunsRepo`:

```ts
  const workflowTriggersRepo = new WorkflowTriggersRepo(db)
```

Add to the returned stack object (after `workflowRuns: workflowRunsRepo,`):

```ts
    workflowTriggers: workflowTriggersRepo,
```

Add to the type re-exports at the bottom:

```ts
export type { WorkflowTriggerState } from './db/repositories/workflow-triggers-repo.js'
export { WorkflowTriggersRepo } from './db/repositories/workflow-triggers-repo.js'
```

- [ ] **Step 5: Build the conversation package (copies SQL to dist)**

Run: `pnpm --filter @anubis/conversation build`
Expected: tsc + copy-sql succeed; `dist/db/migrations/006_workflow_triggers.sql` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/db/migrations/006_workflow_triggers.sql packages/conversation/src/db/migrations/index.ts packages/conversation/src/db/repositories/workflow-triggers-repo.ts packages/conversation/src/index.ts
git commit -m "feat(conversation): workflow_triggers table + repo"
```

---

## Phase 4 — Backend TriggerManager + wiring

### Task 4.1: Add backend dependencies

**Files:**
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Add deps**

In `packages/backend/package.json`, add to `dependencies` (keep alphabetical-ish ordering with the existing entries):

```json
    "chokidar": "^4.0.3",
    "node-cron": "^3.0.3",
```

And to `devDependencies`:

```json
    "@types/node-cron": "^3.0.11",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; chokidar + node-cron resolved for `@anubis/backend`.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/package.json pnpm-lock.yaml
git commit -m "build(backend): add chokidar + node-cron for triggers"
```

---

### Task 4.2: `WorkflowRunManager.start` accepts a trigger context

**Files:**
- Modify: `packages/backend/src/workflow-run-manager.ts`

- [ ] **Step 1: Add the optional `triggerContext` param and thread a seed**

In `packages/backend/src/workflow-run-manager.ts`:

Change the `start` signature and the call to `runAndPersist`:

```ts
  async start(
    workflowId: string,
    triggerContext?: { nodeId: string; payload: unknown },
  ): Promise<{ runId: string }> {
```

Where it currently calls `void this.runAndPersist(active, JSON.parse(workflow.publishedGraph), emit, now).finally(...)`, add the seed argument:

```ts
    const seed = triggerContext
      ? { [triggerContext.nodeId]: triggerContext.payload }
      : undefined

    void this.runAndPersist(active, JSON.parse(workflow.publishedGraph), emit, now, seed).finally(() => {
```

Change the `runAndPersist` signature to accept the seed and pass it to `runWorkflow`:

```ts
  private async runAndPersist(
    active: ActiveRun,
    graph: ReturnType<typeof WorkflowGraphSchema.parse>,
    emit: (event: RunEvent) => void,
    startedAt: number,
    seed?: Record<string, unknown>,
  ): Promise<void> {
```

And where it currently calls `const result = await runWorkflow(graph, executorRegistry, ctx)`, change to:

```ts
      const result = await runWorkflow(graph, executorRegistry, ctx, { seed })
```

- [ ] **Step 2: Build the backend to typecheck the change**

Run: `pnpm --filter @anubis/backend build`
Expected: tsc succeeds (the existing one-arg `start` callers still compile — the param is optional).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/workflow-run-manager.ts
git commit -m "feat(backend): WorkflowRunManager.start accepts trigger context"
```

---

### Task 4.3: TriggerManager

**Files:**
- Create: `packages/backend/src/trigger-manager.ts`
- Test: `packages/backend/tests/workflow-triggers.test.ts` (validation portion; full routes in Task 4.5)

- [ ] **Step 1: Write a failing unit test for arm validation + glob**

Create `packages/backend/tests/workflow-triggers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesGlob } from '../src/trigger-manager.js'

describe('matchesGlob', () => {
  it('matches everything when no glob', () => {
    expect(matchesGlob('/a/b/c.png', undefined)).toBe(true)
    expect(matchesGlob('/a/b/c.png', '')).toBe(true)
  })
  it('matches a simple extension glob against the basename', () => {
    expect(matchesGlob('/a/b/c.png', '*.png')).toBe(true)
    expect(matchesGlob('/a/b/c.jpg', '*.png')).toBe(false)
  })
  it('matches a prefix glob', () => {
    expect(matchesGlob('C:\\x\\report-2026.csv', 'report-*')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @anubis/backend test -- workflow-triggers`
Expected: FAIL — `../src/trigger-manager.js` not found.

- [ ] **Step 3: Implement the TriggerManager**

Create `packages/backend/src/trigger-manager.ts`:

```ts
import cron from 'node-cron'
import chokidar from 'chokidar'
import {
  WorkflowGraphSchema,
  scheduleTriggerExecutor,
  fileWatchTriggerExecutor,
  type ScheduleTriggerConfig,
  type FileWatchTriggerConfig,
} from '@anubis/workflow-runtime'
import type { ConversationStack } from '@anubis/conversation'
import type { WorkflowRunManager } from './workflow-run-manager.js'

const TRIGGER_TYPES = new Set(['scheduleTrigger', 'fileWatchTrigger'])

interface TriggerHandle { stop(): void }

function badRequest(message: string): Error {
  const err = new Error(message)
  ;(err as { code?: number }).code = 400
  return err
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Simple `*`-glob matched against the file's basename. Exported for tests. */
export function matchesGlob(filePath: string, glob?: string): boolean {
  if (!glob || !glob.trim()) return true
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  const re = new RegExp('^' + glob.trim().split('*').map(escapeRegex).join('.*') + '$')
  return re.test(base)
}

export class TriggerManager {
  private armed = new Map<string, TriggerHandle>()

  constructor(
    private stack: ConversationStack,
    private runManager: WorkflowRunManager,
  ) {}

  isArmed(workflowId: string): boolean {
    return this.armed.has(workflowId)
  }

  arm(workflowId: string): void {
    if (this.armed.has(workflowId)) return
    const wf = this.stack.workflows.get(workflowId)
    if (!wf) throw badRequest(`workflow ${workflowId} not found`)
    if (!wf.publishedGraph) throw badRequest('workflow has no published version')
    const graph = WorkflowGraphSchema.parse(JSON.parse(wf.publishedGraph))
    const triggers = graph.nodes.filter((n) => TRIGGER_TYPES.has(n.type))
    if (triggers.length !== 1) {
      throw badRequest('workflow must contain exactly one trigger node to arm')
    }
    const node = triggers[0]!
    const handle = node.type === 'scheduleTrigger'
      ? this.armSchedule(workflowId, node.id, scheduleTriggerExecutor.validateConfig(node.data))
      : this.armFileWatch(workflowId, node.id, fileWatchTriggerExecutor.validateConfig(node.data))
    this.armed.set(workflowId, handle)
    this.stack.workflowTriggers.setArmed(workflowId, true, Date.now())
  }

  disarm(workflowId: string): void {
    const handle = this.armed.get(workflowId)
    if (handle) {
      handle.stop()
      this.armed.delete(workflowId)
    }
    this.stack.workflowTriggers.setArmed(workflowId, false, null)
  }

  rearmAll(): void {
    for (const row of this.stack.workflowTriggers.listArmed()) {
      try {
        this.arm(row.workflowId)
      } catch (err) {
        console.error('[trigger] rearm failed for', row.workflowId, err)
        // Clear the stale armed flag so we do not retry forever.
        this.stack.workflowTriggers.setArmed(row.workflowId, false, null)
      }
    }
  }

  shutdown(): void {
    for (const handle of this.armed.values()) handle.stop()
    this.armed.clear()
  }

  private fire(workflowId: string, nodeId: string, payload: unknown): void {
    // Respect the one-active-run-per-workflow guard: drop overlapping fires.
    if (this.runManager.activeRunFor(workflowId)) {
      console.warn('[trigger] skip fire — run already active for', workflowId)
      return
    }
    void this.runManager.start(workflowId, { nodeId, payload }).catch((err) => {
      console.error('[trigger] failed to start run for', workflowId, err)
    })
  }

  private armSchedule(workflowId: string, nodeId: string, cfg: ScheduleTriggerConfig): TriggerHandle {
    const fireNow = () =>
      this.fire(workflowId, nodeId, { kind: 'trigger', event: 'schedule', firedAt: Date.now() })

    if (cfg.cron && cfg.cron.trim()) {
      if (!cron.validate(cfg.cron)) throw badRequest(`invalid cron expression: ${cfg.cron}`)
      const task = cron.schedule(cfg.cron, fireNow)
      return { stop: () => task.stop() }
    }
    const ms = cfg.everyUnit === 'hour' ? cfg.everyValue * 3_600_000 : cfg.everyValue * 60_000
    const handle = setInterval(fireNow, ms)
    handle.unref?.()
    return { stop: () => clearInterval(handle) }
  }

  private armFileWatch(workflowId: string, nodeId: string, cfg: FileWatchTriggerConfig): TriggerHandle {
    const watcher = chokidar.watch(cfg.path, {
      ignoreInitial: true,
      depth: cfg.watchKind === 'folder' ? undefined : 0,
    })
    const debouncers = new Map<string, ReturnType<typeof setTimeout>>()

    const onEvent = (event: 'add' | 'change' | 'unlink', changedPath: string) => {
      if (!matchesGlob(changedPath, cfg.glob)) return
      const key = `${event}:${changedPath}`
      const existing = debouncers.get(key)
      if (existing) clearTimeout(existing)
      debouncers.set(key, setTimeout(() => {
        debouncers.delete(key)
        this.fire(workflowId, nodeId, { kind: 'trigger', event: 'file', path: changedPath, eventType: event })
      }, 300))
    }

    for (const ev of cfg.events) watcher.on(ev, (p: string) => onEvent(ev, p))

    return {
      stop: () => {
        for (const t of debouncers.values()) clearTimeout(t)
        debouncers.clear()
        void watcher.close()
      },
    }
  }
}
```

- [ ] **Step 4: Run the glob test to verify it passes**

Run: `pnpm --filter @anubis/backend test -- workflow-triggers`
Expected: PASS (the `matchesGlob` describe block).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/trigger-manager.ts packages/backend/tests/workflow-triggers.test.ts
git commit -m "feat(backend): TriggerManager (schedule + file-watch firing)"
```

---

### Task 4.4: Arm/disarm routes, summary fields, boot/shutdown wiring

**Files:**
- Modify: `packages/backend/src/workflow.ts`
- Modify: `packages/backend/src/server.ts`

- [ ] **Step 1: Add the TriggerManager singleton + helpers in `workflow.ts`**

In `packages/backend/src/workflow.ts`:

Add imports near the top:

```ts
import { TriggerManager } from './trigger-manager.js'
```

After the existing `getRunManager` helper, add:

```ts
let triggerManager: TriggerManager | null = null
function getTriggerManager(stack: ConversationStack): TriggerManager {
  if (!triggerManager) triggerManager = new TriggerManager(stack, getRunManager(stack))
  return triggerManager
}

const TRIGGER_TYPES = new Set(['scheduleTrigger', 'fileWatchTrigger'])
function graphHasTrigger(graphJson?: string | null): boolean {
  if (!graphJson) return false
  try {
    const g = JSON.parse(graphJson) as { nodes?: Array<{ type?: string }> }
    return Array.isArray(g.nodes) && g.nodes.some((n) => n.type != null && TRIGGER_TYPES.has(n.type))
  } catch {
    return false
  }
}

/** Called once at backend boot to restore armed triggers. */
export function rearmTriggersOnBoot(stack: ConversationStack): void {
  getTriggerManager(stack).rearmAll()
}

/** Called at backend shutdown to tear down timers/watchers. */
export function shutdownTriggers(): void {
  if (triggerManager) {
    triggerManager.shutdown()
    triggerManager = null
  }
}
```

- [ ] **Step 2: Surface `hasTrigger` / `armed` on the list + detail endpoints**

In the `workflowRoutes.get('/')` handler, inside the `.map`, add to the returned object:

```ts
      hasTrigger: graphHasTrigger(wf.publishedGraph),
      armed: getTriggerManager(stack).isArmed(wf.id),
```

In the `workflowRoutes.get('/:id')` handler, replace `return c.json(wf)` with:

```ts
  return c.json({
    ...wf,
    hasTrigger: graphHasTrigger(wf.publishedGraph),
    armed: getTriggerManager(stack).isArmed(wf.id),
  })
```

- [ ] **Step 3: Add arm/disarm routes**

In `packages/backend/src/workflow.ts`, add these routes (place them near the other `/:id/...` routes, e.g. after the `publish` route):

```ts
workflowRoutes.post('/:id/arm', (c) => {
  const stack = getStack()
  try {
    getTriggerManager(stack).arm(c.req.param('id'))
    return c.json({ armed: true })
  } catch (err) {
    const code = (err as { code?: number }).code
    const message = err instanceof Error ? err.message : String(err)
    if (code === 400) return c.json({ error: 'bad_request', message }, 400)
    return c.json({ error: 'internal', message }, 500)
  }
})

workflowRoutes.post('/:id/disarm', (c) => {
  const stack = getStack()
  getTriggerManager(stack).disarm(c.req.param('id'))
  return c.json({ armed: false })
})
```

- [ ] **Step 4: Wire boot rearm + shutdown in `server.ts`**

In `packages/backend/src/server.ts`:

Add imports:

```ts
import { getStack } from './services.js'
import { rearmTriggersOnBoot, shutdownTriggers } from './workflow.js'
```

(Note: `shutdownStack` is already imported from `./services.js`; merge the named imports rather than duplicating the line.)

In the `serve(...)` ready callback, after the `console.log(JSON.stringify(readyMessage))` line, add:

```ts
    try {
      rearmTriggersOnBoot(getStack())
    } catch (err) {
      console.error('[trigger] boot rearm failed', err)
    }
```

In the `shutdown()` function, call `shutdownTriggers()` before closing the stack:

```ts
function shutdown() {
  shutdownTriggers()
  server.close(() => {
    void shutdownStack().finally(() => process.exit(0))
  })
}
```

- [ ] **Step 5: Build the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: tsc succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/workflow.ts packages/backend/src/server.ts
git commit -m "feat(backend): arm/disarm routes + boot rearm + trigger summary fields"
```

---

### Task 4.5: Backend integration tests (arm/disarm lifecycle)

**Files:**
- Modify: `packages/backend/tests/workflow-triggers.test.ts`

- [ ] **Step 1: Add a failing integration test**

Append to `packages/backend/tests/workflow-triggers.test.ts` (add the imports at the top of the file):

```ts
import { beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-trig-test-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const wf = await import('../src/workflow.js')
    wf.shutdownTriggers()
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

const SCHEDULE_GRAPH = JSON.stringify({
  nodes: [{ id: 'trig', type: 'scheduleTrigger', position: { x: 0, y: 0 }, data: { everyValue: 1, everyUnit: 'hour' } }],
  edges: [],
})

async function makePublished(app: Awaited<ReturnType<typeof loadApp>>, name: string, graph: string) {
  const created = await app.request('/workflows', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const wf = await created.json()
  await app.request(`/workflows/${wf.id}/draft`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftGraph: graph }),
  })
  await app.request(`/workflows/${wf.id}/publish`, { method: 'POST' })
  return wf.id as string
}

describe('trigger arm/disarm', () => {
  it('arms a schedule workflow and reflects armed in the summary', async () => {
    const app = await loadApp()
    const id = await makePublished(app, 'Sched', SCHEDULE_GRAPH)

    const arm = await app.request(`/workflows/${id}/arm`, { method: 'POST' })
    expect(arm.status).toBe(200)
    expect(await arm.json()).toEqual({ armed: true })

    const detail = await app.request(`/workflows/${id}`).then((r) => r.json())
    expect(detail.hasTrigger).toBe(true)
    expect(detail.armed).toBe(true)

    const disarm = await app.request(`/workflows/${id}/disarm`, { method: 'POST' })
    expect(disarm.status).toBe(200)
    expect(await disarm.json()).toEqual({ armed: false })

    const after = await app.request(`/workflows/${id}`).then((r) => r.json())
    expect(after.armed).toBe(false)
  })

  it('rejects arming a workflow with no trigger node', async () => {
    const app = await loadApp()
    const tableGraph = JSON.stringify({
      nodes: [{ id: 't1', type: 'table', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    const id = await makePublished(app, 'NoTrig', tableGraph)
    const arm = await app.request(`/workflows/${id}/arm`, { method: 'POST' })
    expect(arm.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @anubis/backend test -- workflow-triggers`
Expected: PASS. (The schedule arms with a 1-hour interval timer that is `unref`'d, so it never actually fires during the test; disarm clears it.)

- [ ] **Step 3: Run the full backend suite (no regressions)**

Run: `pnpm --filter @anubis/backend test`
Expected: PASS (existing workflow tests still green).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/tests/workflow-triggers.test.ts
git commit -m "test(backend): trigger arm/disarm integration"
```

---

## Phase 5 — Frontend trigger UI

### Task 5.1: Trigger node UI (display + config + registries)

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/schedule-trigger.tsx`
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/file-watch-trigger.tsx`
- Create: `packages/frontend/src/components/workflow-editor/inspector/config/schedule-trigger-config.tsx`
- Create: `packages/frontend/src/components/workflow-editor/inspector/config/file-watch-trigger-config.tsx`
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`
- Modify: `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`

- [ ] **Step 1: Schedule trigger display component**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/schedule-trigger.tsx`:

```tsx
import { memo } from 'react'
import { Clock } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface ScheduleTriggerNodeData {
  everyValue?: number
  everyUnit?: 'minute' | 'hour'
  cron?: string
}

export const ScheduleTriggerExecutableNode = memo(function ScheduleTriggerExecutableNode(
  { id, data }: { id: string; data: ScheduleTriggerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const subtitle = data.cron && data.cron.trim()
    ? `cron: ${data.cron}`
    : `every ${data.everyValue ?? 1} ${data.everyUnit ?? 'hour'}`
  return (
    <NodeShell
      icon={Clock}
      title='Schedule'
      subtitle={subtitle}
      accent='from-[#fd551d] to-[#eab308]'
      handles='out'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge tone='info'>trigger</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      <p className='text-xs text-zinc-300'>Fires the workflow on a timer while armed.</p>
    </NodeShell>
  )
})
```

- [ ] **Step 2: File-watch trigger display component**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/file-watch-trigger.tsx`:

```tsx
import { memo } from 'react'
import { FolderSearch } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface FileWatchTriggerNodeData {
  path?: string
  watchKind?: 'file' | 'folder'
  glob?: string
  events?: Array<'add' | 'change' | 'unlink'>
}

export const FileWatchTriggerExecutableNode = memo(function FileWatchTriggerExecutableNode(
  { id, data }: { id: string; data: FileWatchTriggerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={FolderSearch}
      title='File watcher'
      subtitle={data.path ?? 'No path set'}
      accent='from-[#fd551d] to-[#06b6d4]'
      handles='out'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge tone='info'>trigger</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      <p className='text-xs text-zinc-300'>
        Fires when {(data.events ?? ['add', 'change']).join(' / ')} happen in the watched {data.watchKind ?? 'folder'}.
      </p>
    </NodeShell>
  )
})
```

- [ ] **Step 3: Schedule config form**

Create `packages/frontend/src/components/workflow-editor/inspector/config/schedule-trigger-config.tsx`:

```tsx
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Data = { everyValue?: number; everyUnit?: 'minute' | 'hour'; cron?: string }

export function ScheduleTriggerConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  const cronActive = !!(data.cron && data.cron.trim())

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Schedule</p>
      <div className='flex gap-2'>
        <label className='block flex-1 text-xs'>Every
          <Input className='mt-1' type='number' min={1} disabled={cronActive}
                 value={data.everyValue ?? 1}
                 onChange={(e) => update({ everyValue: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label className='block flex-1 text-xs'>Unit
          <Select value={data.everyUnit ?? 'hour'} onValueChange={(v) => update({ everyUnit: v as Data['everyUnit'] })}>
            <SelectTrigger className='mt-1' disabled={cronActive}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='minute'>minutes</SelectItem>
              <SelectItem value='hour'>hours</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className='block text-xs'>Advanced: cron expression (overrides interval)
        <Input className='mt-1' value={data.cron ?? ''} onChange={(e) => update({ cron: e.target.value })}
               placeholder='*/5 * * * *' />
      </label>
      <p className='text-[10px] text-muted-foreground'>
        Leave cron empty to use the interval. Arm the workflow to start firing.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: File-watch config form**

Create `packages/frontend/src/components/workflow-editor/inspector/config/file-watch-trigger-config.tsx`:

```tsx
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type WatchEvent = 'add' | 'change' | 'unlink'
type Data = { path?: string; watchKind?: 'file' | 'folder'; glob?: string; events?: WatchEvent[] }

const ALL_EVENTS: WatchEvent[] = ['add', 'change', 'unlink']

export function FileWatchTriggerConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data
  const events = data.events ?? ['add', 'change']

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  function toggleEvent(ev: WatchEvent) {
    const next = events.includes(ev) ? events.filter((e) => e !== ev) : [...events, ev]
    update({ events: next.length > 0 ? next : [ev] })
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>File watcher</p>
      <label className='block text-xs'>Watch
        <Select value={data.watchKind ?? 'folder'} onValueChange={(v) => update({ watchKind: v as Data['watchKind'] })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='folder'>Folder (recursive)</SelectItem>
            <SelectItem value='file'>Single file</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Path
        <Input className='mt-1' value={data.path ?? ''} onChange={(e) => update({ path: e.target.value })}
               placeholder='C:\watched\folder' />
      </label>
      <label className='block text-xs'>Glob filter (optional)
        <Input className='mt-1' value={data.glob ?? ''} onChange={(e) => update({ glob: e.target.value })}
               placeholder='*.png' />
      </label>
      <div className='text-xs'>Events
        <div className='mt-1 flex gap-3'>
          {ALL_EVENTS.map((ev) => (
            <label key={ev} className='flex items-center gap-1 text-[11px]'>
              <input type='checkbox' checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
              {ev}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Register node types + palette entries**

In `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`:

Add imports:

```ts
import { ScheduleTriggerExecutableNode }       from './schedule-trigger'
import { FileWatchTriggerExecutableNode }      from './file-watch-trigger'
```

Add to `executableNodeTypes`:

```ts
  scheduleTrigger:     ScheduleTriggerExecutableNode as never,
  fileWatchTrigger:    FileWatchTriggerExecutableNode as never,
```

Add to `NODE_PALETTE` (top of the array, in the `trigger` category group):

```ts
  { type: 'scheduleTrigger',     label: 'Schedule',               category: 'trigger'   },
  { type: 'fileWatchTrigger',    label: 'File watcher',           category: 'trigger'   },
```

- [ ] **Step 6: Register config forms**

In `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`:

Add imports:

```ts
import { ScheduleTriggerConfigForm }  from './inspector/config/schedule-trigger-config'
import { FileWatchTriggerConfigForm } from './inspector/config/file-watch-trigger-config'
```

Add to `CONFIG_FORMS`:

```ts
  scheduleTrigger:     ScheduleTriggerConfigForm,
  fileWatchTrigger:    FileWatchTriggerConfigForm,
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/schedule-trigger.tsx packages/frontend/src/components/workflow-editor/executable-nodes/file-watch-trigger.tsx packages/frontend/src/components/workflow-editor/inspector/config/schedule-trigger-config.tsx packages/frontend/src/components/workflow-editor/inspector/config/file-watch-trigger-config.tsx packages/frontend/src/components/workflow-editor/executable-nodes/index.ts packages/frontend/src/components/workflow-editor/inspector-panel.tsx
git commit -m "feat(frontend): Schedule + File-watcher trigger nodes"
```

---

### Task 5.2: API client arm/disarm + types

**Files:**
- Modify: `packages/frontend/src/api/workflows.ts`

- [ ] **Step 1: Extend types + add methods**

In `packages/frontend/src/api/workflows.ts`:

Add to `WorkflowSummary`:

```ts
  hasTrigger?: boolean
  armed?: boolean
```

Add to `WorkflowDetail`:

```ts
  hasTrigger?: boolean
  armed?: boolean
```

Add to the `workflowsApi` object (after `cancelRun`):

```ts
  arm:         (id: string) => jsonFetch<{ armed: boolean }>(`/workflows/${id}/arm`, { method: 'POST' }),
  disarm:      (id: string) => jsonFetch<{ armed: boolean }>(`/workflows/${id}/disarm`, { method: 'POST' }),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api/workflows.ts
git commit -m "feat(frontend): workflows arm/disarm API client"
```

---

### Task 5.3: Arm/Disarm toggle in the editor toolbar

**Files:**
- Modify: `packages/frontend/src/pages/workflow-editor.tsx`

- [ ] **Step 1: Track trigger/armed state and render the toggle**

In `packages/frontend/src/pages/workflow-editor.tsx`:

Add two state hooks alongside the existing `useState`:

```tsx
  const [hasTrigger, setHasTrigger] = useState(false)
  const [armed, setArmed] = useState(false)
```

In the `useEffect` that calls `workflowsApi.get(workflowId).then(async (wf) => {`, after the `hydrate({...})` call, capture the new fields:

```tsx
      setHasTrigger(!!wf.hasTrigger)
      setArmed(!!wf.armed)
```

Add arm/disarm handlers next to `publish` / `startRun`:

```tsx
  async function toggleArm() {
    try {
      const r = armed ? await workflowsApi.disarm(workflowId) : await workflowsApi.arm(workflowId)
      setArmed(r.armed)
    } catch (e) { setError(String(e)) }
  }
```

Replace the toolbar button group. Change:

```tsx
        <div className='flex gap-2'>
          <Button size='sm' variant='secondary' onClick={publish}>{publishedAt ? 'Re-publish' : 'Publish'}</Button>
          <Button size='sm' onClick={startRun} disabled={!publishedAt || activeRun?.status === 'running'}>▶ Run published</Button>
        </div>
```

to:

```tsx
        <div className='flex gap-2'>
          <Button size='sm' variant='secondary' onClick={publish}>{publishedAt ? 'Re-publish' : 'Publish'}</Button>
          {hasTrigger ? (
            <Button size='sm' variant={armed ? 'destructive' : 'default'} onClick={toggleArm} disabled={!publishedAt}>
              {armed ? '■ Disarm' : '⚡ Arm'}
            </Button>
          ) : (
            <Button size='sm' onClick={startRun} disabled={!publishedAt || activeRun?.status === 'running'}>▶ Run published</Button>
          )}
        </div>
```

Note: `hasTrigger` reflects the **published** graph (the backend computes it from `publishedGraph`). A freshly-added trigger node only flips the toolbar to Arm after the user publishes — this is intended (you can only arm a published graph).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/workflow-editor.tsx
git commit -m "feat(frontend): Arm/Disarm toggle replaces Run for trigger workflows"
```

---

### Task 5.4: Full verification

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS across every package.

- [ ] **Step 2: Run the whole test suite**

Run: `pnpm test`
Expected: PASS (runtime, backend, conversation, frontend).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run `pnpm dev`. In the editor:
1. Drag a **Schedule** node + a **Markdown** node; connect Schedule → Markdown; Publish. The toolbar shows **Arm**. Click Arm → button becomes **Disarm**; the run fires on the interval and the Markdown node renders.
2. Drag a **File watcher** node pointed at a temp folder with glob `*.txt`, events `add`; connect to a node; Publish; Arm; create a `.txt` file in the folder → a run fires with the changed path flowing downstream.
3. Restart the backend (`pnpm dev` again) → the armed workflow re-arms automatically.

- [ ] **Step 4: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "chore: trigger + output nodes verification"
```

---

## Self-Review Notes (for the implementer)

- **Type consistency:** trigger node `type` strings (`scheduleTrigger`, `fileWatchTrigger`), output node types (`markdownDisplay`, `mediaDisplay`), and the seed payload shapes (`{ kind:'trigger', event:'schedule'|'file', ... }`) must match across runtime executors, `TriggerManager.armSchedule/armFileWatch`, and the frontend display components.
- **Registries are three-fold per node:** executor registry (runtime), `executableNodeTypes` + `NODE_PALETTE` (frontend), `CONFIG_FORMS` (frontend). Media display and Media nodes intentionally have no config form.
- **`runWorkflow` 4th arg is optional** — existing callers and tests remain valid.
- **chokidar v4** has no built-in glob; the manual `matchesGlob` against basename is the filter. `depth: 0` limits a `file` watch; `undefined` is recursive for a `folder`.
- **Interval timers are `unref`'d** so tests and process shutdown are not blocked.
