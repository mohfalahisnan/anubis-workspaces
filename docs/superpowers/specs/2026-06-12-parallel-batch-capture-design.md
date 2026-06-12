# Parallel Batch Capture — Design

**Date:** 2026-06-12
**Status:** Approved (design); pending spec review → writing-plans
**Scope:** `packages/backend` (capture orchestration), `packages/shared` (tuning constants), `packages/research-crawler` (manager concurrency default)

## Goal

Make the chunked competitor-capture run capture all profiles in a chunk **in parallel** (one Chrome tab each, simultaneously) instead of one-at-a-time, so a batch finishes far faster. This is the Phase-3 payoff of the BrowserManager work: the transport already multiplexes parallel tabs over one socket; this change drives it from the batch orchestrator.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Parallel width per burst | **Whole chunk at once = 8** profiles simultaneously. |
| 2 | Inter-chunk cooldown | **Shorter: random 20–40 s** between bursts (was 2–5 min). |
| 3 | Manager concurrency cap | Bump `BrowserManager` default `maxConcurrentTabs` **4 → 8** (matches chunk width) rather than threading a per-batch value. |
| 4 | Progress during a burst | `currentHandle` is `undefined` during a parallel burst (no single "current" profile); the UI shows progress via `profilesCompleted`/`total`, incremented as each capture finishes. |
| 5 | Stop semantics | Unchanged — abort checked **between** chunks; an in-flight burst always finishes and stays persisted. |

**Accepted tradeoff:** 8 simultaneous Instagram page loads from one logged-in session + 20–40 s gaps is a stronger bot signal than the old sequential+long-cooldown design. Expect occasional captcha/throttle on large selections. Cap and cooldown stay configurable so they can be dialed back.

## Current behavior (what changes)

`runBatchCapture` (`packages/backend/src/capture-batch.ts`) splits the selection into chunks of `CAPTURE_CHUNK_SIZE` (8) and, **within each chunk, captures sequentially**:

```ts
for (const target of chunkTargets) { await captureOne(target) }
```

Between chunks it waits a randomized cooldown (`CAPTURE_CHUNK_DELAY_MIN_MS`..`MAX`, currently 2–5 min). `captureOne` → `captureAndRefreshStats` → `crawlCompetitorPosts` → `captureInstagramData`, and **each `captureInstagramData` call runs its own `launchChrome` at the start and `killChrome` at the end** (unless `reused`/`keepChromeOpen`).

## Design

### 1. Parallel burst (capture-batch.ts)

Replace the sequential inner loop with a concurrent burst over the chunk:

```ts
await Promise.all(chunkTargets.map((target) => captureOneTracked(target)))
```

- `captureOneTracked` wraps the existing per-target try/catch (so one profile failing marks only that profile failed and never rejects the burst) and increments `profilesCompleted` + reports progress **when that profile finishes**.
- The chunk size (8) is the parallel width. The inter-chunk cooldown is retained between bursts.

### 2. Tuning constants (@anubis/shared)

```ts
export const CAPTURE_CHUNK_SIZE = 8                 // unchanged
export const CAPTURE_CHUNK_DELAY_MIN_MS = 20_000    // was 2 * 60_000
export const CAPTURE_CHUNK_DELAY_MAX_MS = 40_000    // was 5 * 60_000
```

These are re-exported by `capture-batch.ts` and consumed by the frontend hint text, so both stay in lockstep.

### 3. Parallel-safe Chrome lifecycle (captures.ts)

The batch executor (the `runJob` callback in `POST /captures/competitors/batch`) owns Chrome's lifetime so parallel captures don't race to spawn/kill it:

1. **Before** `runBatchCapture`: `await launchChrome({ profile, … })` once to bring Chrome up on the resolved profile/port (idempotent reuse if already running).
2. Pass **`keepChromeOpen: true`** into the capture options so each `captureInstagramData` reuses the live Chrome and never kills it.
3. **After** `runBatchCapture` (in a `finally`): `await killChrome(port)` once — unless the resolved Chrome was already running before the batch (reuse), in which case leave it.

`CaptureOptions` gains an optional `keepChromeOpen?: boolean` plumbed through `crawlCompetitorPosts` → `captureInstagramData`.

### 4. Manager concurrency default (research-crawler)

`BrowserManager` default `maxConcurrentTabs`: **4 → 8**. Phase 2 routes every `captureInstagramData` through one registry-cached manager per Chrome origin; the manager's semaphore caps simultaneous tabs. Raising the default to 8 lets a full burst run at once. (ChatGPT/single-profile flows open one tab and are unaffected.)

### 5. Progress & stop

- At burst start: report `status: 'capturing'`, `chunkIndex`, `totalChunks`, with `currentHandle: undefined` (the burst is N-at-once, so there is no single current profile).
- Each capture's completion concurrently increments `profilesCompleted` and reports `current/total`. Concurrent `reportProgress` calls are last-writer-wins on counts; `profilesCompleted` is incremented from a single shared counter inside the tracked wrapper to avoid lost updates.
- Stop: abort is checked **between** chunks (and during the cooldown countdown), never mid-burst. An in-flight burst's `Promise.all` always settles before the run winds down, so all its captured posts stay persisted — same guarantee as today.

## Error handling

- Per-profile failure: caught inside `captureOneTracked`, recorded as `{ ok: false, error }` in `perCompetitor`, surfaced via `reportWarning`; the burst continues.
- Chrome launch failure up front: the job fails fast with the `launchChrome` error (before any capture).
- `killChrome` in `finally` is best-effort; failure there is logged, not fatal.

## Testing

- `capture-batch` unit tests already inject `captureOne`/`sleep`/`random`. Add:
  - **Concurrency:** with a `captureOne` that blocks on a manual gate, assert all `chunkSize` calls have *started* before any resolves (proves the burst is parallel, not sequential).
  - **Progress:** `profilesCompleted` reaches `totalProfiles` with no lost increments across concurrent completions.
  - **Stop:** aborting between chunks still lets the in-flight burst finish and preserves its results; no new chunk starts.
  - **Failure isolation:** one `captureOne` throwing marks only that profile failed; the rest of the burst completes.
- `BrowserManager`: existing semaphore test updated/added to assert the new default cap (8) when `maxConcurrentTabs` is omitted.

## Out of scope

- Frontend progress redesign (per-profile in-flight list). The existing `JobProgress` shape is reused; only the meaning of `currentHandle` softens during a burst.
- Instagram native `Tab` rewrite and migrating Qwen/Flow/discovery/login-detector off `connectCdpSession` (still later Phase-3 items).
- Adaptive/auto-backoff on captcha detection (could be a follow-up if throttling proves common).
