# Workflow Review Comment + Run-State Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewer comment to the Human Review node (surfaced to the Lesson Writer), fix the Markdown node rendering empty after approval, and add run-state visuals to the editor (active-path edge flow, executing-node glow, dimmed not-yet-run nodes).

**Architecture:** Two independent feature areas in one branch. (A) Workflow-runtime executors: the approval node surfaces the approved `text` (fixing Markdown), the Lesson Writer surfaces the reviewer comment, and the frontend approval UI gains a comment textarea (required to reject). (B) Frontend run-state visuals driven centrally from the canvas via pure helpers, plus a glow keyframe. No backend/run-engine changes — `notes` is already threaded end-to-end.

**Tech Stack:** TypeScript (ESM, `.js` import extensions in workflow-runtime), Zod, React 19 + @xyflow/react, Tailwind v4, Vitest.

---

## Prerequisites & notes

- **Branch:** the repo is on `main` (with the two design specs as untracked files). Create a dedicated branch before starting: `git checkout -b feat/workflow-review-and-run-visuals`. **Do not push** — local `main` carries unpushed work; pushing is the user's call.
- **Import extensions:** `@anubis/workflow-runtime` source uses explicit `.js` extensions. Follow that. Frontend uses the `@/` alias (→ `packages/frontend/src`).
- **Running tests:**
  - workflow-runtime (root): `pnpm vitest run packages/workflow-runtime/tests/executors/<file>.test.ts`
  - frontend (own vitest; root excludes it): `pnpm --filter @anubis/frontend exec vitest run tests/<path>.test.ts`
- **Specs:** [human-review-comment](../specs/2026-06-06-human-review-comment-design.md), [workflow-run-animations](../specs/2026-06-06-workflow-run-animations-design.md).

---

# Part A — Human Review comment + Markdown fix

## Task 1: Shared `firstUpstreamText` helper + Markdown refactor

**Files:**
- Create: `packages/workflow-runtime/src/executors/_text.ts`
- Modify: `packages/workflow-runtime/src/executors/markdown-display.ts`
- Test: `packages/workflow-runtime/tests/executors/_text.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/executors/_text.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { firstUpstreamText } from '../../src/executors/_text.js'

describe('firstUpstreamText', () => {
  it('returns a direct string upstream value', () => {
    expect(firstUpstreamText({ a: 'hello' })).toBe('hello')
  })
  it('returns the `text` field of an object upstream value', () => {
    expect(firstUpstreamText({ a: { kind: 'agent', text: 'drafted' } })).toBe('drafted')
  })
  it('returns null when no text is present', () => {
    expect(firstUpstreamText({ a: { kind: 'x', count: 3 } })).toBeNull()
    expect(firstUpstreamText({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/_text.test.ts`
Expected: FAIL — cannot resolve `../../src/executors/_text.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/workflow-runtime/src/executors/_text.ts`:

```ts
/**
 * Pull the first renderable text out of an upstream map: a string value, or a
 * `text` string field on an object value. Shared by the Markdown display and
 * the Human Review pass-through so "the upstream text" means one thing.
 */
export function firstUpstreamText(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const t = (value as { text?: unknown }).text
      if (typeof t === 'string') return t
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/_text.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `markdown-display.ts` to use the shared helper**

In `packages/workflow-runtime/src/executors/markdown-display.ts`, delete the local `findFirstText` function (lines 10-19) and import the shared helper. The file becomes:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'
import { firstUpstreamText } from './_text.js'

const ConfigSchema = z.object({
  staticText: z.string().optional(),
})

export type MarkdownDisplayConfig = z.infer<typeof ConfigSchema>

export const markdownDisplayExecutor: Executor<MarkdownDisplayConfig> = {
  type: 'markdownDisplay',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const text = firstUpstreamText(input.upstream) ?? input.config.staticText ?? ''
    return { kind: 'markdown', text }
  },
}
```

- [ ] **Step 6: Run the workflow-runtime executor suite to confirm no regression**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors`
Expected: PASS (all existing executor tests still green).

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-runtime/src/executors/_text.ts packages/workflow-runtime/tests/executors/_text.test.ts packages/workflow-runtime/src/executors/markdown-display.ts
git commit -m "refactor(workflow): extract firstUpstreamText helper, reuse in markdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Human Review node surfaces the approved `text`

**Files:**
- Modify: `packages/workflow-runtime/src/executors/human-approval.ts`
- Test: `packages/workflow-runtime/tests/executors/human-approval.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/workflow-runtime/tests/executors/human-approval.test.ts`, extend the first test's assertion to include `text`, and add an empty-upstream case. Replace the existing `it('passes upstream through and returns the decision', …)` block with:

```ts
  it('passes upstream through, surfaces the approved text, and returns the decision', async () => {
    const out = await humanApprovalExecutor.run(
      { nodeId: 'gate', config: { title: 'Review' }, upstream: { x: { text: 'draft' } }, downstream: [] },
      ctx('approved'),
    )
    expect(out).toMatchObject({
      kind: 'approval', decision: 'approved', notes: 'ok',
      text: 'draft',
      reviewed: { x: { text: 'draft' } },
    })
  })

  it('surfaces empty text when upstream has no renderable text', async () => {
    const out = await humanApprovalExecutor.run(
      { nodeId: 'gate', config: {}, upstream: { x: { count: 1 } }, downstream: [] },
      ctx('approved'),
    ) as { text: string }
    expect(out.text).toBe('')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/human-approval.test.ts`
Expected: FAIL — output has no `text` field (`text: 'draft'` / `text: ''` assertions fail).

- [ ] **Step 3: Write the implementation**

In `packages/workflow-runtime/src/executors/human-approval.ts`: import the helper, add `text` to the output type, and return it. Apply these edits.

Add after the existing imports:

```ts
import { firstUpstreamText } from './_text.js'
```

Update the output interface — change:

```ts
export interface HumanApprovalOutput {
  kind: 'approval'
  decision: 'approved' | 'rejected'
  notes?: string
  /** The reviewed upstream content, passed through so the taken branch can use it. */
  reviewed: Record<string, unknown>
}
```

to:

```ts
export interface HumanApprovalOutput {
  kind: 'approval'
  decision: 'approved' | 'rejected'
  notes?: string
  /** The reviewed text, surfaced top-level so a Markdown node downstream renders it. */
  text: string
  /** The reviewed upstream content, passed through so the taken branch can use it. */
  reviewed: Record<string, unknown>
}
```

Update the `return` in `run`:

```ts
    return {
      kind: 'approval',
      decision,
      ...(notes ? { notes } : {}),
      text: firstUpstreamText(input.upstream) ?? '',
      reviewed: input.upstream,
    } satisfies HumanApprovalOutput
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/human-approval.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/human-approval.ts packages/workflow-runtime/tests/executors/human-approval.test.ts
git commit -m "fix(workflow): Human Review surfaces approved text so Markdown renders it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Lesson Writer surfaces the reviewer comment

**Files:**
- Modify: `packages/workflow-runtime/src/executors/lesson-writer.ts`
- Test: `packages/workflow-runtime/tests/executors/lesson-writer.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/workflow-runtime/tests/executors/lesson-writer.test.ts`, change `ctx` to capture the prompt content, and add a test asserting the reviewer comment is surfaced. Replace the `ctx` factory with one that records the content:

```ts
function ctx(recordCandidate: ReturnType<typeof vi.fn>, capture?: (content: string) => void): ExecutorContext {
  return {
    workspaceId: 'brand-1', runId: 'run-9', signal: new AbortController().signal, emit: () => {},
    experience: { recordCandidate },
    conversations: {
      createAndAwaitFirstTurn: async (input: { content: string }) => {
        capture?.(input.content)
        return {
          conversationId: 'c1', messageId: 'm1',
          text: 'Lesson:\n```anubis-output\n{"text":"Avoid weak hooks"}\n```',
        }
      },
      cancel: async () => {},
    },
  } as unknown as ExecutorContext
}
```

Add this test inside `describe('lessonWriterExecutor', …)`:

```ts
  it('surfaces the reviewer comment from an approval upstream into the prompt', async () => {
    const rec = vi.fn(() => ({ id: 'mem-1' }))
    let prompt = ''
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'mistake' },
        upstream: { gate: { kind: 'approval', decision: 'rejected', notes: 'hook buried the offer' } },
        downstream: [],
      },
      ctx(rec, (c) => { prompt = c }),
    )
    expect(prompt).toContain('<reviewer-comment>')
    expect(prompt).toContain('hook buried the offer')
  })

  it('omits the reviewer-comment block when there is no approval comment', async () => {
    const rec = vi.fn(() => ({ id: 'mem-1' }))
    let prompt = ''
    await lessonWriterExecutor.run(
      {
        nodeId: 'lw',
        config: { profileId: 'claude-research', lessonType: 'lesson' },
        upstream: { src: { text: 'some content' } },
        downstream: [],
      },
      ctx(rec, (c) => { prompt = c }),
    )
    expect(prompt).not.toContain('<reviewer-comment>')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/lesson-writer.test.ts`
Expected: FAIL — the new test's `prompt` has no `<reviewer-comment>` block. (The existing two tests still pass — `ctx` change is backward compatible.)

- [ ] **Step 3: Write the implementation**

In `packages/workflow-runtime/src/executors/lesson-writer.ts`:

Replace the `DEFAULT_PROMPTS.mistake` line so it references the comment:

```ts
const DEFAULT_PROMPTS: Record<'mistake' | 'lesson', string> = {
  mistake: 'The reviewed content was REJECTED. Write a concise lesson capturing the mistake and the rule to avoid it next time; use the reviewer comment as the primary reason. Put the lesson in the `text` field.',
  lesson:  'The reviewed content was APPROVED. Write a concise lesson capturing WHAT made this content work, as a reusable rule. Put the lesson in the `text` field.',
}
```

Add a helper above the executor (after `DEFAULT_PROMPTS`):

```ts
/** Pull the reviewer's note out of an upstream human-approval output, if any. */
function reviewerComment(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'approval') {
      const n = (value as { notes?: unknown }).notes
      if (typeof n === 'string' && n.trim()) return n.trim()
    }
  }
  return null
}
```

In `run`, build the content with the comment block. Replace:

```ts
    const prompt = input.config.prompt ?? DEFAULT_PROMPTS[input.config.lessonType]
    const content = [
      contextBlocks,
      'End your reply with EXACTLY one ```anubis-output``` block: { "text": "the lesson" }.',
      prompt,
    ].filter(Boolean).join('\n\n')
```

with:

```ts
    const prompt = input.config.prompt ?? DEFAULT_PROMPTS[input.config.lessonType]
    const comment = reviewerComment(input.upstream)
    const commentBlock = comment ? `<reviewer-comment>\n${comment}\n</reviewer-comment>` : ''
    const content = [
      contextBlocks,
      commentBlock,
      'End your reply with EXACTLY one ```anubis-output``` block: { "text": "the lesson" }.',
      prompt,
    ].filter(Boolean).join('\n\n')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/lesson-writer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/lesson-writer.ts packages/workflow-runtime/tests/executors/lesson-writer.test.ts
git commit -m "feat(workflow): Lesson Writer surfaces the reviewer comment explicitly

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Comment textarea on the Human Review node (required to reject)

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/human-approval.tsx`

No unit test (an executable node wired to the editor store + run API; the codebase has no
executable-node component tests). Verified by typecheck + manual.

- [ ] **Step 1: Implement the change**

Replace the body of `HumanApprovalExecutableNode` in
`packages/frontend/src/components/workflow-editor/executable-nodes/human-approval.tsx`.
Add a `notes` state, send it, gate Reject on it, and render a textarea. The full file:

```tsx
import { memo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ApprovalHandles } from '@/components/workflow/handles'
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
  const [notes, setNotes] = useState('')

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!runId) return
    if (decision === 'rejected' && !notes.trim()) return
    setBusy(true)
    try { await workflowsApi.decide(runId, { nodeId: id, decision, notes: notes.trim() || undefined }) }
    catch (e) { console.error('decision failed', e) }
    finally { setBusy(false) }
  }

  return (
    <NodeShell
      icon={ShieldCheck}
      title={data.title ?? 'Human Review'}
      subtitle={data.instructions ?? 'Approve or reject the content'}
      accent={ACCENT_GRADIENTS.review}
      runStatus={status}
      handlesNode={<ApprovalHandles />}
    >
      {status === 'awaiting' ? (
        <div className='flex flex-col gap-2'>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder='Comment (required to reject)…'
            className='nodrag w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50'
          />
          <div className='flex gap-2'>
            <Button size='sm' disabled={busy} onClick={() => decide('approved')}>Approve</Button>
            <Button size='sm' variant='destructive' disabled={busy || !notes.trim()} onClick={() => decide('rejected')}>Reject</Button>
          </div>
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>Pauses the run for your approve / reject decision.</p>
      )}
    </NodeShell>
  )
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/human-approval.tsx
git commit -m "feat(frontend): Human Review comment textarea, required to reject

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Part B — Run-state animations

## Task 5: `run-visuals` pure helpers

**Files:**
- Create: `packages/frontend/src/components/workflow/run-visuals.ts`
- Test: `packages/frontend/tests/workflow/run-visuals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/workflow/run-visuals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isRunInProgress, nodeDimmed, edgeRunState, EDGE_RUN_STYLE } from '@/components/workflow/run-visuals'

describe('isRunInProgress', () => {
  it('is true only for running / awaiting_approval', () => {
    expect(isRunInProgress({ status: 'running' })).toBe(true)
    expect(isRunInProgress({ status: 'awaiting_approval' })).toBe(true)
    expect(isRunInProgress({ status: 'succeeded' })).toBe(false)
    expect(isRunInProgress({ status: 'failed' })).toBe(false)
    expect(isRunInProgress(null)).toBe(false)
    expect(isRunInProgress(undefined)).toBe(false)
  })
})

describe('nodeDimmed', () => {
  it('dims not-yet-run and skipped nodes only while in progress', () => {
    expect(nodeDimmed(undefined, true)).toBe(true)
    expect(nodeDimmed('pending', true)).toBe(true)
    expect(nodeDimmed('skipped', true)).toBe(true)
    expect(nodeDimmed('running', true)).toBe(false)
    expect(nodeDimmed('awaiting', true)).toBe(false)
    expect(nodeDimmed('succeeded', true)).toBe(false)
    expect(nodeDimmed('failed', true)).toBe(false)
    expect(nodeDimmed('pending', false)).toBe(false)
    expect(nodeDimmed(undefined, false)).toBe(false)
  })
})

describe('edgeRunState', () => {
  it('is idle when no run is in progress', () => {
    expect(edgeRunState('succeeded', 'running', false)).toBe('idle')
    expect(edgeRunState(undefined, undefined, false)).toBe('idle')
  })
  it('flows from a finished source into the live/next target', () => {
    expect(edgeRunState('succeeded', 'running', true)).toBe('flowing')
    expect(edgeRunState('succeeded', 'awaiting', true)).toBe('flowing')
    expect(edgeRunState('succeeded', 'pending', true)).toBe('flowing')
    expect(edgeRunState('succeeded', undefined, true)).toBe('flowing')
  })
  it('settles when both ends are done', () => {
    expect(edgeRunState('succeeded', 'succeeded', true)).toBe('settled')
    expect(edgeRunState('succeeded', 'failed', true)).toBe('settled')
  })
  it('dims edges not yet reached or into skipped targets', () => {
    expect(edgeRunState('pending', 'running', true)).toBe('dim')
    expect(edgeRunState(undefined, 'pending', true)).toBe('dim')
    expect(edgeRunState('succeeded', 'skipped', true)).toBe('dim')
  })
  it('defines a style for every state; only flowing animates', () => {
    for (const s of ['idle', 'flowing', 'settled', 'dim'] as const) {
      expect(EDGE_RUN_STYLE[s]).toBeTruthy()
    }
    expect(EDGE_RUN_STYLE.flowing.animation).toContain('workflowLineDash')
    expect(EDGE_RUN_STYLE.idle.animation).toBeUndefined()
    expect(EDGE_RUN_STYLE.dim.animation).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/workflow/run-visuals.test.ts`
Expected: FAIL — cannot resolve `@/components/workflow/run-visuals`.

- [ ] **Step 3: Write the implementation**

Create `packages/frontend/src/components/workflow/run-visuals.ts`:

```ts
import type { CSSProperties } from 'react'
import type { NodeRunStatus } from './node-shell'

type RunStatusLike =
  | { status: 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled' }
  | null
  | undefined

export type EdgeRunState = 'idle' | 'flowing' | 'settled' | 'dim'

/** A run is "in progress" while it is executing or paused for approval. */
export function isRunInProgress(run: RunStatusLike): boolean {
  return run?.status === 'running' || run?.status === 'awaiting_approval'
}

/** Not-yet-run (pending/not-started) or skipped nodes dim — but only during a run. */
export function nodeDimmed(status: NodeRunStatus | undefined, inProgress: boolean): boolean {
  if (!inProgress) return false
  return status === undefined || status === 'pending' || status === 'skipped'
}

/**
 * Classify an edge for run visualization, from its endpoints' statuses:
 *  - idle:    no run in progress
 *  - flowing: source finished and target is the live/next node (data is moving)
 *  - settled: both ends finished (quiet)
 *  - dim:     not yet reached, or into a skipped branch
 */
export function edgeRunState(
  source: NodeRunStatus | undefined,
  target: NodeRunStatus | undefined,
  inProgress: boolean,
): EdgeRunState {
  if (!inProgress) return 'idle'
  if (source === 'succeeded') {
    if (target === 'succeeded' || target === 'failed') return 'settled'
    if (target === 'running' || target === 'awaiting' || target === 'pending' || target === undefined) {
      return 'flowing'
    }
  }
  return 'dim'
}

export const EDGE_RUN_STYLE: Record<EdgeRunState, CSSProperties> = {
  idle:    { strokeWidth: 2,   stroke: 'var(--anubis-gold)',    strokeOpacity: 0.5 },
  flowing: { strokeWidth: 2.5, stroke: 'var(--anubis-gold-hi)', strokeOpacity: 1, strokeDasharray: '10 8', animation: 'workflowLineDash 700ms linear infinite' },
  settled: { strokeWidth: 2,   stroke: 'var(--anubis-gold)',    strokeOpacity: 0.55 },
  dim:     { strokeWidth: 2,   stroke: 'var(--anubis-gold)',    strokeOpacity: 0.16 },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/workflow/run-visuals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/workflow/run-visuals.ts packages/frontend/tests/workflow/run-visuals.test.ts
git commit -m "feat(frontend): run-visuals helpers for edge/node run-state styling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Drive node dimming + edge flow from the canvas

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/editor-canvas.tsx`

No unit test (ReactFlow render wiring); logic is covered by Task 5. Verified by typecheck +
manual.

- [ ] **Step 1: Implement the change**

In `packages/frontend/src/components/workflow-editor/editor-canvas.tsx`:

(a) Change the React import to add `useMemo`:

```ts
import { useCallback, useMemo } from 'react'
```

(b) Add the run-visuals import after the existing `@/components/workflow` import:

```ts
import { isRunInProgress, nodeDimmed, edgeRunState, EDGE_RUN_STYLE } from '@/components/workflow/run-visuals'
```

(c) Inside `EditorCanvas`, after the existing `const edges = useEditorStore((s) => s.draft.edges)` selectors, add a subscription to the active run:

```ts
  const activeRun = useEditorStore((s) => s.activeRun)
```

(d) Replace the single line `const routedEdges = applyVisualEdgeRouting(edges)` with derived display nodes and edges:

```ts
  const inProgress = isRunInProgress(activeRun)
  const steps = activeRun?.steps

  const displayNodes = useMemo(
    () => nodes.map((n) => ({
      ...n,
      style: {
        ...n.style,
        opacity: nodeDimmed(steps?.[n.id]?.status, inProgress) ? 0.4 : 1,
        transition: 'opacity 300ms ease',
      },
    })),
    [nodes, steps, inProgress],
  )

  const displayEdges = useMemo(() => {
    const routed = applyVisualEdgeRouting(edges)
    // Idle: leave edges exactly as they are (already static in the editor).
    if (!inProgress) return routed
    return routed.map((e) => {
      const state = edgeRunState(steps?.[e.source]?.status, steps?.[e.target]?.status, true)
      return { ...e, animated: state === 'flowing', style: { ...e.style, ...EDGE_RUN_STYLE[state] } }
    })
  }, [edges, steps, inProgress])
```

(e) Update the `<ReactFlow>` props from `nodes={nodes}` / `edges={routedEdges}` to:

```tsx
        nodes={displayNodes}
        edges={displayEdges}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/editor-canvas.tsx
git commit -m "feat(frontend): dim not-yet-run nodes + flow active-path edges during runs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Animated node glow

**Files:**
- Modify: `packages/frontend/src/index.css`
- Modify: `packages/frontend/src/components/workflow/node-shell.tsx`

No unit test (CSS/visual); verified by typecheck + manual.

- [ ] **Step 1: Add the keyframe + reduced-motion rule**

In `packages/frontend/src/index.css`, after the `@keyframes anubisIndeterminate { … }` block, add:

```css
@keyframes nodeRunGlow {
  0%, 100% { box-shadow: 0 0 18px 2px color-mix(in oklab, var(--anubis-gold) 35%, transparent); }
  50%      { box-shadow: 0 0 30px 6px color-mix(in oklab, var(--anubis-gold-hi) 70%, transparent); }
}
```

Then extend the existing reduced-motion rule to include the new animation — change:

```css
@media (prefers-reduced-motion: reduce) {
  [class*='anubisPulse'],
  [class*='anubisBlink'],
  [class*='anubisIndeterminate'] {
    animation: none !important;
  }
}
```

to:

```css
@media (prefers-reduced-motion: reduce) {
  [class*='anubisPulse'],
  [class*='anubisBlink'],
  [class*='anubisIndeterminate'],
  [class*='nodeRunGlow'] {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Use the keyframe in `node-shell.tsx`**

In `packages/frontend/src/components/workflow/node-shell.tsx`, in `RUN_STATUS_BORDER`,
replace the `running` and `awaiting` entries' `animate-pulse` with the keyframe animation.
Change:

```ts
  running:   'border-primary shadow-[0_0_26px_3px_rgba(217,164,65,0.5)] animate-pulse',
  awaiting:  'border-anubis-gold-hi shadow-[0_0_30px_4px_rgba(217,164,65,0.7)] animate-pulse',
```

to:

```ts
  running:   'border-primary shadow-[0_0_26px_3px_rgba(217,164,65,0.5)] animate-[nodeRunGlow_1.6s_ease-in-out_infinite]',
  awaiting:  'border-anubis-gold-hi shadow-[0_0_30px_4px_rgba(217,164,65,0.7)] animate-[nodeRunGlow_1.6s_ease-in-out_infinite]',
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/index.css packages/frontend/src/components/workflow/node-shell.tsx
git commit -m "feat(frontend): animated breathing glow on executing nodes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: PASS across every package.

- [ ] **Step 2: Run the affected workflow-runtime suites**

Run: `pnpm vitest run packages/workflow-runtime`
Expected: PASS (all executor + runner tests).

- [ ] **Step 3: Run the frontend test suite**

Run: `pnpm --filter @anubis/frontend test`
Expected: PASS (including the new `run-visuals` tests).

- [ ] **Step 4: Manual smoke (needs the desktop app)**

Run: `pnpm dev`, open a workflow with a Human Review → Markdown + Lesson Writer (reject loop), publish, and run it. Confirm:
- **Human Review:** a comment textarea appears while awaiting; **Reject** is disabled until a comment is typed; **Approve** works with an empty comment.
- **Markdown:** after approving, the Markdown node renders the approved content (no longer empty).
- **Lesson Writer (reject):** after rejecting with a comment, the mistake lesson reflects the comment.
- **Run visuals:** while running, the active-path edges flow, the executing node glows, and not-yet-run / skipped nodes dim to ~40%; at rest and after the run finishes, edges are static and nodes are full opacity.

---

## Self-review (completed during planning)

- **Spec coverage — human-review-comment:** `_text` helper + markdown refactor (Task 1) ✓; approval surfaces `text` (Task 2) ✓; lesson-writer surfaces comment + mistake-prompt tweak (Task 3) ✓; comment textarea, required-to-reject (Task 4) ✓; Markdown-renders-approved-content via Task 2 (no markdown logic change needed) ✓.
- **Spec coverage — run-animations:** `run-visuals` helpers + `EDGE_RUN_STYLE` (Task 5) ✓; canvas dimming + edge flow (Task 6) ✓; glow keyframe + node-shell + reduced-motion (Task 7) ✓. Refinement vs spec: idle edges are left untouched (the editor's resting edges are already static, since `workflowEdgeDefaults` is only used by demo data), rather than restyled with `EDGE_RUN_STYLE.idle` — this still satisfies "idle static" and avoids changing the resting look. `EDGE_RUN_STYLE.idle` is kept as the documented resting style and is covered by the helper test.
- **Placeholder scan:** none — every code/test step is complete.
- **Type consistency:** `firstUpstreamText(upstream)` identical across Tasks 1-2; `HumanApprovalOutput.text: string` matches the executor return; `reviewerComment(upstream)` self-contained in Task 3; `isRunInProgress`/`nodeDimmed`/`edgeRunState`/`EDGE_RUN_STYLE` signatures identical between Task 5 (definition) and Task 6 (use); `NodeRunStatus` imported from `./node-shell` (where it is exported).
```
