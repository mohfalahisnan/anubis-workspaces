# Workflow AI Agent Output Envelope — Design

**Date:** 2026-06-04
**Status:** Approved (pending implementation)

## Background

The `aiAgentConversation` workflow node currently returns whatever free-form text the agent emits. Downstream nodes (`transformerBrief`, another `aiAgentConversation`, etc.) have no contract for how to consume that text. Two related problems:

1. **Unstandardized output** — downstream nodes can't deref structured fields. Templates like `{{aiNode.data.foo}}` work only by accident.
2. **Downstream-unaware AI** — the agent has no visibility into what node consumes its output, so it can't tailor the shape it produces.

## Goals

- Every AI Agent node produces output in a known JSON envelope: `{ text, data?, paths? }`.
- The agent is told, in the first (and only workflow) turn, what the downstream node is and what shape that node expects.
- The conversation that the workflow spawns stays usable for human follow-ups — the spec only matters for the first turn.
- No new skill files, no new SkillSource type, no changes to the skill loader / snapshot path.

## Non-goals

- Re-applying the spec on user follow-up turns. Workflow context only lives for the first turn.
- A registry of contracts per executor. Contracts live colocated in the AI Agent executor file; if the set grows, we revisit.
- Strict validation that the AI followed the envelope. If the AI ignores it, we fall back to whole-reply-as-text.

## Architecture

### Envelope shape

```ts
// packages/workflow-runtime/src/executors/_envelope.ts
export interface AnubisEnvelope {
  text: string
  data?: unknown
  paths?: string[]
}
```

- `text` — human-readable answer, also what the user sees in the chat.
- `data` — optional structured payload. Shape is up to the AI, guided by the downstream contract.
- `paths` — optional absolute paths to files the AI produced. Downstream `aiAgentConversation` picks these up via its existing file-shape detection.

### Composite first message

The executor composes one message:

```
<workflow-context>
{
  "runId": "abc-123",
  "nodeId": "ai-agent-1",
  "downstream": [
    { "nodeId": "transform-1", "type": "transformerBrief", "contract": "..." }
  ]
}
</workflow-context>

<output-spec>
End your reply with exactly one fenced block:
```anubis-output
{ "text": "human-readable answer", "data": {/* see contract below */}, "paths": [/* absolute file paths you produced, if any */] }
```
Free-form prose before the block is fine — it shows in the chat. Only the contents of the last `anubis-output` block are passed downstream.

Downstream contracts (adapt `data` to match):
- transformerBrief — populate `data` with the keys the next node's JSON template tokens reference (e.g. `{{thisNode.data.title}}` reads `data.title`). Always include `text`.
- aiAgentConversation — `text` is folded into the next AI's context block; `paths` are attached as files. `data` is JSON-stringified into the next node's context.
- transformerMedia / table / ocrExtractor — generic; populate `data` to match their input schema.
- Unknown / no downstream — emit the standard envelope; `data` is optional.
</output-spec>

<context source="upstream-node-id">
{ ... }
</context>
Attached files:
- C:\...\artifact.png

<user's prompt>
```

The `<workflow-context>` and `<output-spec>` blocks come first so the agent sees them before reading the upstream context and the user's prompt.

### Downstream computation

`packages/workflow-runtime/src/runner.ts` already walks the graph. We extend it to compute each node's outgoing edges and pass them in `ExecutorInput`:

```ts
export interface ExecutorInput<TConfig> {
  nodeId: string
  config: TConfig
  upstream: Record<string, unknown>
  downstream: Array<{ nodeId: string; type: string }>  // NEW
}
```

`packages/workflow-runtime/src/graph.ts` gains `outgoingEdges(graph, nodeId): string[]` mirroring `incomingEdges`.

Existing executors ignore the new field. Only `ai-agent-conversation` reads it.

### Contract registry

Colocated in the executor:

```ts
const DOWNSTREAM_CONTRACTS: Record<string, string> = {
  transformerBrief: 'Populate `data` with the keys the next node\'s JSON template references...',
  aiAgentConversation: '`text` folds into the next AI\'s context block; `paths` are attached as files...',
  transformerMedia: 'Generic — populate `data` to match the media transformer input schema.',
  table: 'Generic — populate `data` to match the table input schema.',
  ocrExtractor: 'Generic — populate `data` with image paths if you want them OCR\'d.',
}

const DEFAULT_CONTRACT = 'Emit the standard envelope; downstream node may consume `text` or `data`.'
```

Unknown types fall back to `DEFAULT_CONTRACT`.

### Envelope parser

```ts
// packages/workflow-runtime/src/executors/_envelope.ts
const FENCE_RE = /```anubis-output\s*\n([\s\S]*?)```/g

export function parseEnvelope(reply: string): AnubisEnvelope {
  let match: RegExpExecArray | null
  let lastJson: string | undefined
  while ((match = FENCE_RE.exec(reply)) !== null) lastJson = match[1]
  if (lastJson === undefined) return { text: reply.trim() }  // fallback
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
    return { text: reply.trim() }  // malformed JSON inside the fence — degrade gracefully
  }
}
```

The parser takes the **last** envelope (if the AI emits multiple), so a draft followed by a final reply works as expected.

### Executor flow

```ts
async run(input, ctx) {
  const content = composeMessage(input, ctx.runId)  // builds the full composite
  const result = await ctx.conversations.createAndAwaitFirstTurn({
    title, profileId, reasoning: input.config.reasoning, content,
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
}
```

The return shape (`kind: 'aiAgent'` instead of `'conversation'`) is a small breaking change to the output produced by the existing node. It makes the downstream-detection rules in other executors (looking for `paths` / `mediaPaths` / `{kind:'file',path}`) pick this output up naturally — `paths` is now a documented field, not just a happy-path leak.

### Data flow

```
upstream nodes ─┐
                ├──► [ai-agent-conversation]
                │      • composes <workflow-context> + <output-spec> + upstream + prompt
                │      • createAndAwaitFirstTurn(content)
                │      • parseEnvelope(reply.text)
                │      • returns { kind: 'aiAgent', conversationId, text, data?, paths? }
                │
                ▼
       [downstream node]
         • transformerBrief reads {{aiNode.data.foo}}
         • next aiAgentConversation picks up paths as attachments,
           folds text into its <context source="prevNode">
```

## Error handling

- **Empty / missing envelope** — fall back to whole-reply-as-text. Node succeeds with `{ text: reply, data: undefined, paths: undefined }`. Logged via existing run-event chain.
- **Malformed JSON in envelope** — same fallback. AI's literal reply becomes `text`. No node failure.
- **Agent run errors** — same as today (NoCredentialsError, etc. propagate from `createAndAwaitFirstTurn`).

## Testing

`packages/workflow-runtime/tests/executors/_envelope.test.ts`:
- `parseEnvelope` returns parsed object when fence present
- returns last block when multiple fences appear
- falls back to whole-reply-as-text when no fence
- falls back to whole-reply when fence JSON is malformed
- preserves `data` shape exactly (object, array, primitive)
- filters non-string entries out of `paths`

`packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts` updates:
- `composeMessage` emits `<workflow-context>` with computed downstream list
- `<output-spec>` lists the relevant downstream contract for each downstream type
- For an empty `downstream` array, `<workflow-context>` has `"downstream": []` and the spec lists the default contract only
- Executor returns the parsed envelope's fields

## File change list

**Modified**

- `packages/workflow-runtime/src/types.ts`
- `packages/workflow-runtime/src/runner.ts`
- `packages/workflow-runtime/src/graph.ts`
- `packages/workflow-runtime/src/executors/ai-agent-conversation.ts`
- `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`

**New**

- `packages/workflow-runtime/src/executors/_envelope.ts`
- `packages/workflow-runtime/tests/executors/_envelope.test.ts`

No changes to `@anubis/conversation`, no new skill files, no SkillSource changes.

## Open trade-offs

- **No new skill** — the format spec is paid in tokens once, on the workflow's first turn. User follow-up chats don't see the spec or pay tokens for it.
- **Graceful envelope fallback** — AI noncompliance doesn't fail the node. Downstream nodes that strictly need `data.foo` may then fail, which is the right place to surface the contract mismatch.
- **Contract registry colocated in the executor** — single file to update when new executors land. If the table grows past ~10 entries, move it out.
- **Output shape changes from `{ kind: 'conversation', ...}` to `{ kind: 'aiAgent', text, data?, paths? }`** — small breaking change to the workflow node's output. Acceptable because the node was just added in the prior spec.
