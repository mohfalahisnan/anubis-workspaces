# Workflow AI Agent Output Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `aiAgentConversation` workflow node emit a standardized `{ text, data?, paths? }` envelope by telling the AI (in the first turn) the format spec and the contract for whatever downstream node will consume its output.

**Architecture:** Runner computes outgoing edges per node and passes `downstream: Array<{ nodeId, type }>` in `ExecutorInput`. The executor builds a composite first message with `<workflow-context>` + `<output-spec>` + upstream + prompt. A new `_envelope.ts` helper parses the agent's reply for the last ```anubis-output JSON fence and returns it; missing/malformed envelopes fall back to whole-reply-as-text so the node never fails for AI noncompliance.

**Tech Stack:** TypeScript (ESM, `isolatedModules`, explicit `.js` imports), Zod, vitest.

**Spec:** [docs/superpowers/specs/2026-06-04-workflow-ai-agent-output-envelope-design.md](../specs/2026-06-04-workflow-ai-agent-output-envelope-design.md)

---

## Task 1: Add `outgoingEdges` helper

**Files:**
- Modify: `packages/workflow-runtime/src/graph.ts`
- Test:   `packages/workflow-runtime/tests/graph.test.ts`

- [ ] **Step 1: Write the failing test**

Open or create `packages/workflow-runtime/tests/graph.test.ts`. If the file already exists, append the describe block; if not, create with:

```ts
import { describe, it, expect } from 'vitest'
import { outgoingEdges } from '../src/graph.js'
import type { WorkflowGraph } from '../src/types.js'

const G: WorkflowGraph = {
  nodes: [
    { id: 'a', type: 't', position: { x: 0, y: 0 }, data: {} },
    { id: 'b', type: 't', position: { x: 0, y: 0 }, data: {} },
    { id: 'c', type: 't', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'a', target: 'c' },
  ],
}

describe('outgoingEdges', () => {
  it('returns target ids of edges sourced at the node', () => {
    expect(outgoingEdges(G, 'a').sort()).toEqual(['b', 'c'])
  })

  it('returns [] for a leaf node', () => {
    expect(outgoingEdges(G, 'b')).toEqual([])
  })

  it('returns [] for an unknown node', () => {
    expect(outgoingEdges(G, 'missing')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/graph.test.ts`
Expected: FAIL — `outgoingEdges` is not exported.

- [ ] **Step 3: Implement the helper**

In `packages/workflow-runtime/src/graph.ts`, append below the existing `incomingEdges`:

```ts
export function outgoingEdges(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.source === nodeId).map((e) => e.target)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/graph.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/graph.ts packages/workflow-runtime/tests/graph.test.ts
git commit -m "feat(workflow-runtime): add outgoingEdges helper"
```

---

## Task 2: Add `downstream` to `ExecutorInput`

**Files:**
- Modify: `packages/workflow-runtime/src/types.ts`

- [ ] **Step 1: Extend the type**

In `packages/workflow-runtime/src/types.ts`, replace the `ExecutorInput` interface (currently lines 34-38) with:

```ts
export interface ExecutorInput<TConfig> {
  nodeId: string
  config: TConfig
  upstream: Record<string, unknown>
  /** Outgoing nodes — used by AI-aware executors to tailor their output. */
  downstream: Array<{ nodeId: string; type: string }>
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/workflow-runtime typecheck`
Expected: existing executors don't read `downstream` so this compiles cleanly. Existing tests pass `{ nodeId, config, upstream }` without `downstream` and TS will complain — fixed in Task 3.

- [ ] **Step 3: Commit (with Task 3 — combined commit at the end of Task 3)**

Hold this change uncommitted until Task 3 completes. The two changes are tightly coupled.

---

## Task 3: Runner computes and passes `downstream`

**Files:**
- Modify: `packages/workflow-runtime/src/runner.ts`
- Modify: `packages/workflow-runtime/tests/executors/transformer-brief.test.ts`
- Modify: `packages/workflow-runtime/tests/executors/transformer-media.test.ts`
- Modify: `packages/workflow-runtime/tests/executors/table.test.ts`
- Modify: `packages/workflow-runtime/tests/executors/instagram-post.test.ts`
- Modify: `packages/workflow-runtime/tests/executors/ocr-extractor.test.ts`
- Modify: `packages/workflow-runtime/tests/executors/image-video.test.ts`
- Modify: `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`

- [ ] **Step 1: Update the runner**

In `packages/workflow-runtime/src/runner.ts`, replace the import line and the `incomingEdges` call inside the for-loop:

Find:
```ts
import { topologicalSort, incomingEdges } from './graph.js'
```

Replace with:
```ts
import { topologicalSort, incomingEdges, outgoingEdges } from './graph.js'
```

Then find:
```ts
    const upstream: Record<string, unknown> = {}
    for (const src of incomingEdges(graph, nodeId)) upstream[src] = outputs[src]
```

Replace with:
```ts
    const upstream: Record<string, unknown> = {}
    for (const src of incomingEdges(graph, nodeId)) upstream[src] = outputs[src]
    const downstream = outgoingEdges(graph, nodeId).map((targetId) => {
      const target = graph.nodes.find((n) => n.id === targetId)!
      return { nodeId: targetId, type: target.type }
    })
```

Then find the `executor.run` call:
```ts
      const output = await executor.run(
        { nodeId, config: node.data as never, upstream },
        ctx,
      )
```

Replace with:
```ts
      const output = await executor.run(
        { nodeId, config: node.data as never, upstream, downstream },
        ctx,
      )
```

- [ ] **Step 2: Update all executor test call sites**

In each of these files, find every `executor.run({ nodeId: ..., config: ..., upstream: ... }, ...)` call and add `downstream: []` to the input object.

Files to update:
- `packages/workflow-runtime/tests/executors/transformer-brief.test.ts`
- `packages/workflow-runtime/tests/executors/transformer-media.test.ts`
- `packages/workflow-runtime/tests/executors/table.test.ts`
- `packages/workflow-runtime/tests/executors/instagram-post.test.ts`
- `packages/workflow-runtime/tests/executors/ocr-extractor.test.ts`
- `packages/workflow-runtime/tests/executors/image-video.test.ts`
- `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`

Pattern — find:
```ts
{
  nodeId: '...',
  config: { ... },
  upstream: { ... },
}
```

Replace with:
```ts
{
  nodeId: '...',
  config: { ... },
  upstream: { ... },
  downstream: [],
}
```

For the existing `ai-agent-conversation.test.ts`, `downstream: []` is the right default for the existing tests (we'll add downstream-aware tests in Task 6).

- [ ] **Step 3: Typecheck the runtime package**

Run: `pnpm --filter @anubis/workflow-runtime typecheck`
Expected: PASS.

- [ ] **Step 4: Run all workflow-runtime tests**

Run: `pnpm vitest run packages/workflow-runtime`
Expected: all existing tests pass.

- [ ] **Step 5: Commit (Tasks 2 + 3 combined)**

```bash
git add packages/workflow-runtime/src/types.ts packages/workflow-runtime/src/runner.ts packages/workflow-runtime/tests/executors/
git commit -m "feat(workflow-runtime): pass downstream nodes to executors

Runner computes outgoing edges per node and passes them in
ExecutorInput. Existing executors ignore the new field; the AI Agent
executor will read it in the next commit to build downstream-aware
output prompts."
```

---

## Task 4: Envelope parser

**Files:**
- Create: `packages/workflow-runtime/src/executors/_envelope.ts`
- Test:   `packages/workflow-runtime/tests/executors/_envelope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/executors/_envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '../../src/executors/_envelope.js'

describe('parseEnvelope', () => {
  it('parses the standard envelope from a fenced anubis-output block', () => {
    const reply = 'some prose\n```anubis-output\n{"text":"hi","data":{"x":1},"paths":["/tmp/a"]}\n```\n'
    expect(parseEnvelope(reply)).toEqual({
      text: 'hi',
      data: { x: 1 },
      paths: ['/tmp/a'],
    })
  })

  it('returns the LAST fenced block when multiple are present', () => {
    const reply = '```anubis-output\n{"text":"draft"}\n```\n\n```anubis-output\n{"text":"final"}\n```\n'
    expect(parseEnvelope(reply)).toEqual({ text: 'final', data: undefined, paths: undefined })
  })

  it('falls back to whole-reply-as-text when no fence present', () => {
    const reply = 'just some plain text answer\nwith newlines'
    expect(parseEnvelope(reply)).toEqual({
      text: 'just some plain text answer\nwith newlines',
      data: undefined,
      paths: undefined,
    })
  })

  it('falls back to whole-reply when fenced JSON is malformed', () => {
    const reply = '```anubis-output\nnot json at all\n```'
    const out = parseEnvelope(reply)
    expect(out.text).toContain('not json at all')
    expect(out.data).toBeUndefined()
    expect(out.paths).toBeUndefined()
  })

  it('preserves nested data shape exactly', () => {
    const reply = '```anubis-output\n{"text":"ok","data":{"nested":{"arr":[1,2,3]}}}\n```'
    expect(parseEnvelope(reply).data).toEqual({ nested: { arr: [1, 2, 3] } })
  })

  it('filters non-string entries out of paths', () => {
    const reply = '```anubis-output\n{"text":"ok","paths":["/a", 42, null, "/b"]}\n```'
    expect(parseEnvelope(reply).paths).toEqual(['/a', '/b'])
  })

  it('omits paths field entirely when not an array', () => {
    const reply = '```anubis-output\n{"text":"ok","paths":"oops"}\n```'
    expect(parseEnvelope(reply).paths).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/_envelope.test.ts`
Expected: FAIL — `_envelope.ts` not found.

- [ ] **Step 3: Write the parser**

Create `packages/workflow-runtime/src/executors/_envelope.ts`:

```ts
export interface AnubisEnvelope {
  text: string
  data?: unknown
  paths?: string[]
}

// Match the contents of the LAST ```anubis-output ... ``` block. The /g flag
// is needed for repeated `exec` calls; we walk all matches and keep the last.
const FENCE_RE = /```anubis-output\s*\n([\s\S]*?)```/g

export function parseEnvelope(reply: string): AnubisEnvelope {
  let match: RegExpExecArray | null
  let lastJson: string | undefined
  // Reset lastIndex so the function is safe to call repeatedly.
  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(reply)) !== null) lastJson = match[1]
  if (lastJson === undefined) {
    return { text: reply.trim() }
  }
  try {
    const parsed = JSON.parse(lastJson) as Record<string, unknown>
    return {
      text: typeof parsed.text === 'string' ? parsed.text : reply.trim(),
      data: 'data' in parsed ? parsed.data : undefined,
      paths: Array.isArray(parsed.paths)
        ? parsed.paths.filter((p): p is string => typeof p === 'string')
        : undefined,
    }
  } catch {
    return { text: reply.trim() }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/_envelope.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/_envelope.ts packages/workflow-runtime/tests/executors/_envelope.test.ts
git commit -m "feat(workflow-runtime): add anubis-output envelope parser

Extracts { text, data?, paths? } from a fenced ```anubis-output JSON
block in the agent's reply. Falls back to whole-reply-as-text when the
block is missing or malformed so downstream nodes always receive a
usable text field."
```

---

## Task 5: Executor emits workflow-context + output-spec, parses envelope

**Files:**
- Modify: `packages/workflow-runtime/src/executors/ai-agent-conversation.ts`

- [ ] **Step 1: Rewrite the executor**

Replace the entire contents of `packages/workflow-runtime/src/executors/ai-agent-conversation.ts` with:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'
import { parseEnvelope } from './_envelope.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  prompt: z.string().min(1),
  titleTemplate: z.string().optional(),
})

export type AiAgentConversationConfig = z.infer<typeof ConfigSchema>

interface FileShape {
  paths?: string[]
  mediaPaths?: string[]
  kind?: string
  path?: string
}

function collectFiles(value: unknown): string[] {
  if (value == null || typeof value !== 'object') return []
  const v = value as FileShape
  const out: string[] = []
  if (Array.isArray(v.paths)) out.push(...v.paths.filter((p) => typeof p === 'string'))
  if (Array.isArray(v.mediaPaths)) out.push(...v.mediaPaths.filter((p) => typeof p === 'string'))
  if (v.kind === 'file' && typeof v.path === 'string') out.push(v.path)
  return out
}

/**
 * Per-downstream-type contract describing what `data` the next node expects.
 * The AI sees this in the <output-spec> block and adapts its output.
 * Add an entry when adding a new executor; the registry stays small enough
 * to inline. Unknown types fall back to DEFAULT_CONTRACT.
 */
const DOWNSTREAM_CONTRACTS: Record<string, string> = {
  transformerBrief:
    'Populate `data` with the keys the next node\'s JSON template references via {{thisNode.data.key}}. Always include `text`.',
  aiAgentConversation:
    '`text` is folded into the next AI\'s context block. `paths` are attached as files. `data` is JSON-stringified into the next node\'s context.',
  transformerMedia:
    'Populate `data` with the media-transformer input shape. Include `paths` for any file artifacts you produced.',
  table:
    'Populate `data` with an array of row objects matching the table input schema.',
  ocrExtractor:
    'Populate `paths` with absolute image paths to OCR. Include `text` to describe what you produced.',
  instagramPost:
    '(rare downstream) — emit the standard envelope; instagramPost is usually a source node.',
  imageVideo:
    '(rare downstream) — emit the standard envelope; imageVideo is usually a source node.',
}

const DEFAULT_CONTRACT =
  'Emit the standard envelope. Downstream may consume `text` or `data`; include any file outputs in `paths`.'

function buildWorkflowContext(
  runId: string,
  nodeId: string,
  downstream: ReadonlyArray<{ nodeId: string; type: string }>,
): string {
  const annotated = downstream.map((d) => ({
    nodeId: d.nodeId,
    type: d.type,
    contract: DOWNSTREAM_CONTRACTS[d.type] ?? DEFAULT_CONTRACT,
  }))
  const payload = { runId, nodeId, downstream: annotated }
  return `<workflow-context>\n${JSON.stringify(payload, null, 2)}\n</workflow-context>`
}

function buildOutputSpec(
  downstream: ReadonlyArray<{ nodeId: string; type: string }>,
): string {
  const seenTypes = new Set<string>()
  const contractLines: string[] = []
  for (const d of downstream) {
    if (seenTypes.has(d.type)) continue
    seenTypes.add(d.type)
    const contract = DOWNSTREAM_CONTRACTS[d.type] ?? DEFAULT_CONTRACT
    contractLines.push(`- ${d.type}: ${contract}`)
  }
  if (contractLines.length === 0) {
    contractLines.push(`- (no downstream): ${DEFAULT_CONTRACT}`)
  }
  return [
    '<output-spec>',
    'End your reply with EXACTLY ONE fenced block:',
    '```anubis-output',
    '{ "text": "human-readable answer", "data": { /* optional, see contract below */ }, "paths": [/* optional absolute file paths */] }',
    '```',
    'Prose before the block is fine — it shows in the chat. Only the contents of the last `anubis-output` block are passed downstream.',
    '',
    'Downstream contracts (adapt `data` to match):',
    ...contractLines,
    '</output-spec>',
  ].join('\n')
}

function composeMessage(
  upstream: Record<string, unknown>,
  prompt: string,
  runId: string,
  nodeId: string,
  downstream: ReadonlyArray<{ nodeId: string; type: string }>,
): string {
  const contextBlocks: string[] = []
  const files: string[] = []
  for (const [src, value] of Object.entries(upstream)) {
    files.push(...collectFiles(value))
    contextBlocks.push(`<context source="${src}">\n${JSON.stringify(value, null, 2)}\n</context>`)
  }
  const parts: string[] = [
    buildWorkflowContext(runId, nodeId, downstream),
    buildOutputSpec(downstream),
  ]
  if (contextBlocks.length > 0) parts.push(contextBlocks.join('\n'))
  if (files.length > 0) parts.push(`Attached files:\n${files.map((p) => `- ${p}`).join('\n')}`)
  parts.push(prompt)
  return parts.join('\n\n')
}

export const aiAgentConversationExecutor: Executor<AiAgentConversationConfig> = {
  type: 'aiAgentConversation',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const content = composeMessage(
      input.upstream,
      input.config.prompt,
      ctx.runId,
      input.nodeId,
      input.downstream,
    )
    const title = input.config.titleTemplate ?? `Workflow · ${input.nodeId}`
    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
    })
    const envelope = parseEnvelope(result.text)
    return {
      kind: 'aiAgent',
      conversationId: result.conversationId,
      messageId: result.messageId,
      text: envelope.text,
      data: envelope.data,
      paths: envelope.paths,
    }
  },
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/workflow-runtime typecheck`
Expected: PASS.

- [ ] **Step 3: Commit (with Task 6's test updates)**

Hold this change uncommitted. Tests in the next task assert the new behavior; commit them together.

---

## Task 6: Update + expand executor tests

**Files:**
- Modify: `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { aiAgentConversationExecutor } from '../../src/executors/ai-agent-conversation.js'

const ENVELOPE_REPLY =
  '```anubis-output\n{"text":"hi there","data":{"foo":"bar"},"paths":["/tmp/x"]}\n```'

function makeCtx(
  spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY }),
) {
  return {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: {
      createAndAwaitFirstTurn: spy,
      cancel: async () => {},
    },
    runId: 'run-1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('aiAgentConversationExecutor', () => {
  it('returns the parsed envelope fields on the output object', async () => {
    const ctx = makeCtx()
    const out = await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'claude-coding', reasoning: 'medium', prompt: 'hi' },
        upstream: {},
        downstream: [],
      },
      ctx,
    )
    expect(out).toEqual({
      kind: 'aiAgent',
      conversationId: 'c1',
      messageId: 'm1',
      text: 'hi there',
      data: { foo: 'bar' },
      paths: ['/tmp/x'],
    })
  })

  it('falls back to whole-reply-as-text when envelope is missing', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: 'just text' })
    const ctx = makeCtx(spy)
    const out = await aiAgentConversationExecutor.run(
      { nodeId: 'n1', config: { profileId: 'p', prompt: 'hi' }, upstream: {}, downstream: [] },
      ctx,
    )
    expect(out).toMatchObject({ kind: 'aiAgent', text: 'just text', data: undefined, paths: undefined })
  })

  it('emits a <workflow-context> block with runId, nodeId and downstream array', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'do it' },
        upstream: {},
        downstream: [{ nodeId: 't-1', type: 'transformerBrief' }],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<workflow-context>/)
    expect(sent).toMatch(/"runId":\s*"run-1"/)
    expect(sent).toMatch(/"nodeId":\s*"ai-1"/)
    expect(sent).toMatch(/"type":\s*"transformerBrief"/)
    expect(sent).toMatch(/<\/workflow-context>/)
  })

  it('emits an <output-spec> block with the contract for each unique downstream type', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {},
        downstream: [
          { nodeId: 't-1', type: 'transformerBrief' },
          { nodeId: 't-2', type: 'transformerBrief' },
          { nodeId: 'a-1', type: 'aiAgentConversation' },
        ],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<output-spec>/)
    expect(sent).toMatch(/anubis-output/)
    // transformerBrief appears exactly once even though listed twice in downstream
    const briefMatches = sent.match(/transformerBrief:/g) ?? []
    expect(briefMatches.length).toBe(1)
    expect(sent).toMatch(/aiAgentConversation:/)
    expect(sent).toMatch(/<\/output-spec>/)
  })

  it('uses the default contract for unknown downstream types', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {},
        downstream: [{ nodeId: 'x-1', type: 'someFutureNode' }],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/someFutureNode:/)
    expect(sent).toMatch(/Emit the standard envelope/)
  })

  it('emits a "(no downstream)" line when downstream is empty', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      { nodeId: 'ai-1', config: { profileId: 'p', prompt: 'go' }, upstream: {}, downstream: [] },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/\(no downstream\)/)
  })

  it('still wraps upstream entries in <context> blocks and lists files', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'ai-1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {
          srcA: { foo: 1, paths: ['C:\\a.png'] },
        },
        downstream: [],
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<context source="srcA">/)
    expect(sent).toMatch(/"foo": 1/)
    expect(sent).toMatch(/Attached files:/)
    expect(sent).toMatch(/- C:\\a\.png/)
  })

  it('forwards reasoning and title to createAndAwaitFirstTurn', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: ENVELOPE_REPLY })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', reasoning: 'high', prompt: 'go', titleTemplate: 'Run X' },
        upstream: {},
        downstream: [],
      },
      ctx,
    )
    expect(spy.mock.calls[0]![0].reasoning).toBe('high')
    expect(spy.mock.calls[0]![0].title).toBe('Run X')

    spy.mockClear()
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', prompt: 'go' },
        upstream: {},
        downstream: [],
      },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Workflow · n1')
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 3: Commit (with Task 5)**

```bash
git add packages/workflow-runtime/src/executors/ai-agent-conversation.ts packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts
git commit -m "feat(workflow-runtime): AI Agent node emits workflow context + parses envelope

Composite first message includes:
- <workflow-context> with runId, nodeId, and downstream { nodeId, type, contract }
- <output-spec> listing the ```anubis-output envelope schema and the
  contract for each unique downstream node type
- existing upstream <context> blocks + attached files list + user prompt

After the agent replies, parseEnvelope extracts the last anubis-output
fence as { text, data?, paths? }. Output kind is now 'aiAgent' instead
of 'conversation' so downstream file-shape detection picks up paths.
Missing / malformed envelope falls back to whole-reply-as-text."
```

---

## Task 7: Whole-repo verify

- [ ] **Step 1: Repo typecheck**

Run: `pnpm typecheck`
Expected: PASS across all 9 packages.

- [ ] **Step 2: Repo tests**

Run: `pnpm test`
Expected: all green. New tests in this plan:
- `packages/workflow-runtime/tests/graph.test.ts` (3 tests in `outgoingEdges` describe)
- `packages/workflow-runtime/tests/executors/_envelope.test.ts` (7 tests)
- `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts` (8 tests, up from 5)

Existing tests should still pass — the only behavior changes are inside the AI Agent executor, and other executor tests just got a `downstream: []` field added.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Task 8: Manual smoke test

This step is a verification, not a code change.

- [ ] **Step 1: Boot the desktop dev loop**

Run: `pnpm dev`
Expected: Electron window opens. Backend ready.

- [ ] **Step 2: Build a chained workflow**

In the workflow editor, build:
1. `Image / Video` node, configured with a sample image path
2. `AI Agent · Conversation` node connected from Image/Video, prompt: `"Describe the image briefly."`
3. `Transformer · Brief` node connected from AI Agent, template: `{"description":"{{<ai-node-id>.data.summary}}","image":"{{<ai-node-id>.paths.0}}"}`

Publish + run.

- [ ] **Step 3: Verify**

Expected:
- AI Agent node turns green.
- Open the spawned conversation. The first user message includes a `<workflow-context>` block referencing the transformerBrief downstream, and an `<output-spec>` block describing the envelope.
- The first assistant message ends with a ```anubis-output fence containing `{ "text": ..., "data": { "summary": ... }, "paths": [...] }`.
- The Transformer · Brief node receives the parsed envelope — its output JSON has the actual summary and image path substituted from the AI's `data.summary` and `paths[0]`.

If the AI doesn't follow the spec exactly, the transformerBrief will fail with `missing path: <token>` — that's the right place to surface noncompliance, since the executor itself never fails on envelope issues.

---

## Self-review notes

- **Spec coverage:** envelope shape (Task 4 + 6), composite message (Task 5 + 6), downstream computation (Task 1 + 2 + 3), contract registry (Task 5 + 6 unknown-type test), executor output shape change (Task 5 + 6), graceful fallback (Task 4 + 6 missing-envelope test). All covered.
- **Type consistency:** `ExecutorInput.downstream` is `Array<{ nodeId: string; type: string }>` everywhere — runner, type definition, executor signature, test stubs. `AnubisEnvelope` is `{ text, data?, paths? }` consistently across parser, executor return, and tests.
- **No placeholders:** every step contains the actual code or command. Task 8 is the only manual step — explicitly labelled.
