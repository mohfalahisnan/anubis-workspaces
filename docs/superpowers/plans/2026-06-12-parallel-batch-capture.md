# Parallel Batch Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture all profiles in a batch chunk in parallel (8 simultaneous Chrome tabs) with a short 20–40 s cooldown between bursts, instead of one profile at a time — making large competitor captures far faster.

**Architecture:** `runBatchCapture`'s inner chunk loop becomes a parallel `Promise.all` burst over the chunk (width 8 = chunk size). The batch executor launches Chrome once, passes `keepChromeOpen` to every capture, and kills it once in a `finally` so the parallel captures don't race to spawn/kill it. The `BrowserManager` default tab cap rises 4→8 so a full burst runs on the shared multiplexed socket.

**Tech Stack:** TypeScript (ESM). Backend tests: **vitest** (`pnpm vitest run <path>` from repo root). research-crawler tests: `node:test` via `node --import tsx --test`. Node ≥ 22.

**Reference spec:** `docs/superpowers/specs/2026-06-12-parallel-batch-capture-design.md`.

**Critical build note:** `capture-batch.ts` imports the chunk/delay constants from `@anubis/shared`, and vitest resolves `@anubis/*` to each package's **dist**. After editing `packages/shared/src/index.ts` you MUST run `pnpm --filter @anubis/shared build` before backend tests observe the new values. (Backend's own `src` is transformed on the fly by vitest — no backend build needed.)

---

## File Structure

```
packages/shared/src/index.ts                         # MODIFY — retune CAPTURE_CHUNK_DELAY_MIN/MAX_MS
packages/research-crawler/src/core/browser/browser-manager.ts  # MODIFY — default maxConcurrentTabs 4 → 8
packages/research-crawler/tests/browser/browser-manager.test.ts # MODIFY — add default-cap test
packages/backend/src/capture-batch.ts                # MODIFY — parallel burst over each chunk
packages/backend/tests/capture-batch.test.ts         # MODIFY — parallel-aware assertions + concurrency test
packages/backend/src/captures.ts                     # MODIFY — launch Chrome once / keepChromeOpen / kill once
```

---

## Task 1: Retune the inter-chunk cooldown constants

The cooldown drops from 2–5 min to 20–40 s. The existing `pickChunkDelayMs` tests compare against the constants themselves, so they keep passing; this task just changes the values and confirms the suite is green.

**Files:**
- Modify: `packages/shared/src/index.ts:1084-1086`

- [ ] **Step 1: Change the constants**

In `packages/shared/src/index.ts`, replace:

```ts
export const CAPTURE_CHUNK_DELAY_MIN_MS = 2 * 60_000
```
```ts
export const CAPTURE_CHUNK_DELAY_MAX_MS = 5 * 60_000
```

with:

```ts
export const CAPTURE_CHUNK_DELAY_MIN_MS = 20_000
```
```ts
export const CAPTURE_CHUNK_DELAY_MAX_MS = 40_000
```

(Leave `CAPTURE_CHUNK_SIZE = 8` unchanged.)

- [ ] **Step 2: Rebuild shared and run the batch tests**

Run (from repo root):
```
pnpm --filter @anubis/shared build && pnpm vitest run packages/backend/tests/capture-batch.test.ts
```
Expected: PASS — all existing `capture-batch` tests still pass (they assert relative to the constants, not absolute ms).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): shorten capture inter-chunk cooldown to 20-40s for parallel bursts"
```

---

## Task 2: Raise BrowserManager default tab cap to 8

A full burst of 8 must run simultaneously on the shared socket. The default `maxConcurrentTabs` rises 4→8 (callers that pass an explicit value are unaffected).

**Files:**
- Modify: `packages/research-crawler/src/core/browser/browser-manager.ts`
- Modify: `packages/research-crawler/tests/browser/browser-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test to `packages/research-crawler/tests/browser/browser-manager.test.ts` (the file's `fakeFetch` / `scriptedConnection` helpers are already defined at the top — reuse them):

```ts
test('default maxConcurrentTabs allows a full burst of 8 tabs at once', async () => {
  let active = 0
  let peak = 0
  const manager = await createBrowserManager({
    chromeOrigin: 'http://127.0.0.1:9222',
    fetchImpl: fakeFetch(),
    connect: async () => scriptedConnection(),
    // maxConcurrentTabs intentionally omitted → exercises the default
  })
  await Promise.all(Array.from({ length: 8 }, () =>
    manager.withTab({ url: 'https://example.com/' }, async () => {
      active++; peak = Math.max(peak, active); await delay(5); active--
    })))
  assert.equal(peak, 8)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/research-crawler`): `node --import tsx --test tests/browser/browser-manager.test.ts`
Expected: FAIL — `peak` is 4 (the old default), not 8.

- [ ] **Step 3: Change the default**

In `packages/research-crawler/src/core/browser/browser-manager.ts`, change:

```ts
  const semaphore = createSemaphore(options.maxConcurrentTabs ?? 4)
```
to:
```ts
  const semaphore = createSemaphore(options.maxConcurrentTabs ?? 8)
```

Also update the JSDoc on `maxConcurrentTabs` in `BrowserManagerOptions` from `(default 4)` to `(default 8)`.

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/research-crawler`): `node --import tsx --test tests/browser/browser-manager.test.ts`
Expected: PASS — all browser-manager tests pass, including the new burst test (`peak === 8`).

- [ ] **Step 5: Commit**

```bash
git add packages/research-crawler/src/core/browser/browser-manager.ts packages/research-crawler/tests/browser/browser-manager.test.ts
git commit -m "feat(research-crawler): default BrowserManager tab cap 4 to 8 for capture bursts"
```

---

## Task 3: Parallelize the chunk burst in runBatchCapture

Replace the sequential inner loop with a `Promise.all` burst. Per-profile try/catch (failure isolation) and progress reporting move inside the per-target async callback. The outer chunk loop's between-chunk abort check and cooldown are unchanged, preserving the "never stop mid-burst; in-flight burst always finishes" guarantee.

**Files:**
- Modify: `packages/backend/src/capture-batch.ts:138-192`
- Modify: `packages/backend/tests/capture-batch.test.ts`

- [ ] **Step 1: Update the one sequential-only assertion and add a concurrency test**

In `packages/backend/tests/capture-batch.test.ts`, in the test `'captures every profile, aggregates counts, and reports chunk/profile progress'`, replace this line:

```ts
    expect(progress.some((p) => p.currentHandle === '@user0')).toBe(true)
```

with (during a parallel burst there is no single "current" handle; assert the burst-start progress carried the chunk framing instead):

```ts
    expect(progress.some((p) => p.status === 'capturing' && p.chunkIndex === 1)).toBe(true)
```

Then add this new test inside the `describe('runBatchCapture', ...)` block:

```ts
  it('captures a chunk concurrently (all calls start before any finishes)', async () => {
    let started = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let maxConcurrentStarted = 0

    const run = runBatchCapture({
      competitors: targets(4), // chunkSize 4 → one burst of 4
      signal: new AbortController().signal,
      captureOne: async () => {
        started++
        maxConcurrentStarted = Math.max(maxConcurrentStarted, started)
        await gate // block until all 4 have started
        return { candidateCount: 1 }
      },
      reportProgress: () => {},
      reportWarning: () => {},
      sleep: async () => {},
      random: () => 0,
      chunkSize: 4,
      delayMinMs: 0,
      delayMaxMs: 0,
    })

    // Let the 4 callbacks reach the gate, then release them all.
    await new Promise((r) => setTimeout(r, 5))
    expect(maxConcurrentStarted).toBe(4) // all 4 in flight at once → parallel
    release()

    const res = await run
    expect(res.profilesCompleted).toBe(4)
    expect(res.candidateCount).toBe(4)
  })
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run (from repo root): `pnpm vitest run packages/backend/tests/capture-batch.test.ts`
Expected: FAIL — the concurrency test sees `maxConcurrentStarted === 1` (sequential loop starts one at a time and blocks on the gate).

- [ ] **Step 3: Implement the parallel burst**

In `packages/backend/src/capture-batch.ts`, replace the inner `for (const target of chunkTargets) { ... }` block (the whole loop body currently spanning roughly lines 142–175) with a burst. The new chunk body, inside `for (let ci = 0; ci < chunks.length; ci++) { ... }`, becomes:

```ts
  for (let ci = 0; ci < chunks.length; ci++) {
    if (signal.aborted) break
    const chunkTargets = chunks[ci]!

    // Burst start: no single "current" profile — the whole chunk runs at once.
    reportProgress({
      status: 'capturing',
      chunkIndex: ci + 1,
      totalChunks: chunks.length,
      profilesCompleted,
      totalProfiles,
      current: profilesCompleted,
      total: totalProfiles,
      currentHandle: undefined,
      delaySecondsRemaining: undefined,
    })

    // Capture the whole chunk in parallel. Each capture's failure is isolated
    // (caught here, recorded, never rejects the burst). Counter mutations are
    // safe: Node is single-threaded, so each `++`/`push` runs atomically between
    // awaits.
    await Promise.all(chunkTargets.map(async (target) => {
      try {
        const res = await captureOne(target)
        candidateCount += res.candidateCount
        for (const w of res.warnings ?? []) reportWarning(w)
        perCompetitor.push({ handle: target.handle, candidateCount: res.candidateCount, ok: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportWarning(`${target.handle}: ${message}`)
        perCompetitor.push({ handle: target.handle, candidateCount: 0, ok: false, error: message })
      }

      profilesCompleted++
      reportProgress({
        profilesCompleted,
        current: profilesCompleted,
        total: totalProfiles,
        currentHandle: undefined,
      })
    }))

    const isLastChunk = ci === chunks.length - 1
    if (!isLastChunk && !signal.aborted) {
      const delayMs = pickChunkDelayMs(random, delayMinMs, delayMaxMs)
      await countdownDelay(delayMs, {
        sleep,
        signal,
        reportProgress,
        base: {
          chunkIndex: ci + 1,
          totalChunks: chunks.length,
          profilesCompleted,
          totalProfiles,
        },
      })
    }
  }
```

(Only the inner loop changes — keep the function's preamble at lines 106–136 and the `return { ... }` at the end exactly as they are. The `countdownDelay` helper is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run (from repo root): `pnpm vitest run packages/backend/tests/capture-batch.test.ts`
Expected: PASS — all `capture-batch` tests pass, including the new concurrency test. (The stop/cooldown/failure tests still hold: chunk-internal `map` invokes `captureOne` in order, so `order` arrays stay deterministic; aborts are still only honored between chunks.)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/capture-batch.ts packages/backend/tests/capture-batch.test.ts
git commit -m "feat(backend): capture each batch chunk in parallel (8-wide burst)"
```

---

## Task 4: Launch Chrome once per batch run (parallel-safe lifecycle)

Parallel captures must not each spawn/kill Chrome. The batch executor brings Chrome up once before the run, marks every capture `keepChromeOpen: true`, and kills Chrome once in a `finally` — but only if this run spawned it (leave a pre-existing Chrome alone).

This task is integration orchestration over real `launchChrome`/`killChrome`/`captureInstagramData` (no injection seam exists, and adding one is out of scope). It is verified by typecheck + the existing backend suite rather than a new unit test.

**Files:**
- Modify: `packages/backend/src/captures.ts`

- [ ] **Step 1: Import the Chrome lifecycle helpers**

In `packages/backend/src/captures.ts`, extend the `@anubis/research-crawler` import (currently lines 4–11) to add `launchChrome` and `killChrome`:

```ts
import {
  calculateAvgLikesSummary,
  captureInstagramData,
  launchChrome,
  killChrome,
  silentReporter,
  type PostData,
  type ProfileData,
  type StandardCrawlerOutput,
} from '@anubis/research-crawler'
```

- [ ] **Step 2: Thread `keepChromeOpen` through the per-competitor capture**

Define an internal options type and use it in `crawlCompetitorPosts` and `captureAndRefreshStats` so the batch can request Chrome stay open. In `packages/backend/src/captures.ts`:

Add this type just after `type CaptureOptions = z.infer<typeof CaptureBody>` (line 54):

```ts
/** Internal capture options: CaptureOptions plus batch-only Chrome reuse flag. */
type InternalCaptureOptions = CaptureOptions & { keepChromeOpen?: boolean }
```

Change `crawlCompetitorPosts`'s signature parameter type from `body: CaptureOptions` to `body: InternalCaptureOptions`, and add `keepChromeOpen` to its `captureInstagramData` call. The call (currently lines 274–283) becomes:

```ts
  const result = await captureInstagramData(withCrawlerProfileDefaults({
    username: usernameNoAt,
    profile: selectedProfile,
    chromePath: cfg.chromePath,
    headless: body.headless,
    forceHeadless: body.forceHeadless,
    maxResponses: targetPosts,
    timeoutMs: body.timeoutMs ?? 90_000,
    ...(body.keepChromeOpen ? { keepChromeOpen: true } : {}),
    reporter,
  }, selectedProfile, cfg, getDataDir()))
```

Change `captureAndRefreshStats`'s `body: CaptureOptions` parameter type to `body: InternalCaptureOptions` as well (it forwards to `crawlCompetitorPosts`).

- [ ] **Step 3: Wrap the batch executor in a launch-once / kill-once Chrome lifecycle**

In the `POST /competitors/batch` handler, replace the `runJob` executor (currently the arrow at lines 124–143, `(ctx) => runBatchCapture({ ... })`) with an async executor that owns Chrome:

```ts
    async (ctx) => {
      const cfg = getStack().appConfig.get()
      const selectedProfile = captureOpts.profile ?? 'public'
      // Bring Chrome up once for the whole run so the parallel captures reuse
      // a single instance instead of racing to spawn/kill it.
      const launched = await launchChrome(withCrawlerProfileDefaults({
        profile: selectedProfile,
        chromePath: cfg.chromePath,
        headless: captureOpts.headless,
        forceHeadless: captureOpts.forceHeadless,
      }, selectedProfile, cfg, getDataDir()))
      try {
        return await runBatchCapture({
          competitors: targets,
          signal: ctx.signal,
          // Per-profile crawler progress is silenced so the batch orchestrator
          // owns the job's progress (chunk/profile counters, not scroll counts).
          captureOne: async (target) => {
            const { candidates, warnings } = await captureAndRefreshStats(
              target.id,
              { ...captureOpts, keepChromeOpen: true },
              silentReporter(),
            )
            // Stream the actual posts into the per-job store; report only the
            // count up to the orchestrator (the result payload carries counts).
            appendBatchCandidates(jobId, candidates)
            return { candidateCount: candidates.length, warnings }
          },
          reportProgress: ctx.setProgress,
          reportWarning: ctx.warn,
        })
      } finally {
        // Only tear down Chrome if this run spawned it; leave a pre-existing one.
        if (!launched.reused) {
          await killChrome(launched.remoteDebuggingPort).catch(() => {})
        }
      }
    },
```

- [ ] **Step 4: Typecheck the backend**

Run (from repo root): `pnpm --filter @anubis/backend typecheck`
Expected: PASS — no type errors. (`InternalCaptureOptions` flows through `captureAndRefreshStats` → `crawlCompetitorPosts`; `launchChrome`/`killChrome` are exported by `@anubis/research-crawler`.)

- [ ] **Step 5: Run the backend capture + routing tests**

Run (from repo root):
```
pnpm vitest run packages/backend/tests/capture-batch.test.ts packages/backend/tests/capture-batch-route.test.ts packages/backend/tests/capture-stats-refresh.test.ts
```
Expected: PASS — batch orchestration, route shadowing, and stats-refresh tests all green (the lifecycle change is orchestration around the unchanged capture functions).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/captures.ts
git commit -m "feat(backend): launch Chrome once per batch run so parallel captures reuse it"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Rebuild shared (constants) and run the full backend suite**

Run (from repo root):
```
pnpm --filter @anubis/shared build && pnpm vitest run packages/backend/tests --maxWorkers=2
```
Expected: PASS. (`--maxWorkers=2` avoids the known worker-contention flakiness on the full backend suite.)

- [ ] **Step 2: Run the research-crawler browser suite**

Run (from `packages/research-crawler`): `node --import tsx --test tests/browser/*.test.ts`
Expected: PASS — all browser tests pass, including the new default-cap burst test.

- [ ] **Step 3: Typecheck the touched packages**

Run (from repo root):
```
pnpm --filter @anubis/shared typecheck && pnpm --filter @anubis/research-crawler typecheck && pnpm --filter @anubis/backend typecheck
```
Expected: PASS — no type errors across the three packages.

---

## Definition of Done

- A batch capture runs each chunk of 8 competitors as a single parallel burst, with a 20–40 s cooldown between bursts.
- Chrome is launched once per run and reused by all parallel captures; it is killed once at the end only if the run spawned it.
- `BrowserManager` permits 8 concurrent tabs by default; the burst is not throttled to 4.
- `runBatchCapture` preserves failure isolation and the "abort only between chunks; in-flight burst always finishes" guarantee.
- Backend + research-crawler suites and typechecks are green.

## Out of scope (per spec)

- Frontend progress redesign (per-profile in-flight list) — the `JobProgress` shape is reused, only the meaning of `currentHandle` softens during a burst.
- Adaptive captcha/throttle backoff.
- Instagram native `Tab` rewrite and migrating Qwen/Flow/discovery/login-detector off `connectCdpSession`.
