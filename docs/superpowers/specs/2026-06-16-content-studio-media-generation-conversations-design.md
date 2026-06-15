# Content Studio media generation → tracked conversations

**Date:** 2026-06-16
**Status:** Approved (design)
**Scope:** Content Studio **image** and **video** generators only. Pipeline steps
(breakdown/refine/ai-review) and the text/Google-Flow generators keep their current paths.

## Problem

Content Studio's image and video generators run through `runProfileAgent()`
([packages/backend/src/agent-run.ts](../../../packages/backend/src/agent-run.ts)) — a
one-shot, headless agent call. The run is **not** tracked: no `Conversation`, no
`Message`, no `AgentSession`, no tool-call `Artifact`. Output only lands in
`content_generation_tasks` rows + asset files. There is no way to open the run and see
what the agent actually did.

Normal chat agent runs, by contrast, go through `ConversationService` and produce a
fully-tracked conversation (messages, session, artifacts) visible in the conversation UI.

## Goal

Route image/video generation through the conversation system so each generation is a
**full conversation record** — openable and inspectable like any other agent run.

Decisions (confirmed with user):
- **Tracking depth:** full conversation record (Messages + AgentSession + Artifacts).
- **Granularity:** one conversation **per generation task**. Re-running/retrying a task
  continues that same conversation (reuses its `AgentSession`); retries appear as new
  turns in the same thread.
- **Visibility:** tag with `extra.source = 'content-generation'`; hidden from the main
  conversation list by default, but filterable/openable.

## Approach (chosen)

Compose the existing `ConversationService.create()` with a **new**
`sendMessageAndAwait()`. The conversation is created up-front so its id is captured and
persisted on the task **before** the turn runs — this is what lets a *failed* attempt
still hand its conversation id to the retry. First-run and retry then share one path:
create-if-needed, then send-and-await.

Rejected alternatives:
- Reuse `createAndAwaitFirstTurn()` as-is — it only returns the conversation id *after*
  the turn completes, so a failed first attempt loses the id and retries can't continue
  the same thread.
- Hand-write conversation/message/artifact rows around `runProfileAgent` — reinvents the
  `StreamRelay`/artifact persistence the conversation service already owns.

## Design

### Data model

- New migration `packages/conversation/src/db/migrations/033_content_generation_conversation.sql`:
  ```sql
  ALTER TABLE content_generation_tasks ADD COLUMN conversation_id TEXT;
  ```
  (Latest existing migration is `032`; register `033` in `migrations/index.ts`.)
- `GenerationTask` (`packages/shared/src/index.ts`) gains `conversationId?: string`.
- `ContentGenerationTasksRepo` (`packages/conversation/src/db/repositories/content-generation-tasks-repo.ts`):
  - `Row` gains `conversation_id: string | null`; `toTask` maps it.
  - `GenerationTaskPatch` gains `conversationId`; the `update` SQL must write
    `conversation_id` (today's `update` SQL does **not** touch it — add it). `create`
    leaves it NULL.

### Conversation service (`packages/conversation/src/conversations/conversation-service.ts`)

- New public `sendMessageAndAwait(id, input: SendMessageInput): Promise<{ text: string }>`:
  runs a turn on an **existing** conversation and awaits it, mirroring the
  await-and-extract logic that `createAndAwaitFirstTurn` performs after `startTurn`
  (await `done`; re-read conversation; if status `error`, throw the last assistant
  error message; else return the last assistant message's text). Factor that
  await/extract block into a private helper so `createAndAwaitFirstTurn` and
  `sendMessageAndAwait` stay in sync.
- Widen `source` typing to `'workflow' | 'content-generation'` in:
  - `CreateConversationInput.source`
  - the `list()` opts `source` union
  - `ConversationExtra` source enum in
    `packages/conversation/src/conversations/types.ts` (`z.enum(['workflow', 'content-generation'])`).

### Generation runner (new `packages/backend/src/content-generation/conversation-runner.ts`)

```ts
runGenerationAgent(stack, {
  profileId, prompt, cwd, title,
  conversationId?, onConversation?,
}): Promise<{ text: string; agent: AgentKind; conversationId: string }>
```

1. Resolve the profile; reject web agents (`gpt-web`, `qwen-web`) with the same
   actionable error `runProfileAgent` used — web agents can't do headless media gen.
2. If `conversationId` is set and `stack.conversation.get(conversationId)` still exists,
   reuse it. Otherwise `stack.conversation.create({ title, profileId, workspacePath: cwd,
   source: 'content-generation', override: <unattended> })` and call
   `onConversation(newId)` **before** running the turn (so the task records the id even
   if the turn then fails).
3. `await stack.conversation.sendMessageAndAwait(convId, { content: prompt })`; return
   `{ text, agent, conversationId: convId }`.

`<unattended>` override forces `approvalPolicy: 'never'`, `sandboxMode: 'workspace-write'`,
`permissionMode: 'bypassPermissions'`, preserving today's non-interactive
`runProfileAgent` behavior. (Confirm `ProfileOverride` carries these fields during
planning.)

`cwd` is the asset dir (the conversation's `workspacePath`), so the agent saves the
image/video there exactly as today. `ensureWorkspaceStructure` may add `.agents/`
scaffolding under it — harmless: the created-file snapshot diff matches only
image/video extensions.

### Wiring

- `packages/backend/src/content-generation/factory.ts`: replace the
  `runAgent = runProfileAgent(...)` closure with
  `runAgent = (input) => runGenerationAgent(stack, input)`.
- `packages/backend/src/content-generation/agent-generators.ts`:
  - `RunAgent` input gains `title`, `conversationId?`, `onConversation?`.
  - `generateViaAgent` derives a title (e.g. `"Image · <contentId>"` / `"Video · …"`)
    and forwards `ctx.conversationId` / `ctx.onConversation`.
  - `GenerateCtx` (`generators.ts`) gains `conversationId?: string` and
    `onConversation?: (id: string) => void`.
- `packages/backend/src/content-generation/generation-service.ts` `runTask`: build `ctx`
  with `conversationId: task.conversationId` and
  `onConversation: (cid) => taskRepo.update(task.id, { conversationId: cid })`.
- Text and Flow generators are untouched (Flow doesn't use `runAgent`; text is
  deterministic — no conversation).

### Visibility (tag-but-filterable)

- Generation conversations carry `extra.source = 'content-generation'`.
- `ConversationsRepo.list()`
  (`packages/conversation/src/db/repositories/conversations-repo.ts`): when **no**
  `source` filter is passed, exclude `content-generation` (keeps the main dashboard
  clean; workflow conversations stay visible as today). When `source:
  'content-generation'` is passed, return exactly those.
- Frontend:
  - A "Show generation logs" filter toggle on the conversation list that calls
    `listConversations({ source: 'content-generation' })`.
  - A "View generation log" link on each image/video task row in Content Studio that
    opens the conversation by `task.conversationId`.
  Both reach the same fully-tracked thread.

## Testing (TDD — tests first)

- **Conversation pkg** — `sendMessageAndAwait`: returns final assistant text; throws on
  `error` status; reuses the `AgentSession` across consecutive turns.
- **Repo** — `conversation_id` round-trips through `create`/`update`/`get`.
- **Repo** — `list()` default-excludes `content-generation`; includes them when
  `source: 'content-generation'` is passed; workflow/manual filtering unchanged.
- **Runner** — `runGenerationAgent`: creates + tags the conversation, persists id via
  `onConversation`, reuses an existing id on retry, rejects web agents.
- Update existing `packages/backend/tests/content-generation/agent-generators.test.ts`
  and `generation-service.test.ts` mocks for the new `RunAgent` shape and the
  `onConversation` call.

## Out of scope

- Pipeline steps (breakdown / refine / ai-review).
- Text and Google-Flow generators.
- Streaming the generation conversation live into the Content Studio UI (the link opens
  the existing conversation view; live SSE there already works by conversation id).
