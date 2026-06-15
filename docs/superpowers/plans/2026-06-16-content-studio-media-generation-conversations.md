# Content Studio media generation → tracked conversations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Content Studio's image and video generation through the conversation system so each generation task produces a full, tracked, openable conversation (one per task; retries continue it), tagged `content-generation` and hidden from the default conversation list but filterable/linkable.

**Architecture:** A new `runGenerationAgent` composes `ConversationService.create()` (capturing the conversation id up-front and persisting it on the task) with a new `ConversationService.sendMessageAndAwait()` (run-one-turn-and-await on an existing conversation). The content-generation factory swaps its one-shot `runProfileAgent` runner for this conversation-backed runner. The generation task carries a new `conversationId`. The conversations list hides `content-generation`-sourced rows unless explicitly filtered; Content Studio links each task to its conversation.

**Tech Stack:** TypeScript (ESM), pnpm monorepo, better-sqlite3, Hono backend, React 19 frontend, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-16-content-studio-media-generation-conversations-design.md](../specs/2026-06-16-content-studio-media-generation-conversations-design.md)

**Build-order notes (load-bearing):**
- `@anubis/shared` → `@anubis/conversation` → `@anubis/backend` → `@anubis/frontend`.
- Backend tests import `@anubis/conversation` and `@anubis/shared` from their **`dist`**. After editing those packages, rebuild them before running backend tests:
  - `pnpm --filter @anubis/shared build`
  - `pnpm --filter @anubis/conversation build`
- Conversation-package tests run against the package's own `src`, so they don't need a conversation rebuild — but do need `@anubis/shared` built if a value (not just a type) is imported.

---

## Task 1: Add `conversationId` to the `GenerationTask` type and widen `ConversationExtra.source` (shared)

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add `conversationId` to `GenerationTask`**

In `packages/shared/src/index.ts`, the `GenerationTask` interface (around line 1211) currently ends:

```ts
export interface GenerationTask {
  id: string
  contentId: string
  projectId: string
  type: GenerationTaskType
  capability: GenerationCapability
  generator: string
  inputPrompt: string
  status: GenerationTaskStatus
  output?: GenerationOutput
  error?: string
  retryCount: number
  createdAt: number
  updatedAt: number
}
```

Add the field after `output`:

```ts
  output?: GenerationOutput
  /** Conversation that tracks this task's image/video generation agent run, if any. */
  conversationId?: string
  error?: string
```

- [ ] **Step 2: Widen `ConversationExtra.source` in shared**

The `ConversationExtra` interface (around line 72) has `source?: 'workflow'`. Change it to:

```ts
  source?: 'workflow' | 'content-generation'
```

- [ ] **Step 3: Build shared**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add GenerationTask.conversationId and content-generation source"
```

---

## Task 2: Widen `ConversationExtra.source` in the conversation package schema

**Files:**
- Modify: `packages/conversation/src/conversations/types.ts:15`

- [ ] **Step 1: Widen the zod enum**

In `packages/conversation/src/conversations/types.ts`, line 15 currently reads:

```ts
  source: z.enum(['workflow']).optional(),
```

Change to:

```ts
  source: z.enum(['workflow', 'content-generation']).optional(),
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm --filter @anubis/conversation exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/conversation/src/conversations/types.ts
git commit -m "feat(conversation): allow content-generation conversation source"
```

---

## Task 3: Migration 033 — add `conversation_id` to `content_generation_tasks`

**Files:**
- Create: `packages/conversation/src/db/migrations/033_content_generation_conversation.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Test: `packages/conversation/tests/db/content-generation-tasks-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe('ContentGenerationTasksRepo', ...)` block in
`packages/conversation/tests/db/content-generation-tasks-repo.test.ts` (before the closing `})`):

```ts
  it('round-trips conversationId through create and update', () => {
    const r = repo()
    const t = r.create(base)
    expect(t.conversationId).toBeUndefined()
    const updated = r.update(t.id, { conversationId: 'conv-1' })!
    expect(updated.conversationId).toBe('conv-1')
    expect(r.get(t.id)!.conversationId).toBe('conv-1')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/content-generation-tasks-repo.test.ts`
Expected: FAIL — `update` does not persist `conversationId` (the new column doesn't exist / isn't written).

- [ ] **Step 3: Create the migration SQL**

Create `packages/conversation/src/db/migrations/033_content_generation_conversation.sql`:

```sql
ALTER TABLE content_generation_tasks ADD COLUMN conversation_id TEXT;
```

- [ ] **Step 4: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, the `MIGRATIONS` array ends with:

```ts
  load(32, '032_research_candidates_cascade.sql'),
]
```

Add the new line before the closing bracket:

```ts
  load(32, '032_research_candidates_cascade.sql'),
  load(33, '033_content_generation_conversation.sql'),
]
```

- [ ] **Step 5: Map `conversation_id` in the repo**

In `packages/conversation/src/db/repositories/content-generation-tasks-repo.ts`:

Add to the `Row` interface (after `output: string | null`):

```ts
  output: string | null
  conversation_id: string | null
  error: string | null
```

In `toTask`, add the mapping (after `output: parseOutput(r.output),`):

```ts
    output: parseOutput(r.output), conversationId: r.conversation_id ?? undefined,
    error: r.error ?? undefined, retryCount: r.retry_count,
```

Widen `GenerationTaskPatch`:

```ts
export type GenerationTaskPatch = Partial<Pick<GenerationTask, 'status' | 'generator' | 'output' | 'error' | 'retryCount' | 'conversationId'>>
```

Update the `update` SQL to write `conversation_id`:

```ts
    this.db.prepare(`
      UPDATE content_generation_tasks
      SET status = ?, generator = ?, output = ?, error = ?, retry_count = ?, conversation_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.status, next.generator,
      next.output == null ? null : JSON.stringify(next.output),
      next.error ?? null, next.retryCount, next.conversationId ?? null, next.updatedAt, id,
    )
```

(`create` leaves the column NULL — no change needed there.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/content-generation-tasks-repo.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/migrations/033_content_generation_conversation.sql packages/conversation/src/db/migrations/index.ts packages/conversation/src/db/repositories/content-generation-tasks-repo.ts packages/conversation/tests/db/content-generation-tasks-repo.test.ts
git commit -m "feat(conversation): persist conversation_id on content generation tasks"
```

---

## Task 4: Hide `content-generation` conversations from the default list

**Files:**
- Modify: `packages/conversation/src/db/repositories/conversations-repo.ts:57-71`
- Test: `packages/conversation/tests/db/repositories.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `packages/conversation/tests/db/repositories.test.ts`. First confirm the file's existing imports include a `ConversationsRepo` and a DB helper; if it builds repos inline, mirror that pattern. Use this self-contained test (place it inside the top-level `describe` or add a new `describe`):

```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ConversationsRepo } from '../../src/db/repositories/conversations-repo.js'

describe('ConversationsRepo.list source visibility', () => {
  function setup() {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new ConversationsRepo(db)
    const base = {
      agent: 'codex' as const, status: 'finished' as const,
      workspacePath: '/w', createdAt: 1, updatedAt: 1,
    }
    repo.insert({ ...base, id: 'm1', title: 'manual', extra: { skills: [] } })
    repo.insert({ ...base, id: 'w1', title: 'wf', extra: { skills: [], source: 'workflow' } })
    repo.insert({ ...base, id: 'g1', title: 'gen', extra: { skills: [], source: 'content-generation' } })
    return repo
  }

  it('excludes content-generation when no source filter is passed', () => {
    const ids = setup().list({ limit: 50 }).map((c) => c.id)
    expect(ids).toContain('m1')
    expect(ids).toContain('w1')
    expect(ids).not.toContain('g1')
  })

  it('returns only content-generation when filtered explicitly', () => {
    const ids = setup().list({ limit: 50, source: 'content-generation' }).map((c) => c.id)
    expect(ids).toEqual(['g1'])
  })

  it('still filters manual and workflow exactly', () => {
    const repo = setup()
    expect(repo.list({ limit: 50, source: 'manual' }).map((c) => c.id)).toEqual(['m1'])
    expect(repo.list({ limit: 50, source: 'workflow' }).map((c) => c.id)).toEqual(['w1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/repositories.test.ts`
Expected: FAIL — the first test fails because `g1` is currently included when no source filter is passed; the explicit-filter test fails to typecheck/run because `'content-generation'` isn't an accepted `source` value.

- [ ] **Step 3: Update the repo `list` signature and default-hide logic**

In `packages/conversation/src/db/repositories/conversations-repo.ts`, change the `list` signature (line 57) and its source-filter block (lines 68-70):

```ts
  list(opts: { limit: number; archived?: boolean; source?: 'manual' | 'workflow' | 'content-generation'; projectId?: string }): Conversation[] {
    const where: string[] = ['deleted_at IS NULL']
    const params: unknown[] = []
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId) }
    const rows = this.db.prepare(`
      SELECT * FROM conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC
    `).all(...params) as Row[]
    let convs = rows.map(toConv)
    if (opts.archived !== undefined) {
      convs = convs.filter(c => (c.extra.archived ?? false) === opts.archived)
    }
    if (opts.source !== undefined) {
      convs = convs.filter(c => (c.extra.source ?? 'manual') === opts.source)
    } else {
      // Keep generation logs out of the default list; they're reachable via an
      // explicit source filter or a direct link from Content Studio.
      convs = convs.filter(c => c.extra.source !== 'content-generation')
    }
    return convs.slice(0, opts.limit)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/repositories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/repositories/conversations-repo.ts packages/conversation/tests/db/repositories.test.ts
git commit -m "feat(conversation): default-hide content-generation conversations from list"
```

---

## Task 5: `ConversationService.sendMessageAndAwait` + DRY the await/extract logic

**Files:**
- Modify: `packages/conversation/src/conversations/conversation-service.ts`
- Test: `packages/conversation/tests/conversations/conversation-service-await.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `packages/conversation/tests/conversations/conversation-service-await.test.ts` (inside the file, after the existing `describe('createAndAwaitFirstTurn', ...)` block — it reuses the file's `setupWith` helper):

```ts
describe('sendMessageAndAwait', () => {
  let cleanup: Array<() => void> = []
  beforeEach(() => { cleanup = [] })

  it('runs a turn on an existing conversation and returns the assistant text', async () => {
    const { svc, agentHomeRoot, workspacesRoot } = setupWith((em) => {
      em.emit('partial', { deltaText: 'second ' })
      em.emit('partial', { deltaText: 'turn' })
      em.emit('done', { finishReason: 'stop' })
    })
    cleanup.push(
      () => rmSync(agentHomeRoot, { recursive: true, force: true }),
      () => rmSync(workspacesRoot, { recursive: true, force: true }),
    )
    try {
      const conv = svc.create({ title: 'gen', profileId: 'claude-coding' })
      const res = await svc.sendMessageAndAwait(conv.id, { content: 'go' })
      expect(res.text).toBe('second turn')
    } finally {
      cleanup.forEach((fn) => fn())
    }
  })

  it('throws on agent error', async () => {
    const { svc, agentHomeRoot, workspacesRoot } = setupWith((em) => {
      em.emit('error', { error: new Error('kaboom') })
    })
    cleanup.push(
      () => rmSync(agentHomeRoot, { recursive: true, force: true }),
      () => rmSync(workspacesRoot, { recursive: true, force: true }),
    )
    try {
      const conv = svc.create({ title: 'gen', profileId: 'claude-coding' })
      await expect(svc.sendMessageAndAwait(conv.id, { content: 'go' })).rejects.toThrow(/kaboom/)
    } finally {
      cleanup.forEach((fn) => fn())
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service-await.test.ts`
Expected: FAIL — `svc.sendMessageAndAwait is not a function`.

- [ ] **Step 3: Add a private `awaitTurn` helper**

In `packages/conversation/src/conversations/conversation-service.ts`, add this private method (place it right after `startTurn`, before `sendMessage`):

```ts
  /**
   * Await a started turn's `done`, honoring an optional abort signal, then return
   * the final assistant message. Throws if the conversation ended in `error` or if
   * the turn was cancelled. Shared by createAndAwaitFirstTurn and sendMessageAndAwait.
   */
  private async awaitTurn(
    convId: string,
    done: Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ messageId: string; text: string }> {
    if (signal?.aborted) {
      await this.cancel(convId)
      throw new Error('cancelled before first turn started')
    }
    const abortPromise = signal
      ? new Promise<'aborted'>((resolve) => {
          const onAbort = () => resolve('aborted')
          signal.addEventListener('abort', onAbort, { once: true })
        })
      : null
    const result = abortPromise
      ? await Promise.race([done.then(() => 'done' as const), abortPromise])
      : await done.then(() => 'done' as const)
    if (result === 'aborted') {
      await this.cancel(convId)
      throw new Error('cancelled during first turn')
    }
    const final = this.deps.conversations.findById(convId)
    if (!final) throw new Error(`Conversation vanished: ${convId}`)
    if (final.status === 'error') {
      const messages = this.deps.messages.listForConversation(convId)
      const last = messages.filter((m) => m.role === 'assistant').pop()
      const errMsg = (last?.metadata as { error?: { message?: string } } | undefined)?.error?.message
        ?? 'agent run failed'
      throw new Error(errMsg)
    }
    const messages = this.deps.messages.listForConversation(convId)
    const last = messages.filter((m) => m.role === 'assistant').pop()
    if (!last) throw new Error('first turn finished without an assistant message')
    return { messageId: last.id, text: last.content }
  }
```

- [ ] **Step 4: Add the public `sendMessageAndAwait`**

Add this method after `sendMessage` (after the `sendMessage` method's closing brace, before `createAndAwaitFirstTurn`):

```ts
  async sendMessageAndAwait(
    id: string,
    input: SendMessageInput,
    signal?: AbortSignal,
  ): Promise<{ messageId: string; text: string }> {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    const { done } = await this.startTurn(cur, input)
    return this.awaitTurn(id, done, signal)
  }
```

- [ ] **Step 5: Refactor `createAndAwaitFirstTurn` to reuse `awaitTurn` (DRY)**

Replace the body of `createAndAwaitFirstTurn` after the `startTurn` try/catch block. The current method runs `startTurn`, then has ~30 lines of abort/error/extract logic. Replace everything from `if (input.signal?.aborted) {` through the final `return { conversationId: conv.id, messageId: last.id, text: last.content }` with:

```ts
    const { messageId, text } = await this.awaitTurn(conv.id, done, input.signal)
    return { conversationId: conv.id, messageId, text }
```

The method should now read:

```ts
  async createAndAwaitFirstTurn(
    input: CreateAndAwaitFirstTurnInput,
  ): Promise<CreateAndAwaitFirstTurnResult> {
    const conv = this.create({
      title: input.title,
      profileId: input.profileId,
      projectId: input.projectId,
      override: input.override,
      workspacePath: input.workspacePath,
      source: input.source,
      workflow: input.workflow,
    })
    let done: Promise<void>
    try {
      ;({ done } = await this.startTurn(conv, { content: input.content }))
    } catch (e) {
      try { this.deps.conversations.updateStatus(conv.id, 'error') } catch { /* best-effort */ }
      throw e
    }
    const { messageId, text } = await this.awaitTurn(conv.id, done, input.signal)
    return { conversationId: conv.id, messageId, text }
  }
```

- [ ] **Step 6: Widen `source` typings on the service**

In the same file:
- `CreateConversationInput.source` (line ~50): `source?: 'workflow' | 'content-generation'`
- `CreateAndAwaitFirstTurnInput.source` (line ~68): `source?: 'workflow' | 'content-generation'`
- `list()` opts (line ~165): `source?: 'manual' | 'workflow' | 'content-generation'`

- [ ] **Step 7: Run the await tests to verify they pass**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service-await.test.ts`
Expected: PASS — both the existing `createAndAwaitFirstTurn` tests (still green after refactor) and the new `sendMessageAndAwait` tests.

- [ ] **Step 8: Commit**

```bash
git add packages/conversation/src/conversations/conversation-service.ts packages/conversation/tests/conversations/conversation-service-await.test.ts
git commit -m "feat(conversation): add sendMessageAndAwait, share await/extract logic"
```

---

## Task 6: Backend route — accept `source=content-generation`

**Files:**
- Modify: `packages/backend/src/conversation.ts:51-54`

- [ ] **Step 1: Widen the parsed source query param**

In `packages/backend/src/conversation.ts`, lines 51-52 currently read:

```ts
  const sourceRaw = c.req.query('source')
  const source = sourceRaw === 'manual' || sourceRaw === 'workflow' ? sourceRaw : undefined
```

Change to:

```ts
  const sourceRaw = c.req.query('source')
  const source = sourceRaw === 'manual' || sourceRaw === 'workflow' || sourceRaw === 'content-generation' ? sourceRaw : undefined
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/conversation.ts
git commit -m "feat(backend): accept content-generation conversation source filter"
```

---

## Task 7: New conversation-backed generation runner

**Files:**
- Create: `packages/backend/src/content-generation/conversation-runner.ts`
- Test: `packages/backend/tests/content-generation/conversation-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/content-generation/conversation-runner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runGenerationAgent } from '../../src/content-generation/conversation-runner.js'

function fakeStack(over: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = []
  const conversations = new Map<string, { id: string }>()
  return {
    created,
    stack: {
      profiles: { resolve: vi.fn(() => ({ agent: 'codex' })) },
      conversation: {
        get: vi.fn((id: string) => conversations.get(id) ?? null),
        create: vi.fn((input: Record<string, unknown>) => {
          const conv = { id: `conv-${created.length + 1}` }
          created.push(input)
          conversations.set(conv.id, conv)
          return conv
        }),
        sendMessageAndAwait: vi.fn(async () => ({ messageId: 'm', text: 'ok' })),
      },
      ...over,
    },
  }
}

describe('runGenerationAgent', () => {
  it('creates a tagged conversation, persists its id, and runs a turn', async () => {
    const { stack, created } = fakeStack()
    const onConversation = vi.fn()
    const res = await runGenerationAgent(stack as never, {
      profileId: 'codex-image', prompt: 'draw', cwd: '/tmp/assets', title: 'Image · c1', onConversation,
    })
    expect(res.conversationId).toBe('conv-1')
    expect(res.text).toBe('ok')
    expect(res.agent).toBe('codex')
    expect(created[0]).toMatchObject({ source: 'content-generation', workspacePath: '/tmp/assets', profileId: 'codex-image' })
    expect(onConversation).toHaveBeenCalledWith('conv-1')
    expect(stack.conversation.sendMessageAndAwait).toHaveBeenCalledWith('conv-1', { content: 'draw' })
  })

  it('reuses an existing conversation on retry (no new create, no onConversation)', async () => {
    const { stack } = fakeStack()
    // Pre-seed an existing conversation id.
    stack.conversation.get = vi.fn((id: string) => (id === 'existing' ? { id } : null))
    const onConversation = vi.fn()
    const res = await runGenerationAgent(stack as never, {
      profileId: 'codex-image', prompt: 'redraw', cwd: '/tmp/assets', title: 'Image · c1',
      conversationId: 'existing', onConversation,
    })
    expect(res.conversationId).toBe('existing')
    expect(stack.conversation.create).not.toHaveBeenCalled()
    expect(onConversation).not.toHaveBeenCalled()
    expect(stack.conversation.sendMessageAndAwait).toHaveBeenCalledWith('existing', { content: 'redraw' })
  })

  it('rejects web-agent profiles', async () => {
    const { stack } = fakeStack({ profiles: { resolve: vi.fn(() => ({ agent: 'gpt-web' })) } })
    await expect(runGenerationAgent(stack as never, {
      profileId: 'gpt-web-x', prompt: 'draw', cwd: '/tmp/assets', title: 'Image · c1',
    })).rejects.toThrow(/web agent/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-generation/conversation-runner.test.ts`
Expected: FAIL — module `conversation-runner.js` does not exist.

- [ ] **Step 3: Implement the runner**

Create `packages/backend/src/content-generation/conversation-runner.ts`:

```ts
import type { AgentKind } from '@anubis/shared'
import type { ConversationStack } from '@anubis/conversation'
import { WEB_AGENTS } from '../agent-run.js'

export interface RunGenerationAgentInput {
  /** A fully-resolved profile id (caller resolves any default chain). */
  profileId: string
  prompt: string
  /** Absolute working dir = the conversation workspace; the agent saves assets here. */
  cwd: string
  /** Conversation title shown in the (filterable) conversation list. */
  title: string
  /** Existing conversation to continue (retry). Omit to start a new one. */
  conversationId?: string
  /** Called with the new conversation id as soon as it's created (before the turn runs). */
  onConversation?: (id: string) => void
}

/**
 * Run a profile agent for media generation as a tracked conversation turn. Creates a
 * `content-generation`-tagged conversation up-front (so its id is persisted before the
 * turn can fail), or continues an existing one on retry. Rejects web agents, which
 * can't run headless media generation.
 */
export async function runGenerationAgent(
  stack: ConversationStack,
  input: RunGenerationAgentInput,
): Promise<{ text: string; agent: AgentKind; conversationId: string }> {
  const resolved = stack.profiles.resolve(input.profileId)
  const agent = resolved.agent
  if (WEB_AGENTS.has(agent)) {
    throw new Error(
      `Profile "${input.profileId}" uses the web agent "${agent}", which can't run headless media generation. `
      + 'Pick a CLI/SDK profile (Claude, Codex, Antigravity, or Qoder).',
    )
  }

  let convId = input.conversationId && stack.conversation.get(input.conversationId)
    ? input.conversationId
    : undefined
  if (!convId) {
    const conv = stack.conversation.create({
      title: input.title,
      profileId: input.profileId,
      workspacePath: input.cwd,
      source: 'content-generation',
      override: { approvalPolicy: 'never', sandboxMode: 'workspace-write', permissionMode: 'bypassPermissions' },
    })
    convId = conv.id
    input.onConversation?.(convId)
  }

  const { text } = await stack.conversation.sendMessageAndAwait(convId, { content: input.prompt })
  return { text, agent, conversationId: convId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-generation/conversation-runner.test.ts`
Expected: PASS. (Requires `@anubis/conversation` and `@anubis/shared` built from Tasks 1-6 — if it fails to import, run `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build` first.)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/conversation-runner.ts packages/backend/tests/content-generation/conversation-runner.test.ts
git commit -m "feat(content-generation): conversation-backed generation runner"
```

---

## Task 8: Thread conversation context through the generators

**Files:**
- Modify: `packages/backend/src/content-generation/generators.ts:6-9` (`GenerateCtx`)
- Modify: `packages/backend/src/content-generation/agent-generators.ts`
- Test: `packages/backend/tests/content-generation/agent-generators.test.ts`

- [ ] **Step 1: Update the failing test for the new `RunAgent` shape**

In `packages/backend/tests/content-generation/agent-generators.test.ts`:

Change the `ctx()` helper to optionally record a conversation id:

```ts
function ctx(over: Partial<{ conversationId: string; onConversation: (id: string) => void }> = {}) {
  return { contentId: 'c1', assetDir: join(mkdtempSync(join(tmpdir(), 'anubis-gen-')), 'assets'), ...over }
}
```

In the first test (`runs the agent and collects the produced image file`), extend the assertions on the runAgent input to cover the new fields:

```ts
    const input = runAgent.mock.calls[0]![0] as { profileId: string; prompt: string; title: string; cwd: string }
    expect(input.profileId).toBe('codex-image') // default when unset
    expect(input.prompt).toContain('$imagegen')
    expect(input.title).toContain('c1')
```

Add a new test verifying conversation context is forwarded:

```ts
  it('forwards conversationId and onConversation from ctx to the runner', async () => {
    const onConversation = vi.fn()
    const runAgent = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'out.png'), 'img')
      return { text: 'out.png', agent: 'codex' as const }
    })
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({} as AppConfig), runAgent, flow: { generate: vi.fn() } as never,
    })
    await gen.generate(task(), ctx({ conversationId: 'conv-9', onConversation }))
    const input = runAgent.mock.calls[0]![0] as { conversationId?: string; onConversation?: unknown }
    expect(input.conversationId).toBe('conv-9')
    expect(input.onConversation).toBe(onConversation)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-generation/agent-generators.test.ts`
Expected: FAIL — `input.title` is undefined and `conversationId`/`onConversation` aren't forwarded.

- [ ] **Step 3: Extend `GenerateCtx`**

In `packages/backend/src/content-generation/generators.ts`, change the `GenerateCtx` interface:

```ts
export interface GenerateCtx {
  contentId: string
  assetDir: string
  /** Existing conversation tracking this task's generation (continue on retry). */
  conversationId?: string
  /** Persist a newly-created conversation id back onto the task. */
  onConversation?: (id: string) => void
}
```

- [ ] **Step 4: Update `RunAgent` and `generateViaAgent` in agent-generators.ts**

In `packages/backend/src/content-generation/agent-generators.ts`:

Replace the `RunAgent` type (line 13) — note it no longer references `RunProfileAgentInput`:

```ts
export type RunAgent = (input: {
  profileId: string
  prompt: string
  cwd: string
  title: string
  conversationId?: string
  onConversation?: (id: string) => void
}) => Promise<{ text: string; agent: AgentKind }>
```

Remove the now-unused import of `RunProfileAgentInput` (line 4: `import type { RunProfileAgentInput } from '../agent-run.js'`).

Change `generateViaAgent` to accept and forward a `title` plus the conversation context:

```ts
async function generateViaAgent(
  runAgent: RunAgent, profileId: string, prompt: string, ctx: GenerateCtx,
  exts: Set<string>, kind: string, title: string,
): Promise<GenerationOutput> {
  mkdirSync(ctx.assetDir, { recursive: true })
  const before = snapshot(ctx.assetDir, exts)
  const { agent } = await runAgent({
    profileId, prompt, cwd: ctx.assetDir, title,
    conversationId: ctx.conversationId,
    onConversation: ctx.onConversation,
  })
  const after = snapshot(ctx.assetDir, exts)
  const created = [...after].filter((f) => !before.has(f))
  if (created.length === 0) {
    throw new Error(`Agent produced no ${kind} file in the asset dir.`)
  }
  return { assetPaths: created.map((f) => join(ctx.assetDir, f)), meta: { agent, profileId } }
}
```

Update the two callers to pass a title. In `ConfigurableImageGenerator.generate`:

```ts
    const profileId = selected ?? 'codex-image'
    return generateViaAgent(this.deps.runAgent, profileId, imagePrompt(task.inputPrompt), ctx, IMAGE_EXTS, 'image', `Image · ${ctx.contentId}`)
```

In `AgentVideoGenerator.generate`:

```ts
    const profileId = this.deps.getConfig().generationProfiles?.video ?? 'codex-video'
    return generateViaAgent(this.deps.runAgent, profileId, videoPrompt(task.inputPrompt), ctx, VIDEO_EXTS, 'video', `Video · ${ctx.contentId}`)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-generation/agent-generators.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content-generation/generators.ts packages/backend/src/content-generation/agent-generators.ts packages/backend/tests/content-generation/agent-generators.test.ts
git commit -m "feat(content-generation): thread conversation context through media generators"
```

---

## Task 9: Persist the conversation id from `runTask`

**Files:**
- Modify: `packages/backend/src/content-generation/generation-service.ts:81-87`
- Test: `packages/backend/tests/content-generation/generation-service.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/backend/tests/content-generation/generation-service.test.ts`, add a test inside `describe('GenerationService.runAll', ...)`:

```ts
  it('passes conversationId + onConversation to the generator and persists the id', async () => {
    const { deps, tasks } = makeDeps()
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    deps.registry.get.mockReturnValue({
      name: 'mock', capability: 'image',
      generate: vi.fn(async (_task, ctx: { conversationId?: string; onConversation?: (id: string) => void }) => {
        expect(ctx.conversationId).toBeUndefined()
        ctx.onConversation?.('conv-x')
        return { assetPaths: ['/a.png'] }
      }),
    })
    await svc.runAll('c1')
    const imageTask = tasks().find((t) => t.capability === 'image')!
    expect(imageTask.conversationId).toBe('conv-x')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: FAIL — `imageTask.conversationId` is undefined (the service never builds `onConversation`/`conversationId` into the ctx).

- [ ] **Step 3: Build the ctx with conversation context**

In `packages/backend/src/content-generation/generation-service.ts`, in `runTask` (lines 81-87), change the `ctx` construction:

```ts
  private async runTask(id: string, task: GenerationTask): Promise<void> {
    const generator = this.deps.registry.get(task.capability)
    if (!generator) {
      this.deps.taskRepo.update(task.id, { status: 'manual' })
      return
    }
    const ctx = {
      contentId: id,
      assetDir: this.deps.assetDirFor(id),
      conversationId: task.conversationId,
      onConversation: (cid: string) => { this.deps.taskRepo.update(task.id, { conversationId: cid }) },
    }
```

(The rest of `runTask` is unchanged. Because `onConversation` writes through `taskRepo.update`, the id survives a failed attempt and a later `retryTask` re-reads it via `task.conversationId`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/generation-service.ts packages/backend/tests/content-generation/generation-service.test.ts
git commit -m "feat(content-generation): persist conversation id on generation tasks"
```

---

## Task 10: Wire the factory to the conversation-backed runner

**Files:**
- Modify: `packages/backend/src/content-generation/factory.ts`

- [ ] **Step 1: Swap the runner**

In `packages/backend/src/content-generation/factory.ts`:

Replace the imports (lines 3-4):

```ts
import { runProfileAgent, type RunProfileAgentInput } from '../agent-run.js'
```

with:

```ts
import type { RunAgent } from './agent-generators.js'
import { runGenerationAgent } from './conversation-runner.js'
```

(Keep the existing `import { getAiAgentService } from '../ai-agent.js'` only if it's still used elsewhere in the file — it is not after this change, so remove that import too.)

Replace the `runAgent` closure (lines 14-15):

```ts
  const runAgent = (input: RunProfileAgentInput) =>
    runProfileAgent(stack, getAiAgentService(), input)
```

with:

```ts
  const runAgent: RunAgent = (input) => runGenerationAgent(stack, input)
```

Note: `AgentVideoGenerator` / `ConfigurableImageGenerator` already import `RunAgent`-typed deps, so the registry construction (lines 18-22) is unchanged.

- [ ] **Step 2: Typecheck the backend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit`
Expected: no errors. (If `getAiAgentService` is reported unused, confirm it's removed from the imports.)

- [ ] **Step 3: Run the content-generation backend tests**

Run: `pnpm vitest run packages/backend/tests/content-generation/`
Expected: PASS for all files in the dir.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/content-generation/factory.ts
git commit -m "feat(content-generation): run media generation through tracked conversations"
```

---

## Task 11: Frontend — widen `listConversations` source type

**Files:**
- Modify: `packages/frontend/src/api.ts:300`

- [ ] **Step 1: Widen the source union**

In `packages/frontend/src/api.ts`, the `listConversations` signature (line 300):

```ts
  opts: { limit?: number; archived?: boolean; source?: 'manual' | 'workflow'; projectId?: string } = {},
```

Change to:

```ts
  opts: { limit?: number; archived?: boolean; source?: 'manual' | 'workflow' | 'content-generation'; projectId?: string } = {},
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): allow content-generation source in listConversations"
```

---

## Task 12: Frontend — "Generation logs" filter on the conversations page

**Files:**
- Modify: `packages/frontend/src/pages/conversations.tsx`

- [ ] **Step 1: Widen the `Row.source` and `ConversationFilter` types**

In `packages/frontend/src/pages/conversations.tsx`:

The `Row` type (line 18):

```ts
  source: 'manual' | 'workflow' | 'content-generation'
```

The `ConversationFilter` type (line 21):

```ts
type ConversationFilter = 'all' | 'manual' | 'workflow' | 'content-generation'
```

- [ ] **Step 2: Label generation-sourced rows**

In `rowFromSummary` (lines 41-52), update the profile label so generation rows read clearly:

```ts
function rowFromSummary(c: ConversationSummary): Row {
  const profile = c.profileId ?? `${c.agent}`
  const source = c.extra.source ?? 'manual'
  const label = source === 'workflow' ? `Workflow · ${profile}`
    : source === 'content-generation' ? `Generation · ${profile}`
    : profile
  return {
    id: c.id,
    title: c.title,
    profile: label,
    time: shortRelative(c.updatedAt),
    status: statusFromConversation(c),
    source,
  }
}
```

- [ ] **Step 3: Add the filter chip**

The filter chips render from a tuple (line 225) inside a `grid-cols-3` container (line 224). Add the new option and widen the grid to 4 columns. Change line 224:

```tsx
          <div className='grid h-7 w-full grid-cols-4 rounded-md border border-border bg-muted/45 p-0.5'>
```

Change the tuple and label (lines 225 and 236):

```tsx
            {(['all', 'manual', 'workflow', 'content-generation'] as const).map((filter) => (
```

```tsx
                {filter === 'workflow' ? 'Workflows' : filter === 'content-generation' ? 'Generation' : filter}
```

(The existing `useEffect` at line 145 already maps `conversationFilter === 'all' ? undefined : conversationFilter` into the `source` query param, so the new chip fetches generation logs with no further change. The `'all'` view now excludes them by the Task 4 backend default.)

- [ ] **Step 4: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/conversations.tsx
git commit -m "feat(frontend): add Generation filter to conversations list"
```

---

## Task 13: Frontend — "View generation log" link on each generation task

**Files:**
- Modify: `packages/frontend/src/pages/content-studio/generation-sections.tsx`
- Modify: `packages/frontend/src/pages/content-studio/pipeline-timeline.tsx`
- Modify: `packages/frontend/src/pages/content-studio.tsx`

- [ ] **Step 1: Add an `onOpenConversation` prop to `GenerationQueueSection` and render the link**

In `packages/frontend/src/pages/content-studio/generation-sections.tsx`, change the
`GenerationQueueSection` props and the action row:

```tsx
export function GenerationQueueSection({
  tasks, busy, onStart, onRetry, onCancel, onOpenConversation,
}: {
  tasks: GenerationTask[]
  busy: boolean
  onStart: () => void
  onRetry: (taskId: string) => void
  onCancel: (taskId: string) => void
  onOpenConversation: (conversationId: string) => void
}) {
```

In the action `<div className='mt-1.5 flex gap-2'>` block (lines 42-49), add the link after the Cancel button:

```tsx
              <div className='mt-1.5 flex gap-2'>
                {t.status === 'failed' || t.status === 'cancelled' ? (
                  <button type='button' disabled={busy} onClick={() => onRetry(t.id)} className='text-[11px] text-[var(--anubis-gold)] hover:underline disabled:opacity-50'>Retry</button>
                ) : null}
                {t.status === 'pending' || t.status === 'running' ? (
                  <button type='button' disabled={busy} onClick={() => onCancel(t.id)} className='text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50'>Cancel</button>
                ) : null}
                {t.conversationId ? (
                  <button type='button' onClick={() => onOpenConversation(t.conversationId!)} className='text-[11px] text-muted-foreground hover:underline'>View generation log</button>
                ) : null}
              </div>
```

- [ ] **Step 2: Forward the prop through `PipelineTimeline`**

In `packages/frontend/src/pages/content-studio/pipeline-timeline.tsx`:

Add to `PipelineTimelineProps` (near `onRetryTask` at line 64):

```ts
  onRetryTask: (taskId: string) => void
  onOpenConversation: (conversationId: string) => void
```

Find where `GenerationQueueSection` is rendered (it receives `tasks={gen.tasks}` and `onRetry={props.onRetryTask}` around lines 251-254) and add the new prop:

```tsx
            tasks={gen.tasks}
            busy={props.busy}
            onStart={props.onStartGeneration}
            onRetry={props.onRetryTask}
            onCancel={props.onCancelTask}
            onOpenConversation={props.onOpenConversation}
```

(Match the exact existing prop names already passed to `GenerationQueueSection`; only the `onOpenConversation` line is new. If `GenerationQueueSection` is rendered via a wrapper component in this file, thread the prop through that wrapper the same way.)

- [ ] **Step 3: Provide navigation from `content-studio.tsx`**

In `packages/frontend/src/pages/content-studio.tsx`:

Confirm the navigation hook is imported (other pages use `import { useNavigation } from '@/lib/navigation'` and `const { navigate } = useNavigation()`). If `navigate` isn't already in this component, add:

```ts
import { useNavigation } from '@/lib/navigation'
```

and inside the component body:

```ts
  const { navigate } = useNavigation()
```

Pass the handler to `<PipelineTimeline ...>` (alongside `onRetryTask` at line 246):

```tsx
                onRetryTask={(taskId) => void withBusy('retry', async () => {
                  await retryGenerationTask(selected.id, taskId); await reselectAfter(selected.id)
                })}
                onOpenConversation={(conversationId) => navigate({ page: 'active-conversation', conversationId })}
```

- [ ] **Step 4: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/content-studio/generation-sections.tsx packages/frontend/src/pages/content-studio/pipeline-timeline.tsx packages/frontend/src/pages/content-studio.tsx
git commit -m "feat(content-studio): link each generation task to its conversation log"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Build the changed packages in order**

Run:
```bash
pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build
```
Expected: both build with no errors.

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 3: Run the affected unit tests**

Run:
```bash
pnpm vitest run --maxWorkers=2 packages/conversation/tests/db/content-generation-tasks-repo.test.ts packages/conversation/tests/db/repositories.test.ts packages/conversation/tests/conversations/conversation-service-await.test.ts packages/backend/tests/content-generation/
```
Expected: all PASS. (`--maxWorkers=2` avoids the known worker-contention flakiness.)

- [ ] **Step 4: Commit (if any incidental fixes were needed)**

```bash
git add -A
git commit -m "test(content-generation): verify tracked media generation end to end"
```

---

## Self-review notes

- **Spec coverage:** data model (Tasks 1, 3) · `sendMessageAndAwait` + source typing (Tasks 2, 5, 6) · runner (Task 7) · generator/ctx threading (Task 8) · `runTask` persistence (Task 9) · factory wiring (Task 10) · visibility default-hide (Task 4) + filter (Tasks 11, 12) + per-task link (Task 13). All spec sections map to a task.
- **Retry-survives-failure:** `onConversation` writes the id through `taskRepo.update` immediately on creation (Task 9), independent of turn success — so a failed first attempt still hands its conversation to `retryTask` via `task.conversationId` (read in Task 9's ctx).
- **Type consistency:** `'content-generation'` is added to every `source` union it flows through — shared `ConversationExtra` (Task 1), conversation zod schema (Task 2), `ConversationsRepo.list` (Task 4), `ConversationService` `CreateConversationInput`/`CreateAndAwaitFirstTurnInput`/`list` (Task 5), backend route (Task 6), frontend `listConversations`/`Row`/`ConversationFilter` (Tasks 11, 12). `conversationId` is added to `GenerationTask` (Task 1), the repo `Row`/`toTask`/patch (Task 3), `GenerateCtx` (Task 8), and consumed in `runTask` (Task 9) and the runner (Task 7).
- **Out of scope (unchanged):** pipeline steps, text generator, Google-Flow generator, live SSE streaming into Content Studio.
```
