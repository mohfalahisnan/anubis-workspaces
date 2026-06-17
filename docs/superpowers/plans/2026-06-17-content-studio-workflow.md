# Content Studio Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an importable workflow ("Content Studio") that replicates the hardcoded Content Studio pipeline (extract → breakdown → refine → AI auto-review → human approval → generate → draft) inside `@anubis/workflow-runtime`, reusing existing node types and adding exactly one new node (`aiReviewGate`).

**Architecture:** One new backend executor, `aiReviewGate`, runs an agent and returns an `{ kind: 'approval', decision }` envelope — the exact shape the runner's branch logic (`runner.ts:17`) and bounded-loop logic (`runner.ts:92`) already key on, so it plugs into branching + the auto-loop with **zero runner changes**. A matching frontend executable-node + inspector form let the imported graph render and edit in the editor. The pipeline ships as a portable export JSON imported via `POST /workflows/import`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod, Vitest, React 19 + React Flow (`@xyflow/react`), Tailwind, Hono.

---

## Background the engineer needs

- **The runner's two relevant mechanics** (`packages/workflow-runtime/src/runner.ts`):
  - `selectedBranch(output)` (line 17): a node only activates a single outgoing
    branch when its output is `{ kind: 'approval', decision: 'approved' | 'rejected' }`.
    The matching outgoing edge is the one whose `sourceHandle === decision`.
  - `rearm(loopEdge)` (line 92): an edge with `data.loop: true` from a `loopSource`
    back to a re-entry `target` re-runs the region downstream of `target`. The
    iteration cap is read from the node feeding `loopSource` on its `rejected`
    branch: `nodeById.get(approvalNode).data.maxIterations` (default 3). The
    `loopSource`'s own output is preserved across iterations.
- **The canonical loop shape already proven** in `tests/runner-loop.test.ts`:
  `gate --rejected--> lesson --loop--> improve`, where `gate` returns
  `{ kind: 'approval', decision }` and carries `maxIterations`. Our `aiReviewGate`
  is that `gate` made real.
- **Envelope parsing** (`src/executors/_envelope.ts`): `parseEnvelope(reply)` returns
  `{ text, data?, paths? }` from the LAST ` ```anubis-output ``` ` fenced JSON block,
  falling back to `{ text: reply.trim() }`.
- **`@anubis/workflow-runtime` is consumed from `dist`** by the backend at runtime.
  After changing the executor registry you MUST rebuild the package
  (`pnpm --filter @anubis/workflow-runtime build`) for the running backend to see
  the new node. The package's OWN vitest tests import from `../src/*.js` and run
  against source (no rebuild needed for tests).

## Refinements to the approved spec (deliberate, documented)

1. **No `_compose.ts` extraction.** The spec floated extracting
   `aiAgentConversation`'s private composer into a shared module. We instead give
   `aiReviewGate` its own small composer, because the review node needs a *different*
   output spec (a decision block, not the generic downstream-contract block), and
   leaving the well-tested `ai-agent-conversation.ts` untouched minimizes regression
   risk. (We still add one optional downstream-contract line — Task 2.)
2. **Caption/hashtags folded into the generation agent.** The spec listed a separate
   `jsonTransformer` "caption" node. To gate generation behind approval, refined data
   must flow *through* the approval passthrough (`humanApproval.reviewed` →
   `aiReviewGate.reviewed` → `refine`), which is deeply nested and brittle to address
   by path. Instead, the single `generate` agent node (gated behind the approved
   branch) produces the image **and** the final caption/hashtags together — which is
   how a generation agent naturally works and keeps everything behind one approved
   edge. Net: a 10-node graph (was 11).

## File structure

**Create**
- `packages/workflow-runtime/src/executors/ai-review-gate.ts` — the new executor (one responsibility: AI verdict → approval envelope).
- `packages/workflow-runtime/tests/executors/ai-review-gate.test.ts` — unit tests.
- `packages/workflow-runtime/tests/content-studio-loop.test.ts` — loop behaviour with the REAL `aiReviewGate` + `lessonWriter`.
- `packages/workflow-runtime/tests/content-studio-graph.test.ts` — static validity of the shipped graph JSON.
- `workflows/content-studio.workflow.json` — the importable deliverable (repo root `workflows/`).
- `packages/frontend/src/components/workflow-editor/executable-nodes/ai-review-gate.tsx` — editor node component.
- `packages/frontend/src/components/workflow-editor/inspector/config/ai-review-gate-config.tsx` — inspector config form.

**Modify**
- `packages/workflow-runtime/src/executors/index.ts` — register `aiReviewGate` + re-export.
- `packages/workflow-runtime/src/executors/ai-agent-conversation.ts` — add one `aiReviewGate` downstream-contract line.
- `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts` — `executableNodeTypes` + `NODE_PALETTE`.
- `packages/frontend/src/components/workflow-editor/inspector-panel.tsx` — `CONFIG_FORMS`.

## Before you start

- Work on a dedicated branch or worktree (NOT `main`). Commit after each task. **Do not push** — this repo keeps unpushed local commits by convention.
- Node ≥ 22. Run all commands from the repo root.

---

### Task 1: `aiReviewGate` executor + unit tests

**Files:**
- Create: `packages/workflow-runtime/src/executors/ai-review-gate.ts`
- Test: `packages/workflow-runtime/tests/executors/ai-review-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/executors/ai-review-gate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { aiReviewGateExecutor } from '../../src/executors/ai-review-gate.js'

function makeCtx(text: string) {
  const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text })
  const ctx = {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: { createAndAwaitFirstTurn: spy, cancel: async () => {} },
    runId: 'run-1',
    signal: new AbortController().signal,
    emit: () => {},
  } as unknown as import('../../src/types.js').ExecutorContext
  return { ctx, spy }
}

const APPROVED =
  '```anubis-output\n{"text":"looks great","data":{"decision":"approved","score":92}}\n```'
const REJECTED =
  '```anubis-output\n{"text":"needs work","data":{"decision":"rejected","rejectionReason":"hook is weak","improvementInstruction":"open with a bolder claim"}}\n```'

describe('aiReviewGateExecutor', () => {
  it('emits an approval envelope and passes through reviewed upstream on approved', async () => {
    const { ctx } = makeCtx(APPROVED)
    const out = await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'review it' }, upstream: { refine: { text: 'draft' } }, downstream: [] },
      ctx,
    )
    expect(out).toMatchObject({
      kind: 'approval',
      decision: 'approved',
      reviewed: { refine: { text: 'draft' } },
      review: { decision: 'approved', score: 92 },
    })
  })

  it('rejects with notes + improvement text from the review', async () => {
    const { ctx } = makeCtx(REJECTED)
    const out = await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'review it' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(out).toMatchObject({ kind: 'approval', decision: 'rejected', notes: 'hook is weak' })
    expect((out as { text: string }).text).toBe('open with a bolder claim')
  })

  it('defaults to rejected when the reply has no valid decision', async () => {
    const { ctx } = makeCtx('no fenced block here')
    const out = await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'review it' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect((out as { decision: string }).decision).toBe('rejected')
  })

  it('forwards profile, reasoning, title and workflow metadata to the conversation', async () => {
    const { ctx, spy } = makeCtx(APPROVED)
    await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', reasoning: 'high', prompt: 'go', titleTemplate: 'Rev' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(spy.mock.calls[0]![0]).toMatchObject({
      profileId: 'p', reasoning: 'high', title: 'Rev', source: 'workflow', workflow: { runId: 'run-1', nodeId: 'review' },
    })
  })

  it('defaults the conversation title to "Review · {nodeId}"', async () => {
    const { ctx, spy } = makeCtx(APPROVED)
    await aiReviewGateExecutor.run(
      { nodeId: 'review', config: { profileId: 'p', prompt: 'go' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Review · review')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/ai-review-gate.test.ts`
Expected: FAIL — cannot resolve `../../src/executors/ai-review-gate.js` (module not created yet).

- [ ] **Step 3: Write the executor**

Create `packages/workflow-runtime/src/executors/ai-review-gate.ts`:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'
import { parseEnvelope } from './_envelope.js'
import { firstUpstreamText } from './_text.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  prompt: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  titleTemplate: z.string().optional(),
  maxIterations: z.number().int().positive().max(20).optional(),
})

export type AiReviewGateConfig = z.infer<typeof ConfigSchema>

export interface AiReviewGateOutput {
  kind: 'approval'
  decision: 'approved' | 'rejected'
  notes?: string
  /** Improvement instruction (reject) or verdict summary (approve). Fed to lessonWriter on reject. */
  text: string
  /** Upstream passed through so the approved branch keeps the refined content. */
  reviewed: Record<string, unknown>
  /** Full parsed review payload (decision, score, checklist, ...). */
  review: unknown
}

/** Output spec appended to the prompt so the agent returns a parseable verdict. */
const REVIEW_OUTPUT_SPEC = [
  '<output-spec>',
  'End your reply with EXACTLY ONE fenced block:',
  '```anubis-output',
  '{ "text": "one-line verdict", "data": { "decision": "approved" | "rejected", "score": 0, "checklist": [{ "label": "", "pass": true }], "rejectionReason": "", "improvementInstruction": "" } }',
  '```',
  'Set data.decision to "approved" ONLY if the content is publish-ready. On "rejected", fill rejectionReason and a concrete improvementInstruction telling the next pass exactly what to fix.',
  '</output-spec>',
].join('\n')

function composeMessage(upstream: Record<string, unknown>, prompt: string): string {
  const contextBlocks = Object.entries(upstream)
    .map(([src, v]) => `<context source="${src}">\n${JSON.stringify(v, null, 2)}\n</context>`)
    .join('\n')
  return [REVIEW_OUTPUT_SPEC, contextBlocks, prompt].filter(Boolean).join('\n\n')
}

function readDecision(data: unknown): { decision: 'approved' | 'rejected'; reason?: string } {
  if (data && typeof data === 'object') {
    const d = data as { decision?: unknown; rejectionReason?: unknown; improvementInstruction?: unknown }
    if (d.decision === 'approved') return { decision: 'approved' }
    if (d.decision === 'rejected') {
      const reason =
        typeof d.rejectionReason === 'string' ? d.rejectionReason
        : typeof d.improvementInstruction === 'string' ? d.improvementInstruction
        : undefined
      return { decision: 'rejected', reason }
    }
  }
  return { decision: 'rejected', reason: 'review did not return a valid decision; treating as rejected' }
}

function improvementText(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const d = data as { improvementInstruction?: unknown; rejectionReason?: unknown }
    if (typeof d.improvementInstruction === 'string' && d.improvementInstruction.trim()) return d.improvementInstruction
    if (typeof d.rejectionReason === 'string' && d.rejectionReason.trim()) return d.rejectionReason
  }
  return undefined
}

/**
 * Runs an agent to review upstream content and emits an `approval` envelope.
 * Because the envelope `kind` is `'approval'`, the runner branches on `decision`
 * and reads `maxIterations` here to bound the reject→lesson→refine loop —
 * no runner changes needed.
 */
export const aiReviewGateExecutor: Executor<AiReviewGateConfig> = {
  type: 'aiReviewGate',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx): Promise<AiReviewGateOutput> {
    const content = composeMessage(input.upstream, input.config.prompt)
    const title = input.config.titleTemplate ?? `Review · ${input.nodeId}`
    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
      source: 'workflow',
      workflow: { runId: ctx.runId, nodeId: input.nodeId },
    })
    const env = parseEnvelope(result.text)
    const { decision, reason } = readDecision(env.data)
    const text =
      decision === 'rejected'
        ? improvementText(env.data) ?? env.text
        : env.text
    return {
      kind: 'approval',
      decision,
      ...(reason ? { notes: reason } : {}),
      text: text || env.text || firstUpstreamText(input.upstream) || '',
      reviewed: input.upstream,
      review: env.data,
    }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/ai-review-gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/ai-review-gate.ts packages/workflow-runtime/tests/executors/ai-review-gate.test.ts
git commit -m "feat(workflow): add aiReviewGate executor (AI verdict → approval envelope)"
```

---

### Task 2: Register `aiReviewGate` in the executor registry

**Files:**
- Modify: `packages/workflow-runtime/src/executors/index.ts`
- Modify: `packages/workflow-runtime/src/executors/ai-agent-conversation.ts:37-54` (add one contract line)

- [ ] **Step 1: Register the executor**

In `packages/workflow-runtime/src/executors/index.ts`, add the import alongside the others (after the `humanApprovalExecutor` import on line 13):

```ts
import { aiReviewGateExecutor }         from './ai-review-gate.js'
```

Add to the `executorRegistry` object (after the `humanApproval` line):

```ts
  aiReviewGate:         aiReviewGateExecutor as Executor<unknown>,
```

Add `aiReviewGateExecutor` to the bottom `export { ... }` block (next to `humanApprovalExecutor`).

- [ ] **Step 2: Add the downstream-contract line (so `refine` knows what to emit)**

In `packages/workflow-runtime/src/executors/ai-agent-conversation.ts`, inside the
`DOWNSTREAM_CONTRACTS` record (around line 37-54), add:

```ts
  aiReviewGate:
    'A reviewer reads your output. Put the content to be judged in `data` and a readable summary in `text`.',
```

- [ ] **Step 3: Typecheck the package**

Run: `pnpm --filter @anubis/workflow-runtime exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/workflow-runtime/src/executors/index.ts packages/workflow-runtime/src/executors/ai-agent-conversation.ts
git commit -m "feat(workflow): register aiReviewGate + add its downstream contract"
```

---

### Task 3: Loop behaviour with the real `aiReviewGate` + `lessonWriter`

This proves the new node drives the bounded auto-loop end-to-end through the real
runner, using the real `aiReviewGate` and real `lessonWriter` (only the refine/done
endpoints are stubs). The conversation stub returns a verdict for the reviewer
profile and a lesson for the lesson profile (disambiguated by `profileId`).

**Files:**
- Test: `packages/workflow-runtime/tests/content-studio-loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/content-studio-loop.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { runWorkflow } from '../src/runner.js'
import { aiReviewGateExecutor } from '../src/executors/ai-review-gate.js'
import { lessonWriterExecutor } from '../src/executors/lesson-writer.js'
import type { Executor, ExecutorContext, WorkflowGraph } from '../src/types.js'

function verdict(decision: 'approved' | 'rejected'): string {
  return `\`\`\`anubis-output\n{"text":"v","data":{"decision":"${decision}","rejectionReason":"fix it","improvementInstruction":"do better"}}\n\`\`\``
}
const LESSON_REPLY = '```anubis-output\n{"text":"lesson text"}\n```'

/** Returns a verdict for profile `reviewer`, a lesson otherwise. `approveOnAttempt` = which review call approves. */
function makeCtx(approveOnAttempt: number) {
  let reviewCalls = 0
  const conversations = {
    createAndAwaitFirstTurn: vi.fn(async ({ profileId }: { profileId: string }) => {
      if (profileId === 'reviewer') {
        reviewCalls++
        return { conversationId: 'c', messageId: 'm', text: verdict(reviewCalls >= approveOnAttempt ? 'approved' : 'rejected') }
      }
      return { conversationId: 'c', messageId: 'm', text: LESSON_REPLY }
    }),
    cancel: async () => {},
  }
  const lessons = { write: vi.fn(async () => ({ path: '/tmp/lesson.md' })) }
  const ctx = { conversations, lessons, runId: 'r1', signal: new AbortController().signal, emit: () => {} } as unknown as ExecutorContext
  return { ctx, conversations, lessons, reviews: () => reviewCalls }
}

function graph(maxIterations: number): WorkflowGraph {
  return {
    nodes: [
      { id: 'refine', type: 'refine', position: { x: 0, y: 0 }, data: {} },
      { id: 'review', type: 'aiReviewGate', position: { x: 1, y: 0 }, data: { profileId: 'reviewer', prompt: 'review', maxIterations } },
      { id: 'lesson', type: 'lessonWriter', position: { x: 2, y: 1 }, data: { profileId: 'lessoner', lessonType: 'mistake' } },
      { id: 'done', type: 'done', position: { x: 2, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'refine', target: 'review' },
      { id: 'e2', source: 'review', target: 'done', sourceHandle: 'approved' },
      { id: 'e3', source: 'review', target: 'lesson', sourceHandle: 'rejected' },
      { id: 'e4', source: 'lesson', target: 'refine', data: { loop: true } },
    ],
  }
}

function registry(): Record<string, Executor<unknown>> {
  let refineCalls = 0
  return {
    refine: { type: 'refine', validateConfig: (c) => c, run: async () => ({ kind: 'aiAgent', text: `draft-${++refineCalls}`, data: { caption: 'c' } }) },
    aiReviewGate: aiReviewGateExecutor as Executor<unknown>,
    lessonWriter: lessonWriterExecutor as Executor<unknown>,
    done: { type: 'done', validateConfig: (c) => c, run: async () => ({ value: 'final' }) },
  }
}

describe('content studio review loop (real aiReviewGate + lessonWriter)', () => {
  it('loops reject→lesson→refine until approved, bounded by maxIterations', async () => {
    const { ctx, lessons, reviews } = makeCtx(3) // approve on the 3rd review
    const res = await runWorkflow(graph(5), registry(), ctx)
    expect(res.status).toBe('succeeded')
    expect(res.stepStatuses.done).toBe('succeeded')
    expect(reviews()).toBe(3)
    expect(lessons.write).toHaveBeenCalledTimes(2) // two rejections wrote two lessons
  })

  it('ends rejected when maxIterations is exceeded', async () => {
    const { ctx } = makeCtx(99) // never approves
    const res = await runWorkflow(graph(2), registry(), ctx)
    expect(res.status).toBe('rejected')
    expect(res.stepStatuses.done).toBe('skipped')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (then passes once Task 1/2 are in)**

Run: `pnpm vitest run packages/workflow-runtime/tests/content-studio-loop.test.ts`
Expected: PASS (Task 1's executor already exists). If you are doing this task in
isolation before Task 1, it FAILs on the missing import — that is the expected
red state.

- [ ] **Step 3: Commit**

```bash
git add packages/workflow-runtime/tests/content-studio-loop.test.ts
git commit -m "test(workflow): aiReviewGate drives the bounded review loop end-to-end"
```

---

### Task 4: Ship the `content-studio.workflow.json` deliverable + validity test

**Files:**
- Create: `workflows/content-studio.workflow.json`
- Test: `packages/workflow-runtime/tests/content-studio-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/content-studio-graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WorkflowGraphSchema } from '../src/types.js'
import { assertAcyclicExceptLoops } from '../src/graph.js'
import { executorRegistry } from '../src/executors/index.js'

const FILE = fileURLToPath(new URL('../../../workflows/content-studio.workflow.json', import.meta.url))
const doc = JSON.parse(readFileSync(FILE, 'utf-8')) as {
  anubisWorkflowExport: number
  name: string
  graph: unknown
}

describe('content-studio.workflow.json', () => {
  it('is a versioned export with a name', () => {
    expect(doc.anubisWorkflowExport).toBe(1)
    expect(doc.name).toBe('Content Studio')
  })

  it('is a schema-valid, acyclic-except-loops graph', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    expect(() => assertAcyclicExceptLoops(graph)).not.toThrow()
  })

  it('uses only registered node types', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    for (const node of graph.nodes) {
      expect(executorRegistry[node.type], `missing executor: ${node.type}`).toBeDefined()
    }
  })

  it('wires the AI review gate, its loop, and its branches correctly', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    const gates = graph.nodes.filter((n) => n.type === 'aiReviewGate')
    expect(gates).toHaveLength(1)
    expect((gates[0]!.data as { maxIterations?: number }).maxIterations).toBe(3)

    const gateId = gates[0]!.id
    const approved = graph.edges.find((e) => e.source === gateId && e.sourceHandle === 'approved')
    const rejected = graph.edges.find((e) => e.source === gateId && e.sourceHandle === 'rejected')
    expect(approved, 'approved branch edge').toBeDefined()
    expect(rejected, 'rejected branch edge').toBeDefined()

    // rejected → lessonWriter → loop-back
    const lessonId = rejected!.target
    expect(graph.nodes.find((n) => n.id === lessonId)!.type).toBe('lessonWriter')
    const loop = graph.edges.find((e) => e.source === lessonId && e.data?.loop === true)
    expect(loop, 'loop back-edge from lessonWriter').toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/content-studio-graph.test.ts`
Expected: FAIL — cannot read `workflows/content-studio.workflow.json` (file not created yet).

- [ ] **Step 3: Create the deliverable JSON**

Create `workflows/content-studio.workflow.json` (replace `REPLACE_WITH_REFERENCE`
and the placeholder `profileId`s after import, or override per run). Note: text
profiles use `default` and the generation node uses `codex-image`; adjust to real
profile ids in your app.

```json
{
  "anubisWorkflowExport": 1,
  "name": "Content Studio",
  "description": "Idea to reviewed draft: extract a reference post, break it down, refine, AI auto-review (loops up to 3x), human approval, then generate the visual + caption and assemble a draft.",
  "graph": {
    "nodes": [
      {
        "id": "ig",
        "type": "instagramPost",
        "position": { "x": 0, "y": 0 },
        "data": { "source": "url", "url": "https://www.instagram.com/p/REPLACE_WITH_REFERENCE/" }
      },
      {
        "id": "breakdown",
        "type": "aiAgentConversation",
        "position": { "x": 260, "y": 0 },
        "data": {
          "profileId": "default",
          "reasoning": "medium",
          "titleTemplate": "Breakdown",
          "prompt": "You are analysing a reference Instagram post to produce a content brief. From the reference post in context (caption, media, metrics), extract what makes it work and produce an improved brief for NEW original content in the same niche. Return JSON in `data` with keys: coreIdea, targetAudience, problem, mainMessage, hook, toneDirection, adaptationStrategy. Put a short human-readable summary in `text`."
        }
      },
      {
        "id": "refine",
        "type": "aiAgentConversation",
        "position": { "x": 520, "y": 0 },
        "data": {
          "profileId": "default",
          "reasoning": "medium",
          "titleTemplate": "Refine",
          "prompt": "Turn the brief in context into content-ready material for a single Instagram post. Return JSON in `data` with keys: caption (final caption text), hashtags (array of strings), visualBrief (object: concept, subject, layout, mood, style, keyElements, textOverlay). Put the final caption in `text`. If a lesson from a previous rejected attempt is present in context, incorporate it and fix what it flags."
        }
      },
      {
        "id": "review",
        "type": "aiReviewGate",
        "position": { "x": 780, "y": 0 },
        "data": {
          "profileId": "default",
          "reasoning": "high",
          "maxIterations": 3,
          "titleTemplate": "AI Review",
          "prompt": "Review the refined content in context for publish-readiness. Judge it on: on-brief alignment, hook strength, clarity, originality, and platform fit. Approve ONLY if it is genuinely ready to publish; otherwise reject with a specific, actionable improvement instruction."
        }
      },
      {
        "id": "lesson",
        "type": "lessonWriter",
        "position": { "x": 780, "y": 220 },
        "data": { "profileId": "default", "lessonType": "mistake", "titleTemplate": "Lesson" }
      },
      {
        "id": "human",
        "type": "humanApproval",
        "position": { "x": 1040, "y": 0 },
        "data": {
          "title": "Approve content",
          "instructions": "Approve to generate the visual + final caption, or reject with a comment to send it back to refine."
        }
      },
      {
        "id": "generate",
        "type": "aiAgentConversation",
        "position": { "x": 1300, "y": 0 },
        "data": {
          "profileId": "codex-image",
          "titleTemplate": "Generate assets",
          "prompt": "You are generating the final assets for the APPROVED Instagram post described in context. 1) Generate the post image from the visual brief using your image tool (e.g. $imagegen) and save the file into the current working directory. 2) Produce the final caption and hashtags. Return the saved image file path(s) in `paths`, the final caption text in `text`, and `{ \"caption\": \"...\", \"hashtags\": [\"...\"] }` in `data`."
        }
      },
      {
        "id": "preview",
        "type": "instagramDraftPreview",
        "position": { "x": 1560, "y": 0 },
        "data": { "username": "your_brand", "format": "post" }
      },
      {
        "id": "planner",
        "type": "savePlanner",
        "position": { "x": 1560, "y": 220 },
        "data": { "status": "review", "title": "Content Studio draft" }
      },
      {
        "id": "capture",
        "type": "outputCapturer",
        "position": { "x": 1820, "y": 0 },
        "data": { "extension": "json", "filename": "content-studio-draft-{timestamp}" }
      }
    ],
    "edges": [
      { "id": "e1", "source": "ig", "target": "breakdown" },
      { "id": "e2", "source": "breakdown", "target": "refine" },
      { "id": "e3", "source": "refine", "target": "review" },
      { "id": "e4", "source": "review", "target": "human", "sourceHandle": "approved" },
      { "id": "e5", "source": "review", "target": "lesson", "sourceHandle": "rejected" },
      { "id": "e6", "source": "lesson", "target": "refine", "data": { "loop": true } },
      { "id": "e7", "source": "human", "target": "generate", "sourceHandle": "approved" },
      { "id": "e8", "source": "generate", "target": "preview" },
      { "id": "e9", "source": "generate", "target": "planner" },
      { "id": "e10", "source": "preview", "target": "capture" }
    ]
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/content-studio-graph.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add workflows/content-studio.workflow.json packages/workflow-runtime/tests/content-studio-graph.test.ts
git commit -m "feat(workflow): ship importable Content Studio workflow + validity test"
```

---

### Task 5: Frontend editor node component + palette/registry

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/ai-review-gate.tsx`
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`

- [ ] **Step 1: Create the node component**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/ai-review-gate.tsx`:

```tsx
import { memo } from 'react'
import { ShieldCheck } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ApprovalHandles } from '@/components/workflow/handles'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { useNodeRunStatus } from './_use-run-status'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface AiReviewGateNodeData extends TitledNodeData {
  prompt?: string
  maxIterations?: number
}

export const AiReviewGateExecutableNode = memo(function AiReviewGateExecutableNode(
  { id, data }: { id: string; data: AiReviewGateNodeData },
) {
  const status = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={ShieldCheck}
      title={nodeTitle(data, 'AI Review')}
      subtitle='An agent reviews the content and branches approve / reject.'
      accent={ACCENT_GRADIENTS.review}
      runStatus={status}
      handlesNode={<ApprovalHandles />}
    >
      <p className='text-xs text-muted-foreground'>
        Auto-reviews upstream content; reject loops back up to {data.maxIterations ?? 3}×.
      </p>
    </NodeShell>
  )
})
```

- [ ] **Step 2: Register the node type + palette entry**

In `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`:

Add the import (after the `HumanApprovalExecutableNode` import, line 13):

```ts
import { AiReviewGateExecutableNode }       from './ai-review-gate'
```

Add to `executableNodeTypes` (after the `humanApproval` line):

```ts
  aiReviewGate:        AiReviewGateExecutableNode as never,
```

Add to `NODE_PALETTE` in the `agent` group (after the `humanApproval` entry):

```ts
  { type: 'aiReviewGate',        label: 'AI Review',              category: 'agent'    },
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/ai-review-gate.tsx packages/frontend/src/components/workflow-editor/executable-nodes/index.ts
git commit -m "feat(frontend): aiReviewGate editor node + palette entry"
```

---

### Task 6: Frontend inspector config form

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/inspector/config/ai-review-gate-config.tsx`
- Modify: `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`

- [ ] **Step 1: Create the config form**

Create `packages/frontend/src/components/workflow-editor/inspector/config/ai-review-gate-config.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listProfiles } from '@/api'

type Reasoning = 'minimal' | 'low' | 'medium' | 'high'
type Data = { profileId?: string; reasoning?: Reasoning; prompt?: string; titleTemplate?: string; maxIterations?: number }

export function AiReviewGateConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    listProfiles()
      .then((items) => setProfiles(items.map((p) => ({ id: p.id, name: p.name }))))
      .catch(console.error)
  }, [])

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n)))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>AI Review</p>
      <label className='block text-xs'>Profile
        <Select value={data.profileId ?? ''} onValueChange={(v) => update({ profileId: v })}>
          <SelectTrigger className='mt-1'><SelectValue placeholder='Pick a profile' /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Reasoning effort
        <Select value={data.reasoning ?? 'high'} onValueChange={(v) => update({ reasoning: v as Reasoning })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='minimal'>minimal</SelectItem>
            <SelectItem value='low'>low</SelectItem>
            <SelectItem value='medium'>medium</SelectItem>
            <SelectItem value='high'>high</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Review prompt
        <Textarea className='mt-1' rows={6} value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} />
      </label>
      <label className='block text-xs'>Max loop iterations (reject → refine)
        <Input
          type='number' min={1} className='mt-1'
          value={data.maxIterations ?? 3}
          onChange={(e) => update({ maxIterations: Number(e.target.value) || undefined })}
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Register the form**

In `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`:

Add the import (after the `HumanApprovalConfigForm` import, line 14):

```ts
import { AiReviewGateConfigForm } from './inspector/config/ai-review-gate-config'
```

Add to `CONFIG_FORMS` (after the `humanApproval` line):

```ts
  aiReviewGate:        AiReviewGateConfigForm,
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/inspector/config/ai-review-gate-config.tsx packages/frontend/src/components/workflow-editor/inspector-panel.tsx
git commit -m "feat(frontend): aiReviewGate inspector config form"
```

---

### Task 7: Build, full test pass, and import verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild workflow-runtime so the backend sees the new node**

Run: `pnpm --filter @anubis/workflow-runtime build`
Expected: build succeeds; `aiReviewGate` is in the compiled `dist/executors/index.js` registry.

- [ ] **Step 2: Run the full workflow-runtime test suite**

Run: `pnpm vitest run packages/workflow-runtime --maxWorkers=2`
Expected: all tests pass (new + existing). `--maxWorkers=2` avoids the known worker-contention flakiness.

- [ ] **Step 3: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors across packages.

- [ ] **Step 4: Build the frontend**

Run: `pnpm --filter @anubis/frontend build`
Expected: build succeeds.

- [ ] **Step 5: Manual import + render verification**

Start the app (`pnpm dev`) or the backend alone (`pnpm --filter @anubis/backend dev:server`), then import the workflow against the backend's base URL (dev port is dynamic — read it from the dev logs / `anubis:get-backend-url`; the packaged port is `4317`):

```bash
curl -X POST "http://127.0.0.1:<BACKEND_PORT>/workflows/import" \
  -H 'Content-Type: application/json' \
  --data @workflows/content-studio.workflow.json
```

Expected: `201` with the new workflow's JSON (id, name "Content Studio"). Then in the app: open the Workflows page, open "Content Studio", and confirm:
- all 10 nodes render (no blank/"unknown" nodes),
- the `aiReviewGate` node shows the **AI Review** card with approve (OK) / reject (NO) handles,
- selecting it shows the **AI Review** config form (profile, reasoning, prompt, max iterations) — not "No config form for type aiReviewGate",
- the `lesson → refine` loop edge is present.

- [ ] **Step 6: Commit (if any verification-driven fixes were made)**

```bash
git add -A
git commit -m "chore(workflow): verify Content Studio workflow import + render"
```

---

## Self-review (completed by plan author)

**Spec coverage:**
- extract → `ig` (Task 4). breakdown/refine → `breakdown`/`refine` (Task 4). ai_review + auto-loop → `aiReviewGate` (Tasks 1–3) + `lesson`/loop edge (Task 4). human_review → `human` (Task 4). generation → `generate` (Task 4; caption folded in — documented). draft → `preview`/`planner`/`capture` (Task 4). New node backend → Tasks 1–2; frontend → Tasks 5–6. Deliverable importable JSON → Task 4 + Task 7 Step 5. Verification → Tasks 1,3,4,7. ✔
- Deviations from spec are explicitly documented ("Refinements" section): no `_compose.ts` extraction; caption folded into the generation agent (11→10 nodes). ✔

**Placeholder scan:** No TBD/TODO. The JSON's `REPLACE_WITH_REFERENCE` URL, `your_brand` username, and `default`/`codex-image` profile ids are intentional, documented user-configurable values (set after import or via run overrides), not plan gaps. ✔

**Type/name consistency:** `aiReviewGateExecutor` / type string `'aiReviewGate'` / `AiReviewGateConfig` / `AiReviewGateOutput` used consistently across executor, registry, tests, and graph. Frontend `AiReviewGateExecutableNode` (registry key `aiReviewGate`) and `AiReviewGateConfigForm` (CONFIG_FORMS key `aiReviewGate`) match. Output envelope (`kind:'approval'`, `decision`, `notes`, `text`, `reviewed`, `review`) is consistent between the executor, its unit tests, and the loop test. ✔
