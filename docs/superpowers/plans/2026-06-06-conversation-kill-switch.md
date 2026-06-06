# Conversation Kill Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stopping a conversation's agent a reliable force-kill — always terminate the underlying OS process tree and always return the conversation + UI to a terminal state, fixing the "agent stuck in infinite pending/progress" bug.

**Architecture:** Add a `killProcessTree` utility in `@anubis/ai-agent` and wire it into every runner's cancel path (Claude runner, Codex pool eviction). Make `TaskManager.kill` cover the in-flight "building" window. Make `ConversationService.cancel` guarantee a terminal DB status + a synthetic `done` SSE even when no stream relay was attached. Make the frontend Stop button clear live UI state instantly. Reuse the existing `POST /conversations/:id/cancel` endpoint and Stop button — no new routes or UI surfaces.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node `child_process`, Vitest, React 19. pnpm monorepo.

---

## Prerequisites & notes

- **Dirty working tree:** the repo is currently on `feat/workflow-engine-v2` with uncommitted workflow-engine changes (`packages/workflow-runtime/src/runner.ts`, new `runner-loop.test.ts`, `scripts/create-content-pipeline-workflow.mjs`). This kill-switch work is unrelated. Before starting, isolate it — create a dedicated branch/worktree (e.g. `feat/conversation-kill-switch`) so these commits don't tangle with the in-flight workflow work. Use the `superpowers:using-git-worktrees` skill if executing via subagents.
- **Import extensions:** all source imports use explicit `.js` extensions even though files are `.ts`. Follow that.
- **Running a single test file from repo root:** `pnpm vitest run <path>`. ai-agent and conversation tests import their own source via relative `../../src/...` paths, so no dist rebuild is needed for these tasks.
- **Antigravity deviation from spec:** on closer reading, the Antigravity runner is already correct — it runs under `node-pty` (whose `kill()` tears down the whole pty process tree) and emits `done{cancelled}` on exit, and the new `ConversationService.cancel` fallback (Task 5) covers UI clearing universally. So this plan makes **no Antigravity change**. (The spec listed a "parity" tweak; it's dropped as YAGNI.)

---

## Task 1: `killProcessTree` utility (ai-agent)

**Files:**
- Create: `packages/ai-agent/src/agents/process-tree.ts`
- Test: `packages/ai-agent/tests/agents/process-tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai-agent/tests/agents/process-tree.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { killProcessTree } from '../../src/agents/process-tree.js'

describe('killProcessTree', () => {
  it('runs `taskkill /pid <pid> /T /F` on Windows', () => {
    const spawn = vi.fn(() => ({ on: vi.fn() })) as never
    killProcessTree(4242, { platform: 'win32', spawn })
    expect(spawn).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4242', '/T', '/F'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('sends SIGKILL to the pid on POSIX', () => {
    const kill = vi.fn()
    killProcessTree(7, { platform: 'linux', kill })
    expect(kill).toHaveBeenCalledWith(7, 'SIGKILL')
  })

  it('no-ops for an undefined or zero pid', () => {
    const spawn = vi.fn() as never
    const kill = vi.fn()
    killProcessTree(undefined, { platform: 'win32', spawn })
    killProcessTree(0, { platform: 'linux', kill })
    expect(spawn).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by the killer (process already gone)', () => {
    const spawn = vi.fn(() => { throw new Error('taskkill missing') }) as never
    expect(() => killProcessTree(1, { platform: 'win32', spawn })).not.toThrow()
    const kill = vi.fn(() => { throw new Error('ESRCH') })
    expect(() => killProcessTree(1, { platform: 'linux', kill })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ai-agent/tests/agents/process-tree.test.ts`
Expected: FAIL — cannot resolve `../../src/agents/process-tree.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `packages/ai-agent/src/agents/process-tree.ts`:

```ts
import { spawn as nodeSpawn } from 'node:child_process'

export interface KillProcessTreeDeps {
  /** Override platform detection (tests). Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Override the spawn used for the Windows `taskkill` (tests). */
  spawn?: typeof nodeSpawn
  /** Override the POSIX signal sender (tests). */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/**
 * Forcibly terminate a process AND its entire descendant tree.
 *
 * The agents are spawned through a `cmd.exe` shim on Windows, so the real
 * agent runs as a grandchild. A plain `child.kill()` would only signal the
 * wrapper and orphan the agent. `taskkill /T` walks the tree; `/F` forces it.
 * On POSIX the agents are spawned directly, so SIGKILL on the pid is enough.
 *
 * Always best-effort: the process may already be gone, so every failure mode
 * (missing taskkill, ESRCH) is swallowed.
 */
export function killProcessTree(pid: number | undefined, deps: KillProcessTreeDeps = {}): void {
  if (!pid || pid <= 0) return
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    const spawnFn = deps.spawn ?? nodeSpawn
    try {
      const child = spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      // taskkill itself can fail (already exited); never let that surface.
      child.on('error', () => { /* best-effort */ })
    } catch { /* best-effort */ }
  } else {
    const killFn = deps.kill ?? ((p, s) => process.kill(p, s))
    try { killFn(pid, 'SIGKILL') } catch { /* ESRCH: already dead */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ai-agent/tests/agents/process-tree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-agent/src/agents/process-tree.ts packages/ai-agent/tests/agents/process-tree.test.ts
git commit -m "feat(ai-agent): add killProcessTree util for force-stopping agents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire tree-kill + immediate terminal into Claude runner cancel

**Files:**
- Modify: `packages/ai-agent/src/agents/claude/runner.ts` (the `cancel` closure, ~lines 129-137)
- Test: `packages/ai-agent/tests/agents/claude/cancel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai-agent/tests/agents/claude/cancel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

vi.mock('../../../src/agents/spawn-shim.js', () => ({
  spawnNpmShim: vi.fn(),
}))
vi.mock('../../../src/agents/process-tree.js', () => ({
  killProcessTree: vi.fn(),
}))

import { spawnNpmShim } from '../../../src/agents/spawn-shim.js'
import { killProcessTree } from '../../../src/agents/process-tree.js'
import { ClaudeAgent } from '../../../src/agents/claude/runner.js'

function makeFakeChild() {
  const child = new EventEmitter() as never as {
    pid: number
    stdout: PassThrough
    stderr: PassThrough
    stdin: { end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
    on: (ev: string, fn: (...a: never[]) => void) => void
  }
  child.pid = 4242
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = { end: vi.fn(), on: vi.fn() }
  child.kill = vi.fn()
  return child
}

describe('ClaudeAgent cancel', () => {
  it('tree-kills the process and emits a cancelled done immediately', async () => {
    const child = makeFakeChild()
    ;(spawnNpmShim as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child)

    const agent = new ClaudeAgent({ command: 'claude.cmd' })
    const { emitter, cancel } = await agent.run({ workspaceId: 'w', cwd: '/tmp', prompt: 'hi' })

    const done = vi.fn()
    emitter.on('done', done)

    cancel()

    expect(killProcessTree).toHaveBeenCalledWith(4242)
    expect(done).toHaveBeenCalledWith({ finishReason: 'cancelled' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ai-agent/tests/agents/claude/cancel.test.ts`
Expected: FAIL — `killProcessTree` is never called (runner still uses `child.kill()`), and `done` is not emitted synchronously on cancel (current code waits for `close`).

- [ ] **Step 3: Write minimal implementation**

In `packages/ai-agent/src/agents/claude/runner.ts`, add the import near the top (after the existing `spawnNpmShim` import on line 7):

```ts
import { killProcessTree } from '../process-tree.js'
```

Replace the existing `cancel` closure (currently):

```ts
    let cancelled = false
    const cancel = () => {
      if (cancelled) return
      cancelled = true
      try { child.stdin?.end() } catch { /* already closed */ }
      // SIGTERM lets the CLI tear down its session cleanly; the `close`
      // handler below emits the terminal `done`.
      child.kill()
    }
```

with:

```ts
    let cancelled = false
    const cancel = () => {
      if (cancelled) return
      cancelled = true
      try { child.stdin?.end() } catch { /* already closed */ }
      // Hard kill the whole tree: on Windows `child` is the cmd.exe shim and
      // the real agent is a grandchild, so child.kill() alone would orphan it.
      killProcessTree(child.pid)
      // Emit the terminal immediately rather than waiting for `close` — a hung
      // child may never close its stdout pipe, which would leave the UI
      // streaming forever. `terminalEmitted` guards against a later `close`
      // double-firing.
      if (!terminalEmitted) emitter.emit('done', { finishReason: 'cancelled' })
    }
```

(The `close` handler's existing `if (cancelled) { emitter.emit('done', …) }` branch stays as a guarded backstop — `terminalEmitted` is already true by then, so its own `if (terminalEmitted) return` at the top short-circuits.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ai-agent/tests/agents/claude/cancel.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-agent/src/agents/claude/runner.ts packages/ai-agent/tests/agents/claude/cancel.test.ts
git commit -m "fix(ai-agent): Claude cancel tree-kills and emits terminal immediately

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire tree-kill into Codex pool eviction

**Files:**
- Modify: `packages/ai-agent/src/agents/codex/pool.ts` (the `evict` method, ~lines 53-68)
- Test: `packages/ai-agent/tests/agents/codex/pool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai-agent/tests/agents/codex/pool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/agents/process-tree.js', () => ({
  killProcessTree: vi.fn(),
}))

import { killProcessTree } from '../../../src/agents/process-tree.js'
import { CodexPool } from '../../../src/agents/codex/pool.js'

describe('CodexPool evict', () => {
  it('tree-kills the pooled child instead of a bare kill()', async () => {
    const child = { pid: 999, kill: vi.fn(), stdin: { end: vi.fn() } } as never
    const pool = new CodexPool({ idleMs: 10_000, spawn: () => child })
    await pool.acquire({ workspaceId: 'w', sessionId: 's' })

    pool.evict({ workspaceId: 'w', sessionId: 's' })

    expect(killProcessTree).toHaveBeenCalledWith(999)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ai-agent/tests/agents/codex/pool.test.ts`
Expected: FAIL — `killProcessTree` not called (evict still calls `slot.child.kill()`).

- [ ] **Step 3: Write minimal implementation**

In `packages/ai-agent/src/agents/codex/pool.ts`, add the import after line 1 (`import type { ChildProcessWithoutNullStreams } …`):

```ts
import { killProcessTree } from '../process-tree.js'
```

Replace the body of `evict` (currently):

```ts
  evict(key: PoolKey): void {
    const k = this.k(key)
    const slot = this.slots.get(k)
    if (!slot) return
    try {
      try {
        slot.child.stdin?.end()
      } catch {
        // ignore
      }
      slot.child.kill()
    } catch {
      // ignore
    }
    this.slots.delete(k)
  }
```

with:

```ts
  evict(key: PoolKey): void {
    const k = this.k(key)
    const slot = this.slots.get(k)
    if (!slot) return
    try {
      try {
        slot.child.stdin?.end()
      } catch {
        // ignore
      }
      // Tree-kill: the app-server runs under a cmd.exe shim on Windows, so a
      // bare kill() would orphan it and leak the process across turns.
      killProcessTree(slot.child.pid)
    } catch {
      // ignore
    }
    this.slots.delete(k)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ai-agent/tests/agents/codex/pool.test.ts`
Expected: PASS (1 test).

Also run the existing codex-adjacent tests to confirm no regression:
Run: `pnpm vitest run packages/ai-agent/tests/agents/spawn-shim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-agent/src/agents/codex/pool.ts packages/ai-agent/tests/agents/codex/pool.test.ts
git commit -m "fix(ai-agent): Codex pool eviction tree-kills the app-server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Cover the building window in `TaskManager.kill`

**Files:**
- Modify: `packages/conversation/src/conversations/task-manager.ts` (add `cancelledWhileBuilding`, update `getOrBuild` build IIFE and `kill`)
- Test: `packages/conversation/tests/conversations/task-manager.test.ts` (add one test)

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('TaskManager', …)` block in `packages/conversation/tests/conversations/task-manager.test.ts`. It uses a service whose `streamAgent` stays pending until we resolve it, so we can fire `kill` mid-build:

```ts
  it('kill during the building window tears the run down once it spawns', async () => {
    let resolveStream: (v: unknown) => void = () => {}
    const streamReady = new Promise((r) => { resolveStream = r })
    const cancel = vi.fn(async () => {})
    const emitter = new TypedEmitter<AgentEventMap>()
    const svc = {
      streamAgent: vi.fn(() => streamReady),
    }
    const tm = new TaskManager(svc as never, { idleMs: 10_000 })
    const conv = { id: 'c1', agent: 'claude' as const, workspacePath: '/tmp' }
    const profile = { agent: 'claude' as const }

    // Start the turn but leave it stuck in the building window.
    const buildP = tm.getOrBuild(conv, profile, { prompt: 'hi', msgId: 'm1' })
    // Kill while still building — must NOT be a silent no-op.
    await tm.kill('c1', 'user')
    // Now let the spawn finish.
    resolveStream({ stream: emitter, workspaceId: 'w', sessionId: 's', agentSessionId: 'a', cancel })
    await buildP

    // The spawned run was actually cancelled, and no live task remains.
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(tm.isBusy('c1')).toBe(false)
    expect(tm.subscribe('c1')).toBeNull()
    await tm.shutdown()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/conversations/task-manager.test.ts -t "building window"`
Expected: FAIL — `cancel` is called 0 times (current `kill` no-ops when only `building` has the id, and the build registers a live running task).

- [ ] **Step 3: Write minimal implementation**

In `packages/conversation/src/conversations/task-manager.ts`:

(a) Add a field next to `building` (after line 37 `private building = …`):

```ts
  private cancelledWhileBuilding = new Set<string>()
```

(b) At the end of the build IIFE in `getOrBuild`, replace the tail (currently):

```ts
      this.tasks.set(conv.id, task)
      return task
    })()
```

with:

```ts
      this.tasks.set(conv.id, task)
      // A kill that landed while we were still spawning recorded the id here.
      // Tear the freshly-spawned run down now that the child actually exists.
      // (UI/DB state was already settled by ConversationService.cancel.)
      if (this.cancelledWhileBuilding.delete(conv.id)) {
        await task.cancel()
      }
      return task
    })()
```

(c) Replace the `kill` method (currently):

```ts
  async kill(conversationId: string, _reason: 'idle' | 'user' | 'shutdown'): Promise<void> {
    const t = this.tasks.get(conversationId)
    if (!t) return
    await t.cancel()
    this.tasks.delete(conversationId)
  }
```

with:

```ts
  async kill(conversationId: string, _reason: 'idle' | 'user' | 'shutdown'): Promise<void> {
    const t = this.tasks.get(conversationId)
    if (t) {
      await t.cancel()
      this.tasks.delete(conversationId)
      return
    }
    // No live task yet, but a spawn may be in flight. Flag it so the build's
    // continuation kills the run the moment the child exists — instead of
    // silently dropping the Stop and letting an unstoppable turn proceed.
    if (this.building.has(conversationId)) {
      this.cancelledWhileBuilding.add(conversationId)
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/conversations/task-manager.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/task-manager.ts packages/conversation/tests/conversations/task-manager.test.ts
git commit -m "fix(conversation): TaskManager.kill covers the in-flight building window

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `ConversationService.cancel` guarantees a terminal state

**Files:**
- Modify: `packages/conversation/src/conversations/conversation-service.ts` (the `cancel` method, ~lines 341-344)
- Modify: `packages/conversation/tests/conversations/conversation-service.test.ts` (expose `sse` from `setup()`, add one test)

- [ ] **Step 1: Write the failing test**

First, expose the broadcaster from the test's `setup()` so the test can observe SSE. In `packages/conversation/tests/conversations/conversation-service.test.ts`, change the `return { … }` at the end of `setup()` (currently):

```ts
  return { svc, profiles, db, aiAgent, tm, agentHomeRoot, workspacesRoot }
```

to:

```ts
  return { svc, profiles, db, aiAgent, tm, sse, agentHomeRoot, workspacesRoot }
```

Then add this test inside `describe('ConversationService', …)`. It forces a stuck "running" turn (the agent stream never emits a terminal) and asserts `cancel` still drives the conversation to a terminal status and pushes a `done` SSE:

```ts
  it('cancel forces a terminal status and a done SSE even when the stream never ends', async () => {
    plantCreds(ctx.agentHomeRoot, 'claude-coding', 'claude')
    const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp' })

    // A stream that never emits a terminal — simulates a hung agent process.
    const cancelSpy = vi.fn(async () => {})
    ctx.aiAgent.streamAgent.mockImplementation(async () => ({
      stream: new TypedEmitter<AgentEventMap>(),
      workspaceId: 'w',
      sessionId: 's',
      agentSessionId: 'asid-1',
      cancel: cancelSpy,
    }))

    await ctx.svc.sendMessage(c.id, { content: 'hi' })
    expect(ctx.svc.get(c.id)?.status).toBe('running')

    const events: Array<{ name: string }> = []
    const sub = ctx.sse.subscribe(c.id, (e) => events.push(e))

    await ctx.svc.cancel(c.id)

    // The spawned run was actually cancelled...
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    // ...the conversation reaches a terminal status (a clean stop, not error)...
    expect(ctx.svc.get(c.id)?.status).toBe('finished')
    // ...and a terminal `done` reached the UI so it can clear its streaming state.
    expect(events.some((e) => e.name === 'done')).toBe(true)

    sub.unsubscribe()
    await ctx.tm.shutdown()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service.test.ts -t "forces a terminal status"`
Expected: FAIL — current `cancel` sets status to `error` (not `finished`) and never publishes a `done` SSE, so both the status assertion and the events assertion fail.

- [ ] **Step 3: Write minimal implementation**

In `packages/conversation/src/conversations/conversation-service.ts`, replace the `cancel` method (currently):

```ts
  async cancel(id: string): Promise<void> {
    await this.deps.tm.kill(id, 'user')
    this.deps.conversations.updateStatus(id, 'error')
  }
```

with:

```ts
  async cancel(id: string): Promise<void> {
    await this.deps.tm.kill(id, 'user')
    // Guarantee a terminal state. If a stream relay was attached it has
    // already settled the conversation to 'finished' via the runner's
    // cancelled `done`. If not — the run was killed mid-build, or the agent
    // hung and emitted nothing — drive it terminal ourselves and push a
    // synthetic `done` so the UI clears its streaming state. A user-initiated
    // stop is a clean end, so 'finished' (not 'error', which the UI paints red).
    const cur = this.deps.conversations.findById(id)
    if (cur && (cur.status === 'pending' || cur.status === 'running')) {
      this.deps.conversations.updateStatus(id, 'finished')
      this.deps.sse.publish(id, { name: 'done', data: { finishReason: 'cancelled' } })
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/conversations/conversation-service.ts packages/conversation/tests/conversations/conversation-service.test.ts
git commit -m "fix(conversation): cancel guarantees a terminal status + done SSE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend Stop clears live state instantly

**Files:**
- Modify: `packages/frontend/src/pages/active-conversation.tsx` (the `onStop` callback, ~lines 323-338)

No unit test: this is a small UI-timing change with no existing hook-test harness for the SSE/EventSource flow. It is verified by typecheck + a manual run.

- [ ] **Step 1: Implement the change**

In `packages/frontend/src/pages/active-conversation.tsx`, replace the `onStop` callback (currently):

```ts
  const onStop = useCallback(async () => {
    if (!conversationId || stopping) return
    setStopping(true)
    setSendError(null)
    try {
      await cancelConversation(conversationId)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
    // Safety fallback: if the SSE `done` event doesn't arrive within 3s, treat
    // the run as stopped locally so the user isn't stuck staring at "Stop".
    // The SSE hook keeps running, so transcripts remain correct.
    setTimeout(() => setForceStopped(true), 3000)
  }, [conversationId, stopping])
```

with:

```ts
  const onStop = useCallback(async () => {
    if (!conversationId || stopping) return
    setStopping(true)
    setSendError(null)
    // Treat the run as stopped locally right away — the kill switch is a hard
    // force-stop, and the backend now guarantees a terminal `done` event, so we
    // don't wait on the round-trip to clear the live indicators. The SSE hook
    // stays open and reconciles the transcript when `done` lands.
    setForceStopped(true)
    try {
      await cancelConversation(conversationId)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
  }, [conversationId, stopping])
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (no type errors). If the frontend package has no `typecheck` script, run the repo-wide `pnpm typecheck` instead.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev`
- Start a conversation and send a prompt that makes the agent run for a while (e.g. "list every file in this repo and summarize each").
- While it is streaming, click **Stop**.
- Confirm: the composer flips back to **Send** and the footer shows **Idle** immediately (not after a 3s delay); the streaming spinner clears within a moment; no error bubble appears; the partial assistant text remains in the transcript.
- Open Task Manager and confirm no orphaned `claude`/`codex`/`node` agent process keeps running after Stop.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/active-conversation.tsx
git commit -m "feat(frontend): Stop clears live conversation state instantly

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: PASS across every package.

- [ ] **Step 2: Run the affected test suites**

Run:
```bash
pnpm vitest run packages/ai-agent/tests/agents/process-tree.test.ts packages/ai-agent/tests/agents/claude/cancel.test.ts packages/ai-agent/tests/agents/codex/pool.test.ts packages/conversation/tests/conversations/task-manager.test.ts packages/conversation/tests/conversations/conversation-service.test.ts
```
Expected: PASS (all files).

- [ ] **Step 3: Run the broader conversation + ai-agent suites for regressions**

Run: `pnpm vitest run packages/conversation packages/ai-agent`
Expected: PASS. If anything fails, fix before proceeding — do not claim completion on red.

- [ ] **Step 4: Final manual smoke (if not already done in Task 6)**

Confirm Stop reliably stops Claude, Codex, and (if available) Antigravity turns, leaves no orphan processes, and never leaves the UI stuck "thinking…"/streaming.

---

## Self-review (completed during planning)

- **Spec coverage:** killProcessTree util (Task 1) ✓; Claude tree-kill + immediate terminal (Task 2) ✓; Codex pool tree-kill (Task 3) ✓; building-window coverage (Task 4) ✓; guaranteed terminal status + SSE (Task 5) ✓; frontend instant clear (Task 6) ✓; status settles as `finished` not `error` (Task 5) ✓; reuse existing `/cancel` endpoint (no route task — verified unchanged) ✓. Antigravity change intentionally dropped (already correct; documented under Prerequisites).
- **Placeholder scan:** none — every code/test step has complete content.
- **Type consistency:** `killProcessTree(pid?, deps?)` signature is identical across Tasks 1-3; `cancelledWhileBuilding` is the same name in both edits of Task 4; SSE event shape `{ name: 'done', data: { finishReason } }` matches `SseEvent` in `broadcaster.ts`; `done` payload `{ finishReason: 'cancelled' }` matches `AgentEventMap['done']`.
```
