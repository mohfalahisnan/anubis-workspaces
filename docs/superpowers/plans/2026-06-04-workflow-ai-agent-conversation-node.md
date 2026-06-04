# Workflow AI Agent Conversation Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow node that spawns a persistent chat conversation seeded with upstream context + a config prompt, waits for the first agent turn to complete, and forwards the assistant reply to downstream nodes. Plus: strip `permissionMode: 'plan'` from the builtin Claude profiles.

**Architecture:** A new executor `aiAgentConversation` lives in `@anubis/workflow-runtime`. It calls a new `ConversationService.createAndAwaitFirstTurn` method which reuses the existing `create()` + `sendMessage()` machinery and exposes the relay's done promise. The workflow's `ExecutorContext` gains a `conversations` adapter wired in `WorkflowRunManager`. Frontend gets a renderer + config form.

**Tech Stack:** TypeScript (ESM, `isolatedModules`, explicit `.js` imports), React 19, Zod, vitest, React Flow (`@xyflow/react`).

**Spec:** [docs/superpowers/specs/2026-06-04-workflow-ai-agent-conversation-node-design.md](../specs/2026-06-04-workflow-ai-agent-conversation-node-design.md)

---

## Task 1: Strip plan mode from builtin Claude profiles

**Files:**
- Modify: `packages/conversation/src/profiles/builtin.ts`

- [ ] **Step 1: Edit `claude-coding` profile**

Open `packages/conversation/src/profiles/builtin.ts`. Replace the `claude-coding` entry with:

```ts
  {
    id: 'claude-coding',
    name: 'Claude — Coding',
    description: 'Claude Sonnet with default permissions and auto-inject skills.',
    source: 'builtin',
    config: {
      agent: 'claude',
      model: 'claude-sonnet-4-6',
    },
    sortOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
  },
```

The change: dropped `permissionMode: 'plan'`, renamed `name`, updated `description`.

- [ ] **Step 2: Edit `claude-research` profile**

In the same file, replace the `claude-research` entry's `config` block with:

```ts
    config: {
      agent: 'claude',
      model: 'claude-opus-4-7',
      appendSystemPrompt: 'You are in research mode. Cite sources. Prefer breadth-first exploration over premature synthesis.',
    },
```

(Dropped `permissionMode: 'plan'`; the description is fine as-is.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/profiles/builtin.ts
git commit -m "feat(profiles): drop plan-mode default from builtin Claude profiles

Both claude-coding and claude-research used to set permissionMode: 'plan',
forcing fresh conversations into plan mode. Removed so the user only opts
into plan mode when they explicitly want it. Also renamed
'Claude — Coding (plan mode)' to 'Claude — Coding'."
```

---

## Task 2: Refactor sendMessage to expose the relay promise

**Files:**
- Modify: `packages/conversation/src/conversations/conversation-service.ts`

This sets up Task 3 cleanly without changing the public `sendMessage` return shape.

- [ ] **Step 1: Add private `startTurn` helper**

In `conversation-service.ts`, immediately above the `sendMessage` method, add this private method:

```ts
  private async startTurn(
    cur: Conversation,
    input: SendMessageInput,
  ): Promise<{ msgId: string; messageId: string; done: Promise<void> }> {
    if (input.override?.agent && input.override.agent !== cur.agent) {
      throw new Error('Cannot change conversation agent via per-turn override')
    }
    if (cur.profileId) {
      if (!hasCredentials(cur.profileId, cur.agent, this.deps.agentHomeRoot)) {
        throw new NoCredentialsError(cur.profileId, cur.agent)
      }
    }
    if (this.deps.tm.isBusy(cur.id)) {
      throw new Error(`Conversation ${cur.id} already has a running agent task`)
    }
    const resolved = this.resolveOrThrow(cur.profileId ?? null, { ...cur.extra.overrides, ...input.override }, cur.agent)
    const now = nowMs()
    const msgId = newId()
    const userRowId = newId()
    this.deps.messages.insert({
      id: userRowId, conversationId: cur.id, msgId, role: 'user',
      content: input.content, createdAt: now,
    })
    this.deps.conversations.updateStatus(cur.id, 'running')

    const skillDefs = cur.extra.skills
      .map(name => this.deps.skills.byName(name))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
    const profileInstructions = composeAppendSystemPrompt(resolved.appendSystemPrompt, skillDefs)

    let prevSession = this.deps.sessions.findByConversation(cur.id)?.agentSessionId
    let envWithHome: Record<string, string> | undefined = resolved.env
    if (cur.profileId) {
      const { path, isNew } = ensureAgentHome(this.deps.agentHomeRoot, cur.profileId, cur.agent)
      envWithHome = { ...envFor(cur.agent, path), ...(resolved.env ?? {}) }
      if (isNew) prevSession = undefined
      writeProfileInstructions(path, profileInstructions)
      writeProfileSkills(path, skillDefs)
    }
    const { appendSystemPrompt: _, ...resolvedWithoutAppend } = resolved
    const resolvedForTurn: ResolvedProfile = { ...resolvedWithoutAppend, env: envWithHome }
    const task = await this.deps.tm.getOrBuild(
      { id: cur.id, agent: cur.agent, workspacePath: cur.workspacePath },
      resolvedForTurn,
      { prompt: input.content, msgId, prevAgentSessionId: prevSession },
    )

    const messageRowId = newId()
    const relay = new StreamRelay({
      conversationId: cur.id, msgId, messageRowId,
      conversations: this.deps.conversations,
      messages: this.deps.messages,
      artifacts: this.deps.artifacts,
      sessions: this.deps.sessions,
      sse: this.deps.sse,
      cronHandler: async (cmd, convId) => this.deps.cron.handle(cmd, convId),
      agent: cur.agent,
    })
    const done = relay.attach(task.emitter).then(() => {
      if (cur.profileId) this.deps.profiles.touchLastUsed(cur.profileId)
    })

    return { msgId, messageId: userRowId, done }
  }
```

- [ ] **Step 2: Reduce `sendMessage` to a thin wrapper**

Replace the entire existing `sendMessage` body (lines ~175-261) with:

```ts
  async sendMessage(id: string, input: SendMessageInput): Promise<{ msgId: string; messageId: string }> {
    const cur = this.deps.conversations.findById(id)
    if (!cur) throw new Error(`Conversation not found: ${id}`)
    const { msgId, messageId, done } = await this.startTurn(cur, input)
    void done
    return { msgId, messageId }
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: PASS.

- [ ] **Step 4: Run existing conversation tests**

Run: `pnpm vitest run packages/conversation`
Expected: existing tests still pass (no behavior change for sendMessage callers).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/conversation-service.ts
git commit -m "refactor(conversation): extract startTurn helper from sendMessage

Same behavior, but the relay's done promise is now reachable internally.
Lets createAndAwaitFirstTurn (next commit) await first-turn completion
without duplicating the agent-home + skills-sync + task-build logic."
```

---

## Task 3: Add `createAndAwaitFirstTurn` to ConversationService

**Files:**
- Modify: `packages/conversation/src/conversations/conversation-service.ts`

- [ ] **Step 1: Add input type**

In `conversation-service.ts`, near the existing `CreateConversationInput` / `SendMessageInput` interfaces, add:

```ts
export interface CreateAndAwaitFirstTurnInput {
  title: string
  profileId: string
  override?: ProfileOverride
  content: string
  workspacePath?: string
  signal?: AbortSignal
}

export interface CreateAndAwaitFirstTurnResult {
  conversationId: string
  messageId: string
  text: string
}
```

- [ ] **Step 2: Add the method**

Append this method to the `ConversationService` class (after `sendMessage`):

```ts
  async createAndAwaitFirstTurn(
    input: CreateAndAwaitFirstTurnInput,
  ): Promise<CreateAndAwaitFirstTurnResult> {
    const conv = this.create({
      title: input.title,
      profileId: input.profileId,
      override: input.override,
      workspacePath: input.workspacePath,
    })
    const { done } = await this.startTurn(conv, { content: input.content })

    if (input.signal?.aborted) {
      await this.cancel(conv.id)
      throw new Error('cancelled before first turn started')
    }
    const abortPromise = input.signal
      ? new Promise<'aborted'>((resolve) => {
          const onAbort = () => resolve('aborted')
          input.signal!.addEventListener('abort', onAbort, { once: true })
        })
      : null

    const result = abortPromise
      ? await Promise.race([done.then(() => 'done' as const), abortPromise])
      : await done.then(() => 'done' as const)

    if (result === 'aborted') {
      await this.cancel(conv.id)
      throw new Error('cancelled during first turn')
    }

    const final = this.deps.conversations.findById(conv.id)
    if (!final) throw new Error(`Conversation vanished: ${conv.id}`)
    if (final.status === 'error') {
      const messages = this.deps.messages.listForConversation(conv.id)
      const last = messages.filter((m) => m.role === 'assistant').pop()
      const errMsg = (last?.metadata as { error?: { message?: string } } | undefined)?.error?.message
        ?? 'agent run failed'
      throw new Error(errMsg)
    }
    const messages = this.deps.messages.listForConversation(conv.id)
    const last = messages.filter((m) => m.role === 'assistant').pop()
    if (!last) throw new Error('first turn finished without an assistant message')
    return { conversationId: conv.id, messageId: last.id, text: last.content }
  }
```

- [ ] **Step 3: Write the test file**

Create `packages/conversation/tests/conversation-service-await.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationService } from '../src/index.js'
import type { TypedEmitter, AgentEventMap, AiAgentService, AgentRunOpts, AgentRun } from '@anubis/ai-agent'
import { EventEmitter } from 'node:events'

function fakeEmitter(): TypedEmitter<AgentEventMap> {
  return new EventEmitter() as unknown as TypedEmitter<AgentEventMap>
}

function fakeAiAgent(
  drive: (em: TypedEmitter<AgentEventMap>) => void,
): AiAgentService {
  return {
    streamAgent(_opts: AgentRunOpts): AgentRun {
      const em = fakeEmitter()
      setImmediate(() => drive(em))
      return { emitter: em, kill: async () => {}, killed: false } as unknown as AgentRun
    },
    catalog: () => ({ agents: [] }),
  } as unknown as AiAgentService
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'anubis-await-'))
})

describe('createAndAwaitFirstTurn', () => {
  it('returns the assistant text after the first turn completes', async () => {
    const stack = createConversationService({
      dataDir: tmpDir,
      skillRoots: [],
      aiAgent: fakeAiAgent((em) => {
        em.emit('partial', { deltaText: 'hello ' })
        em.emit('partial', { deltaText: 'world' })
        em.emit('done', { finishReason: 'stop' })
      }),
    })
    try {
      const result = await stack.conversation.createAndAwaitFirstTurn({
        title: 'test',
        profileId: 'claude-coding',
        content: 'say hi',
      })
      expect(result.text).toBe('hello world')
      expect(result.conversationId).toMatch(/.+/)
    } finally {
      await stack.shutdown()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws on agent error', async () => {
    const stack = createConversationService({
      dataDir: tmpDir,
      skillRoots: [],
      aiAgent: fakeAiAgent((em) => {
        em.emit('error', { error: new Error('boom') })
      }),
    })
    try {
      await expect(
        stack.conversation.createAndAwaitFirstTurn({
          title: 'test', profileId: 'claude-coding', content: 'hi',
        }),
      ).rejects.toThrow(/boom/)
    } finally {
      await stack.shutdown()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('cancels when signal aborts', async () => {
    const ctl = new AbortController()
    const stack = createConversationService({
      dataDir: tmpDir,
      skillRoots: [],
      aiAgent: fakeAiAgent(() => {
        setTimeout(() => ctl.abort(), 10)
        // never emits 'done'
      }),
    })
    try {
      await expect(
        stack.conversation.createAndAwaitFirstTurn({
          title: 'test', profileId: 'claude-coding', content: 'hi', signal: ctl.signal,
        }),
      ).rejects.toThrow(/cancelled/)
    } finally {
      await stack.shutdown()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/conversation/tests/conversation-service-await.test.ts`
Expected: all 3 tests pass. If a test fails because the fake `AiAgentService` shape is wrong, inspect the real `AiAgentService` interface in `packages/ai-agent/src/service/` and adjust the fake to match (the real shape is `streamAgent(opts) => { emitter, kill, killed }`).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/conversation-service.ts packages/conversation/tests/conversation-service-await.test.ts
git commit -m "feat(conversation): add createAndAwaitFirstTurn

Creates a conversation, sends the first user message, awaits the relay's
done event, and returns the assistant reply. Honors an optional
AbortSignal so workflow cancellation can kill the in-flight turn.

The conversation row stays in the DB after the call returns, so the user
can open it in the chat UI and keep messaging."
```

---

## Task 4: Extend ExecutorContext with `conversations` adapter

**Files:**
- Modify: `packages/workflow-runtime/src/types.ts`

- [ ] **Step 1: Add the new field**

Open `packages/workflow-runtime/src/types.ts`. Replace the `ExecutorContext` interface (lines 54-62) with:

```ts
export interface ExecutorContext {
  crawler: { captureProfile: (url: string) => Promise<CapturedPost> }
  ocr:     { extractFromImage: (path: string) => Promise<string> }
  db:      { getCapturedPost: (id: string) => Promise<CapturedPost> }
  fs:      { writeRunArtifact: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string> }
  conversations: {
    createAndAwaitFirstTurn(input: {
      title: string
      profileId: string
      reasoning?: 'minimal' | 'low' | 'medium' | 'high'
      content: string
    }): Promise<{ conversationId: string; messageId: string; text: string }>
    cancel(conversationId: string): Promise<void>
  }
  runId:   string
  signal:  AbortSignal
  emit:    (event: NodeRunEvent) => void
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/workflow-runtime typecheck`
Expected: PASS. Existing executors don't touch `ctx.conversations` so they're unaffected. Existing test stubCtx in `tests/executors/*.test.ts` will fail compilation — fix in next step.

- [ ] **Step 3: Update test stubs**

In each of these six test files, add a `conversations` field to the `stubCtx` object:
- `packages/workflow-runtime/tests/executors/transformer-brief.test.ts`
- `packages/workflow-runtime/tests/executors/transformer-media.test.ts`
- `packages/workflow-runtime/tests/executors/table.test.ts`
- `packages/workflow-runtime/tests/executors/instagram-post.test.ts`
- `packages/workflow-runtime/tests/executors/ocr-extractor.test.ts`
- `packages/workflow-runtime/tests/executors/image-video.test.ts`

In each file, find the `stubCtx` const definition. Add this line inside the object, immediately after the `fs:` line:

```ts
  conversations: {
    createAndAwaitFirstTurn: async () => ({ conversationId: 'c1', messageId: 'm1', text: '' }),
    cancel: async () => {},
  },
```

Also delete the now-stale `agent: { run: async () => ({ text: '' }) },` line in `transformer-brief.test.ts` — that field was removed in commit `89252ff` but the stub still has it (the test passes today only because TS coerces `as const`; remove for hygiene).

- [ ] **Step 4: Run all workflow-runtime tests**

Run: `pnpm vitest run packages/workflow-runtime`
Expected: all existing executor tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/types.ts packages/workflow-runtime/tests/executors/
git commit -m "feat(workflow-runtime): add conversations adapter to ExecutorContext

Lets executors spawn a chat conversation and await its first turn. The
backend wires this to ConversationService.createAndAwaitFirstTurn in a
follow-up commit. Stub ctx in existing executor tests updated."
```

---

## Task 5: Wire `conversations` adapter in WorkflowRunManager

**Files:**
- Modify: `packages/backend/src/workflow-run-manager.ts`

- [ ] **Step 1: Plumb the adapter into the executor context**

Open `packages/backend/src/workflow-run-manager.ts`. Find the `const ctx = { ... }` block inside `runAndPersist` (around line 152). Add this field after the `fs` block and before `runId`:

```ts
        conversations: {
          createAndAwaitFirstTurn: async (input: {
            title: string
            profileId: string
            reasoning?: 'minimal' | 'low' | 'medium' | 'high'
            content: string
          }) => {
            const override = input.reasoning ? { reasoningEffort: input.reasoning } : undefined
            return this.stack.conversation.createAndAwaitFirstTurn({
              title: input.title,
              profileId: input.profileId,
              override,
              content: input.content,
              signal: active.controller.signal,
            })
          },
          cancel: async (conversationId: string) => {
            await this.stack.conversation.cancel(conversationId)
          },
        },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/workflow-run-manager.ts
git commit -m "feat(backend): wire conversations adapter into workflow ExecutorContext

Forwards the workflow run's AbortSignal so cancelling the workflow also
cancels the in-flight conversation turn. The reasoning option from the
node config becomes a per-turn ProfileOverride."
```

---

## Task 6: Implement the `aiAgentConversation` executor

**Files:**
- Create: `packages/workflow-runtime/src/executors/ai-agent-conversation.ts`
- Test:   `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { aiAgentConversationExecutor } from '../../src/executors/ai-agent-conversation.js'

function makeCtx(spy = vi.fn()) {
  return {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: {
      createAndAwaitFirstTurn: spy.mockResolvedValue({
        conversationId: 'c1', messageId: 'm1', text: 'hi there',
      }),
      cancel: async () => {},
    },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
  } as const
}

describe('aiAgentConversationExecutor', () => {
  it('returns { kind, conversationId, messageId, text }', async () => {
    const ctx = makeCtx()
    const out = await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'claude-coding', reasoning: 'medium', prompt: 'hi' },
        upstream: {},
      },
      ctx,
    )
    expect(out).toEqual({ kind: 'conversation', conversationId: 'c1', messageId: 'm1', text: 'hi there' })
  })

  it('wraps each upstream entry in a context block', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', prompt: 'do it' },
        upstream: { srcA: { foo: 1 }, srcB: { bar: 2 } },
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/<context source="srcA">/)
    expect(sent).toMatch(/"foo": 1/)
    expect(sent).toMatch(/<context source="srcB">/)
    expect(sent).toMatch(/"bar": 2/)
    expect(sent).toMatch(/do it\s*$/)
  })

  it('collects file paths from { paths }, { mediaPaths }, and { kind:"file", path }', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', prompt: 'do it' },
        upstream: {
          a: { paths: ['C:\\a.png', 'C:\\b.png'] },
          b: { mediaPaths: ['/tmp/c.mp4'] },
          c: { kind: 'file', path: '/tmp/d.json' },
        },
      },
      ctx,
    )
    const sent = spy.mock.calls[0]![0].content as string
    expect(sent).toMatch(/Attached files:/)
    expect(sent).toMatch(/- C:\\a\.png/)
    expect(sent).toMatch(/- C:\\b\.png/)
    expect(sent).toMatch(/- \/tmp\/c\.mp4/)
    expect(sent).toMatch(/- \/tmp\/d\.json/)
  })

  it('forwards reasoning to createAndAwaitFirstTurn', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      {
        nodeId: 'n1',
        config: { profileId: 'p', reasoning: 'high', prompt: 'go' },
        upstream: {},
      },
      ctx,
    )
    expect(spy.mock.calls[0]![0].reasoning).toBe('high')
    expect(spy.mock.calls[0]![0].profileId).toBe('p')
  })

  it('uses titleTemplate when provided, else default', async () => {
    const spy = vi.fn().mockResolvedValue({ conversationId: 'c1', messageId: 'm1', text: '' })
    const ctx = makeCtx(spy)
    await aiAgentConversationExecutor.run(
      { nodeId: 'n1', config: { profileId: 'p', prompt: 'x', titleTemplate: 'Run X' }, upstream: {} },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Run X')

    spy.mockClear()
    await aiAgentConversationExecutor.run(
      { nodeId: 'n1', config: { profileId: 'p', prompt: 'x' }, upstream: {} },
      ctx,
    )
    expect(spy.mock.calls[0]![0].title).toBe('Workflow · n1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`
Expected: FAIL with "Failed to load module … ai-agent-conversation" or similar.

- [ ] **Step 3: Write the executor**

Create `packages/workflow-runtime/src/executors/ai-agent-conversation.ts`:

```ts
import { z } from 'zod'
import type { Executor } from '../types.js'

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

function composeMessage(upstream: Record<string, unknown>, prompt: string): string {
  const contextBlocks: string[] = []
  const files: string[] = []
  for (const [src, value] of Object.entries(upstream)) {
    files.push(...collectFiles(value))
    contextBlocks.push(`<context source="${src}">\n${JSON.stringify(value, null, 2)}\n</context>`)
  }
  const parts: string[] = []
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
    const content = composeMessage(input.upstream, input.config.prompt)
    const title = input.config.titleTemplate ?? `Workflow · ${input.nodeId}`
    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
    })
    return {
      kind: 'conversation',
      conversationId: result.conversationId,
      messageId: result.messageId,
      text: result.text,
    }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime/src/executors/ai-agent-conversation.ts packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts
git commit -m "feat(workflow-runtime): add aiAgentConversation executor

Composes upstream node outputs into <context> blocks plus an attached
file list, then calls ctx.conversations.createAndAwaitFirstTurn to spawn
a real chat session. Returns conversationId + messageId + assistant text
so downstream nodes can either chain off the reply or link to the chat."
```

---

## Task 7: Register the executor in the runtime registry

**Files:**
- Modify: `packages/workflow-runtime/src/executors/index.ts`

- [ ] **Step 1: Add the registry entry**

Replace `packages/workflow-runtime/src/executors/index.ts` with:

```ts
import type { Executor } from '../types.js'
import { tableExecutor }                from './table.js'
import { transformerBriefExecutor }     from './transformer-brief.js'
import { instagramPostExecutor }        from './instagram-post.js'
import { transformerMediaExecutor }     from './transformer-media.js'
import { ocrExtractorExecutor }         from './ocr-extractor.js'
import { imageVideoExecutor }           from './image-video.js'
import { aiAgentConversationExecutor }  from './ai-agent-conversation.js'

export const executorRegistry: Record<string, Executor<unknown>> = {
  table:                tableExecutor as Executor<unknown>,
  transformerBrief:     transformerBriefExecutor as Executor<unknown>,
  instagramPost:        instagramPostExecutor as Executor<unknown>,
  transformerMedia:     transformerMediaExecutor as Executor<unknown>,
  ocrExtractor:         ocrExtractorExecutor as Executor<unknown>,
  imageVideo:           imageVideoExecutor as Executor<unknown>,
  aiAgentConversation:  aiAgentConversationExecutor as Executor<unknown>,
}

export type ExecutorKey = keyof typeof executorRegistry

export {
  tableExecutor, transformerBriefExecutor,
  instagramPostExecutor, transformerMediaExecutor, ocrExtractorExecutor,
  imageVideoExecutor, aiAgentConversationExecutor,
}
```

- [ ] **Step 2: Build the package**

Run: `pnpm --filter @anubis/workflow-runtime build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/workflow-runtime/src/executors/index.ts
git commit -m "feat(workflow-runtime): register aiAgentConversation in registry"
```

---

## Task 8: Frontend — node renderer

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`

- [ ] **Step 1: Write the renderer**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`:

```tsx
import { memo } from 'react'
import { Bot } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface AiAgentConversationNodeData {
  profileId?: string
  reasoning?: 'minimal' | 'low' | 'medium' | 'high'
  prompt?: string
  titleTemplate?: string
}

export const AiAgentConversationExecutableNode = memo(function AiAgentConversationExecutableNode({
  id, data,
}: { id: string; data: AiAgentConversationNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const promptPreview = (data.prompt ?? '').slice(0, 120) || '<no prompt>'
  return (
    <NodeShell
      icon={Bot}
      title='AI Agent · Conversation'
      subtitle={data.profileId ? `Profile: ${data.profileId} · reasoning: ${data.reasoning ?? 'default'}` : 'Pick a profile in the inspector'}
      accent='from-[#fd551d] to-[#ff9b7a]'
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <pre className='text-[10px] text-zinc-300 whitespace-pre-wrap break-words'>{promptPreview}</pre>
    </NodeShell>
  )
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (file is unreferenced yet, so it just compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx
git commit -m "feat(frontend): aiAgentConversation node renderer"
```

---

## Task 9: Frontend — inspector config form

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/inspector/config/ai-agent-conversation-config.tsx`

- [ ] **Step 1: Write the form**

Create `packages/frontend/src/components/workflow-editor/inspector/config/ai-agent-conversation-config.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listProfiles } from '@/api'

type Reasoning = 'minimal' | 'low' | 'medium' | 'high'
type Data = {
  profileId?: string
  reasoning?: Reasoning
  prompt?: string
  titleTemplate?: string
}

export function AiAgentConversationConfigForm({ nodeId }: { nodeId: string }) {
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
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>AI Agent · Conversation</p>
      <label className='block text-xs'>Profile
        <Select value={data.profileId ?? ''} onValueChange={(v) => update({ profileId: v })}>
          <SelectTrigger className='mt-1'><SelectValue placeholder='Pick a profile' /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Reasoning effort
        <Select value={data.reasoning ?? 'medium'} onValueChange={(v) => update({ reasoning: v as Reasoning })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='minimal'>minimal</SelectItem>
            <SelectItem value='low'>low</SelectItem>
            <SelectItem value='medium'>medium</SelectItem>
            <SelectItem value='high'>high</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Initial prompt
        <Textarea className='mt-1' rows={6} value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} />
      </label>
      <label className='block text-xs'>Conversation title (optional)
        <Input
          className='mt-1'
          placeholder={`Workflow · ${nodeId}`}
          value={data.titleTemplate ?? ''}
          onChange={(e) => update({ titleTemplate: e.target.value || undefined })}
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/inspector/config/ai-agent-conversation-config.tsx
git commit -m "feat(frontend): aiAgentConversation inspector config form"
```

---

## Task 10: Frontend — register in palette + inspector

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`
- Modify: `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`

- [ ] **Step 1: Add to executable node types + palette**

Replace `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts` with:

```ts
import type { NodeTypes } from '@xyflow/react'
import { InstagramPostExecutableNode }          from './instagram-post'
import { TransformerMediaExecutableNode }       from './transformer-media'
import { TransformerBriefExecutableNode }       from './transformer-brief'
import { OcrExtractorExecutableNode }           from './ocr-extractor'
import { TableExecutableNode }                  from './table'
import { ImageVideoExecutableNode }             from './image-video'
import { AiAgentConversationExecutableNode }    from './ai-agent-conversation'

export const executableNodeTypes: NodeTypes = {
  instagramPost:       InstagramPostExecutableNode as never,
  transformerMedia:    TransformerMediaExecutableNode as never,
  transformerBrief:    TransformerBriefExecutableNode as never,
  ocrExtractor:        OcrExtractorExecutableNode as never,
  table:               TableExecutableNode as never,
  imageVideo:          ImageVideoExecutableNode as never,
  aiAgentConversation: AiAgentConversationExecutableNode as never,
}

export const NODE_PALETTE = [
  { type: 'instagramPost',       label: 'Instagram Post' },
  { type: 'imageVideo',          label: 'Image / Video' },
  { type: 'transformerMedia',    label: 'Transformer · Media' },
  { type: 'transformerBrief',    label: 'Transformer · Brief' },
  { type: 'ocrExtractor',        label: 'OCR Extractor' },
  { type: 'table',               label: 'Table' },
  { type: 'aiAgentConversation', label: 'AI Agent · Conversation' },
] as const
```

- [ ] **Step 2: Register the config form**

Open `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`. Add the import after the existing `ImageVideoConfigForm` import:

```ts
import { AiAgentConversationConfigForm } from './inspector/config/ai-agent-conversation-config'
```

Then in the `CONFIG_FORMS` map (around line 13), add a trailing entry:

```ts
const CONFIG_FORMS: Record<string, FC<{ nodeId: string }>> = {
  instagramPost:       InstagramPostConfigForm,
  transformerMedia:    TransformerMediaConfigForm,
  transformerBrief:    TransformerBriefConfigForm,
  ocrExtractor:        OcrExtractorConfigForm,
  table:               TableConfigForm,
  imageVideo:          ImageVideoConfigForm,
  aiAgentConversation: AiAgentConversationConfigForm,
}
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/index.ts packages/frontend/src/components/workflow-editor/inspector-panel.tsx
git commit -m "feat(frontend): register aiAgentConversation in palette + inspector"
```

---

## Task 11: Whole-repo typecheck + tests

- [ ] **Step 1: Repo typecheck**

Run: `pnpm typecheck`
Expected: PASS across every package. If a package fails, fix in place — typical failures are missed `conversations` stubs in tests (re-check Task 4 Step 3) or a missing `.js` import extension.

- [ ] **Step 2: Repo tests**

Run: `pnpm test`
Expected: all green. The new tests are:
- `packages/conversation/tests/conversation-service-await.test.ts` (3 tests)
- `packages/workflow-runtime/tests/executors/ai-agent-conversation.test.ts` (5 tests)

- [ ] **Step 3: Commit any test-fix touch-ups**

If any fixes were needed:

```bash
git add -A
git commit -m "chore: cross-package fixups for aiAgentConversation"
```

If nothing changed, skip the commit.

---

## Task 12: Manual smoke test

This step is a verification, not a code change.

- [ ] **Step 1: Boot the desktop dev loop**

Run: `pnpm dev`
Expected: Electron window opens. Backend `backend-ready` line prints in terminal.

- [ ] **Step 2: Verify profile rename**

In the chat sidebar, open the profile picker. Confirm:
- "Claude — Coding" (not "Claude — Coding (plan mode)") appears.
- Open one, start a new chat with prompt `hi`. Confirm the agent runs without prompting `Approval required` for read-only tools — i.e. it's not in plan mode anymore.

- [ ] **Step 3: Build a workflow**

Open the workflow editor (sidebar → Workflows → new). Drag:
1. `Image / Video` node onto canvas. Configure it with a sample file path.
2. `AI Agent · Conversation` node. Connect Image/Video → AI Agent.
3. In the AI Agent inspector: pick a profile (e.g. Claude — Coding), set reasoning `medium`, set prompt `"Describe the attached image in one sentence."`

- [ ] **Step 4: Publish + run**

Click `Publish` then `Run`. Wait for run-finished.
Expected:
- The AI Agent node turns green (succeeded).
- The conversation appears in the chat list with the title `Workflow · <nodeId>`.
- The node output (visible in the inspector's Run tab) contains `{ kind: 'conversation', conversationId, messageId, text }` with the assistant's reply as `text`.

- [ ] **Step 5: Open the spawned conversation**

Click into the new conversation. Confirm:
- The first user message has the `<context source="…">` block plus `Attached files:` list plus the configured prompt.
- The first assistant message matches the node output's `text`.
- You can send a follow-up message and the agent replies — the conversation is fully alive.

If anything fails, file fixes against the originating task and rerun. Done.

---

## Self-review notes

- **Spec coverage:** plan-mode removal (Task 1), config schema (Task 6), input composition rules (Task 6 + tests), `createAndAwaitFirstTurn` method (Task 3), `ExecutorContext` extension (Task 4), backend wiring (Task 5), node renderer (Task 8), config form (Task 9), palette + inspector registration (Task 10). All covered.
- **Type consistency:** the `conversations` adapter has the same shape in `types.ts`, the backend wiring, the executor stub, and the consumer in the executor.
- **No placeholders:** every code-changing step contains the actual code. Test files include the full test bodies. The smoke test (Task 12) is the only step without code — that's intentional, it's manual verification.
