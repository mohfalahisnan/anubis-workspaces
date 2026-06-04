# Workflow AI Agent Conversation Node — Design

**Date:** 2026-06-04
**Status:** Approved (pending implementation)

## Background

Commit `89252ff` removed the previous `aiAgent` workflow node, which ran a stateless one-shot agent call inline as part of a workflow run. We want to replace it with a node that has a different shape: instead of running an agent invisibly, it **spawns a persistent conversation** (a chat row in the DB, visible in the chat list) that the user can keep interacting with after the workflow finishes.

The workflow still benefits from the agent's first response — the node blocks until that response is ready and forwards the assistant text to downstream nodes — but the conversation itself outlives the workflow run.

A separate, smaller change rides along: the builtin Claude profiles default to `permissionMode: 'plan'`, which forces the agent into plan mode on every fresh conversation. Users have asked for that to be off by default. This spec removes plan-mode-as-default from the builtin profiles.

## Goals

1. New `aiAgentConversation` workflow node that:
   - Lets the user pick a profile and reasoning effort in the node config
   - Lets the user write an initial prompt in the node config
   - Takes upstream node outputs and attaches them to the initial message (as text or file references)
   - Creates a real conversation row, sends the initial message, waits for the first agent turn to complete, and outputs the assistant's reply
2. The created conversation is persistent and continues to behave like any other chat (user can open it and send follow-up messages).
3. Strip `permissionMode: 'plan'` from the builtin profiles so fresh conversations are not plan-mode by default. Rename `"Claude — Coding (plan mode)"` → `"Claude — Coding"`.

## Non-goals

- Migrating existing user-saved profiles. User overrides of `permissionMode: 'plan'` stay as-is.
- A new attachment file format. Upstream-as-files is exposed by inlining absolute paths into the initial message; the agent reads them with its existing tools.
- Multi-turn execution inside the workflow. The node waits for one turn only.
- Resuming a pre-existing conversation. The node always creates a new one.

## Architecture

### Node config schema

```ts
// packages/workflow-runtime/src/executors/ai-agent-conversation.ts
const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  prompt: z.string().min(1),
  titleTemplate: z.string().optional(),  // defaults to "Workflow · <nodeId>"
})
export type AiAgentConversationConfig = z.infer<typeof ConfigSchema>
```

Reasoning is always shown in the UI and always forwarded to the resolver. The resolver already ignores unknown options for Claude, so Claude profiles silently drop it.

### Input composition

The executor receives `input.upstream: Record<srcNodeId, unknown>`. For each upstream entry:

- **File-bearing shapes** — value matches one of:
  - `{ paths: string[] }`
  - `{ mediaPaths: string[] }`
  - `{ kind: 'file', path: string }`

  → the file paths are collected into an attachment list.

- **Everything else** — JSON-stringified and wrapped in a `<context source="<srcNodeId>">…</context>` block.

The composed initial message:

```
<context source="ig-1">
{ ...json... }
</context>
<context source="brief-2">
{ ...json... }
</context>

Attached files:
- <abs path 1>
- <abs path 2>

<prompt from config>
```

If there are no upstream entries the message is just the prompt. If there are no file paths the "Attached files" section is omitted.

### Behavior

1. Validate config; resolve the chosen profile with `override = { reasoning }`.
2. Compose the initial message from `input.upstream` + `input.config.prompt` as above.
3. Call `ctx.conversations.createAndAwaitFirstTurn({ title, profileId, override, content })`.
4. Return `{ kind: 'conversation', conversationId, messageId, text }`.

The conversation persists with `status: 'idle'` (or `'error'` on failure) after the first turn finishes.

### Cancellation

If `ctx.signal` is aborted while the conversation is mid-turn, the executor calls `ctx.conversations.cancel(conversationId)` to kill the running task. The conversation row stays in the DB with `status: 'error'`. The node reports `failed`.

### New `ConversationService` method

```ts
// packages/conversation/src/conversations/conversation-service.ts
async createAndAwaitFirstTurn(input: {
  title: string
  profileId: string
  override?: ProfileOverride
  content: string
  workspacePath?: string
  signal?: AbortSignal
}): Promise<{ conversationId: string; messageId: string; text: string }>
```

Implementation:

1. `create({ title, profileId, override, workspacePath })` → `Conversation`.
2. `sendMessage(conversation.id, { content })` → starts the task and attaches the stream relay.
3. Wait for the relay's attach promise to resolve (it resolves when the task emitter closes). If `signal` aborts during the wait, call `cancel(conversation.id)` and throw.
4. Read the latest assistant message via `MessagesRepo.listForConversation(id)` and return its text.

This re-uses every piece of the existing send path — profile resolution, skill snapshot, agent home bootstrap, env wiring, MCP servers, SSE broadcast. The workflow gets the same conversation behavior the chat UI gets.

### ExecutorContext additions

```ts
// packages/workflow-runtime/src/types.ts
export interface ExecutorContext {
  // …existing fields…
  conversations: {
    createAndAwaitFirstTurn(input: {
      title: string
      profileId: string
      override?: { reasoning?: ReasoningEffort }
      content: string
    }): Promise<{ conversationId: string; messageId: string; text: string }>
    cancel(conversationId: string): Promise<void>
  }
}
```

### Backend wiring

`packages/backend/src/workflow-run-manager.ts` builds the `ExecutorContext` per run. Add a `conversations` field built from the existing `ConversationService` instance, forwarding the workflow's `AbortSignal` into the call:

```ts
conversations: {
  createAndAwaitFirstTurn: (input) =>
    conversationService.createAndAwaitFirstTurn({ ...input, signal }),
  cancel: (id) => conversationService.cancel(id),
}
```

### Frontend

**Node renderer** — `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`:

- Card title `"AI Agent · Conversation"`, profile name + reasoning badge underneath.
- Prompt preview (first ~120 chars).
- Run-state badge using existing `_run-state-badge.tsx` helper.
- When the node has a successful output with `conversationId`, render an `"Open chat →"` link that navigates to `/conversations/:id`.

**Inspector config** — `packages/frontend/src/components/workflow-editor/inspector/config/ai-agent-conversation-config.tsx`:

- Profile select (reuses `listProfiles()`).
- Reasoning select (`minimal | low | medium | high`).
- Prompt textarea (6 rows).
- Title template input (optional, placeholder `"Workflow · <nodeId>"`).

**Palette / registry**:

- Add `aiAgentConversation` to `executableNodeTypes` in `executable-nodes/index.ts`.
- Add `{ type: 'aiAgentConversation', label: 'AI Agent · Conversation' }` to `NODE_PALETTE`.
- Add `AiAgentConversationConfigForm` to `CONFIG_FORMS` in `inspector-panel.tsx`.

### Plan-mode-as-default removal

`packages/conversation/src/profiles/builtin.ts`:

- `claude-coding`: drop `permissionMode: 'plan'`. Rename `name` from `"Claude — Coding (plan mode)"` to `"Claude — Coding"`. Update description to drop the `plan-mode` mention.
- `claude-research`: drop `permissionMode: 'plan'`.

The two builtin profiles now default to no permission mode. Users can still pick plan mode via per-conversation overrides if they want it.

## Data flow

```
[upstream node A]──┐
                   ├──► [aiAgentConversation]
[upstream node B]──┘            │
                                │ create() + sendMessage()
                                ▼
                       ConversationService
                                │
                                ▼
                          TaskManager + agent
                                │
                                ▼ (first turn finishes)
                       StreamRelay closes
                                │
                                ▼
                  read last assistant message
                                │
                                ▼ (returned as node output)
                         [downstream node]
```

The conversation row stays in the DB and the user can open it in the chat UI to keep talking.

## Error handling

- **Unknown / missing profile** — `resolveOrThrow` already throws; the executor surfaces that as a node failure with the error message.
- **No credentials for profile** — `sendMessage` throws `NoCredentialsError`. The executor surfaces it verbatim. Node fails. The conversation row still exists (in `pending`); user can repair credentials and re-send.
- **Agent task failure** — relay's promise resolves; the latest message has the failure text. We treat presence of `status: 'error'` on the conversation row as a node failure.
- **Cancellation** — described above.

## Testing

- `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts` — unit test with a fake `ctx.conversations` that returns a canned result. Asserts:
  - Upstream JSON is wrapped in `<context source="…">` blocks.
  - File paths from `{ paths }` / `{ mediaPaths }` / `{ kind:'file', path }` are flattened into the "Attached files" list.
  - Output shape matches `{ kind:'conversation', conversationId, messageId, text }`.
- Manual smoke: run the workflow editor, drop `Image / Video` → `AI Agent · Conversation`, configure profile + prompt, run. Verify the chat appears in the conversations list, the first reply is captured as node output, and opening the chat lets the user keep messaging.

## File change list

**Modified**

- `packages/conversation/src/profiles/builtin.ts`
- `packages/conversation/src/conversations/conversation-service.ts`
- `packages/workflow-runtime/src/executors/index.ts`
- `packages/workflow-runtime/src/types.ts`
- `packages/backend/src/workflow-run-manager.ts`
- `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`
- `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`

**New**

- `packages/workflow-runtime/src/executors/ai-agent-conversation.ts`
- `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`
- `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`
- `packages/frontend/src/components/workflow-editor/inspector/config/ai-agent-conversation-config.tsx`

## Open trade-offs (already decided)

- **First-turn detection** uses the existing `StreamRelay.attach` promise (resolves when the task emitter closes). No new event plumbing.
- **File detection** is shape-based and tolerant — new file-producing nodes just need to expose one of the three recognized shapes.
- **Reasoning UI** is always visible; resolver drops the field for Claude profiles. Keeps the form predictable.
- **Plan-mode change** is scoped to builtins only. User profile rows with `permissionMode: 'plan'` are untouched.
