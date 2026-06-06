# Conversation Kill Switch — Design

**Date:** 2026-06-06
**Status:** Approved (design)
**Scope:** Make stopping a conversation's agent reliable — a true force-kill that
always terminates the underlying process *and* always returns the conversation to
a terminal state. Fixes the "agent stuck in infinite pending / progress" bug.

## Problem

The active conversation already has a Stop button:

`active-conversation.tsx` → `cancelConversation` → `POST /conversations/:id/cancel`
→ `ConversationService.cancel` → `TaskManager.kill` → runner `cancel()`.

It is unreliable for three concrete reasons:

1. **Windows orphan process (main culprit — Claude).** Agents are spawned through
   `cmd.exe /d /s /c "claude.cmd …"` (`spawn-shim.ts`). The Claude runner's
   `cancel()` calls `child.kill()`, which on Windows terminates only the `cmd.exe`
   wrapper; the real agent (a grandchild `node`) keeps running and may hold its
   stdout pipe open, so `child.on('close')` never fires → no `done` event → the UI
   streams forever.
2. **`building` blind spot.** `TaskManager.kill` only inspects `this.tasks`, never
   `this.building`. A Stop pressed while the run is still spawning (Codex pool init
   can be slow) is a silent no-op and the agent proceeds unstoppably.
3. **No guaranteed terminal state.** The UI's `streaming` state clears only on an
   SSE `done`/`error`. If the process hangs with no event, nothing resets it (only a
   3s cosmetic fallback that flips the composer button but leaves the spinner up).

Per-agent cancel status today:
- **Claude** — `child.kill()` orphans the real process; `done` depends on `close`. ❌
- **Codex** — emits `done{cancelled}` immediately (UI clears), but `pool.evict()` →
  `slot.child.kill()` orphans the `app-server`. UI recovers, process leaks. ⚠️
- **Antigravity** — runs under `node-pty`, whose `kill()` tears down the pty's whole
  process tree, and emits `done` on exit. Already mostly correct. ✅

## Decision

**Approach A — targeted process-tree kill + guaranteed synthetic terminal**, reusing
the existing `POST /:id/cancel` endpoint and Stop button. Kill behavior is
**immediate hard kill** (no SIGTERM grace period). Surface is the **active
conversation only**.

Rejected alternatives:
- *Detached process-group spawn + group kill* — forces changes to the tuned Windows
  `cmd.exe` shim quoting/stdio in `spawn-shim.ts` (regression risk on the target
  platform) and Windows still needs `taskkill /T`. Not worth it.
- *Watchdog / UI force-reset only* — leaves Claude orphans alive; treats the symptom.

## Kill flow

```
UI Stop click ──▶ clear live state instantly (forceStopped = true now)
              └─▶ cancelConversation(id) ──▶ ConversationService.cancel(id)
                    │
                    ├─ tm.kill(id)              // covers running tasks AND the building window
                    │     └─ task.cancel() ──▶ runner.cancel()
                    │            ├─ killProcessTree(pid)   // taskkill /T /F (win) | SIGKILL (posix)
                    │            └─ emitter.emit('done',{finishReason:'cancelled'})  // immediate
                    │                  └─ StreamRelay → status = 'finished' + SSE 'done'
                    │
                    └─ guaranteed fallback: if status still non-terminal
                       (killed mid-build / no relay attached) → set terminal status
                       + publish synthetic SSE 'done' directly
```

Guarantee: the UI clears and the DB row reaches a terminal status regardless of what
the child does — cooperative exit, hung pipe, or killed before the stream attached.

## Components / changes

### `@anubis/ai-agent`
- **New `src/agents/process-tree.ts`** — `killProcessTree(pid?: number): void`.
  - Windows: `spawn('taskkill', ['/pid', String(pid), '/T', '/F'])`, best-effort
    (swallow errors; the process may already be gone).
  - POSIX: `process.kill(pid, 'SIGKILL')`, swallow `ESRCH`.
  - No-op when pid is undefined/0. Spawn/kill injectable so it is unit-testable.
- **`agents/claude/runner.ts` `cancel()`** — call `killProcessTree(child.pid)`
  (replacing the lone `child.kill()`), then emit `done{finishReason:'cancelled'}`
  immediately, guarded by the existing `terminalEmitted` flag. The `close` handler
  remains as a guarded backstop.
- **`agents/codex/pool.ts` `evict()`** — `killProcessTree(slot.child.pid)` instead of
  `slot.child.kill()`. (Codex already emits `done` immediately in `cancel()`; this
  just stops the orphan leak.)
- **`agents/antigravity/runner.ts` `cancel()`** — keep `proc.kill()` (pty already
  tree-kills) and additionally emit `done{cancelled}` immediately for parity, guarded.

### `@anubis/conversation`
- **`conversations/task-manager.ts`** — cover the `building` window.
  - Add `cancelledWhileBuilding: Set<string>`.
  - `kill(id)`: if a task exists → cancel it (as today). If the id is only in
    `building` → record it in the set so the build's continuation tears down; no
    longer a silent no-op.
  - In `getOrBuild`'s build IIFE, after `streamAgent` resolves: if the id is in the
    set → call `cancelRun()` + `killProcessTree` + emit a terminal event, do **not**
    register a running task, and clear the set entry.
- **`conversations/conversation-service.ts` `cancel()`** — guarantee a terminal.
  After `tm.kill`, if the conversation status is still `pending`/`running`, set it to
  `finished` and publish a synthetic `done` SSE via the broadcaster so an active or
  reconnecting client clears. Idempotent with the relay's own `done`. (Replaces the
  current unconditional `status = 'error'`, which mislabels a user stop and paints
  the UI red.)

### `@anubis/frontend`
- **`pages/active-conversation.tsx` `onStop`** — set `forceStopped` immediately on
  click (instead of after the 3s timer) so the streaming spinner/indicators clear at
  once; still call `cancelConversation`. Remove the now-unnecessary 3s cosmetic timer
  (the backend guarantees the `done`). The button stays "Stop" with the square icon —
  it is now a true kill switch.

## Status semantics

A killed turn settles as **`finished`**, preserving whatever partial assistant text
streamed, surfaced as a clean stop. We deliberately do **not** mark it `error`
(misleading for a user-initiated stop) and do **not** add a new `cancelled` enum value
(would touch the status enum + repo + UI in several places for little user benefit).

## Testing

- **`ai-agent/tests/agents/process-tree.test.ts`** — `killProcessTree`: on win32
  (mocked platform + spawn) invokes `taskkill /pid <pid> /T /F`; on posix invokes
  `process.kill(pid, 'SIGKILL')`; no-op when pid is undefined; swallows spawn/kill
  errors (incl. ESRCH).
- **`ai-agent/tests/agents/claude/cancel.test.ts`** (or extend existing runner tests)
  — `cancel()` triggers `killProcessTree(child.pid)` and emits `done{cancelled}`
  immediately without waiting for `close`; the `terminalEmitted` guard prevents a
  double terminal when `close` later fires.
- **`conversation/tests/conversations/task-manager.test.ts`** — kill during the
  building window: with a slow `streamAgent`, `kill(id)` causes the run's `cancel` to
  be invoked, no running task is registered, and a terminal is emitted. Kill of a
  live running task still calls `cancel` and removes the task.
- **`conversation/tests/conversations/conversation-service.test.ts`** — `cancel()`
  guarantees a terminal: when `tm.kill` leaves the status non-terminal (no relay
  attached), `cancel` sets `finished` and publishes a `done` SSE; when a relay handled
  it, no scary `error` is produced.

## Out of scope

- Sidebar / conversation-list kill affordance (active conversation only, per scope).
- Auto-hang detection / watchdog beyond the existing idle scan.
- A new `cancelled` conversation status.
- Changing the spawn model to detached process groups.
```
