# Capture posts: stats-only auto-save + select-to-save — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the batch Capture Posts flow refresh competitor profile stats (bio/displayName/followers/avgLikes) on capture without persisting posts; surface captured posts as selectable candidates that stream in per-profile and are saved to Content only on explicit selection.

**Architecture:** A new backend helper `refreshCompetitorStats` updates stats and returns candidate posts without persisting. The batch route captures per competitor, appends candidates to an in-memory per-job store, and the results panel polls a new `GET /captures/competitors/batch/:jobId/candidates` endpoint. Saving uses the existing `/posts/import` route, which is changed to update `postCount` only (capture now owns `avgLikes`). The preview path (Content page) is repointed to `refreshCompetitorStats` so its avgLikes keeps working.

**Tech Stack:** Hono (backend routes), Node `better-sqlite3` stack, Vitest, React 19 + Vite (frontend), `@anubis/shared` types.

**Spec:** `docs/superpowers/specs/2026-06-11-capture-stats-only-select-to-save-design.md`

---

## File structure

- `packages/backend/src/captures.ts` — add `crawlCompetitorPosts`, `refreshCompetitorStats`, `captureAndRefreshStats`; rewrite batch `captureOne`, preview block, `refreshCompetitorPostStats`; add candidates GET route.
- `packages/backend/src/capture-candidates.ts` — **new**: per-job in-memory candidate store + job-removal cleanup.
- `packages/backend/src/capture-batch.ts` — `captureOne` returns candidates; orchestrator aggregates them.
- `packages/shared/src/index.ts` — `BatchCaptureJobResult` + `BatchCaptureOutcome` gain candidates / rename `capturedCount` → `candidateCount`.
- `packages/frontend/src/components/jobs/top-nav-progress.tsx` — use `candidateCount`.
- `packages/frontend/src/api.ts` — add `listBatchCandidates`.
- `packages/frontend/src/pages/capture-posts.tsx` — rewrite `CaptureResults` for poll + selection + save.
- Tests: `packages/backend/tests/capture-stats-refresh.test.ts` (new), `packages/backend/tests/capture-batch.test.ts` (update), `packages/frontend/tests/pages/capture-posts-select-save.test.tsx` (new).

**Build-order note (load-bearing):** `@anubis/shared` is consumed by both backend and frontend as **built dist** (vitest resolves `@anubis/*` to `dist`). After any edit to `packages/shared/src/index.ts`, run `pnpm --filter @anubis/shared build` **before** running backend or frontend tests/typecheck that rely on the new shape. Each task below includes the build step where needed.

---

## Task 1: Backend helper — `refreshCompetitorStats` (stats-only, returns candidates)

**Files:**
- Modify: `packages/backend/src/captures.ts`
- Test: `packages/backend/tests/capture-stats-refresh.test.ts` (create)

This adds new helpers without changing any route behavior yet. `crawlCompetitorPosts` is extracted so `runCapture` (unchanged behavior) and the new `captureAndRefreshStats` share the crawl block (DRY).

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/capture-stats-refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StandardCrawlerOutput } from '@anubis/research-crawler'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-stats-refresh-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* best-effort */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

function fakeResult(username: string): StandardCrawlerOutput {
  return {
    ok: true,
    schemaVersion: 1,
    output: {
      profiles: [{ username, fullName: 'Real Name', bio: 'real bio', followers: 1234, avgLikes: 50 }],
      posts: [
        { platform: 'instagram', postUrl: `https://www.instagram.com/p/aaa/`, username, likes: 100, comments: 5 },
        { platform: 'instagram', postUrl: `https://www.instagram.com/p/bbb/`, username, likes: 120, comments: 7 },
      ],
    },
    meta: { warnings: [], avgLikes: { perProfile: [{ username, avgLikes: 110, sampleSize: 2 }] } },
  } as unknown as StandardCrawlerOutput
}

describe('refreshCompetitorStats', () => {
  it('updates profile stats and returns candidates WITHOUT persisting any post', async () => {
    const { __testing } = await import('../src/captures.js')
    const { getStack } = await import('../src/services.js')
    const stack = getStack()

    const competitor = stack.competitors.create({ handle: '@statsme', projectId: 'default' })

    const refreshed = __testing.refreshCompetitorStats(competitor.id, fakeResult('statsme'), 12)

    // Stats updated from the crawl result.
    const updated = stack.competitors.get(competitor.id)!
    expect(updated.bio).toBe('real bio')
    expect(updated.followers).toBe(1234)
    expect(updated.avgLikes).toBe(110)
    expect(updated.lastRefreshedAt).toBeGreaterThan(0)

    // Candidates returned, enriched, raw stripped.
    expect(refreshed.candidates).toHaveLength(2)
    expect(refreshed.candidates[0]!.competitorHandle).toBe('@statsme')
    expect('raw' in (refreshed.candidates[0] as Record<string, unknown>)).toBe(false)

    // NOTHING persisted to captured_posts, and postCount untouched.
    expect(stack.capturedPosts.countForCompetitor(competitor.id)).toBe(0)
    expect(updated.postCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/shared build && pnpm vitest run packages/backend/tests/capture-stats-refresh.test.ts --maxWorkers=2`
Expected: FAIL — `__testing.refreshCompetitorStats` is undefined (not yet exported).

- [ ] **Step 3: Extract `crawlCompetitorPosts` and refactor `runCapture` to use it**

In `packages/backend/src/captures.ts`, replace the body of `runCapture` (the function starting `async function runCapture(`) so the crawl is extracted into a shared helper. Replace:

```ts
async function runCapture(
  competitorId: string,
  body: CaptureOptions,
  reporter: ProgressReporter,
): Promise<PersistedCapture> {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) throw new Error('Competitor not found.')

  const usernameNoAt = competitor.handle.replace(/^@/, '')
  const selectedProfile = body.profile ?? 'public'
  const cfg = stack.appConfig.get()
  const targetPosts = body.targetPosts ?? body.maxResponses ?? 30

  const result = await captureInstagramData(withCrawlerProfileDefaults({
    username: usernameNoAt,
    profile: selectedProfile,
    chromePath: cfg.chromePath,
    headless: body.headless,
    forceHeadless: body.forceHeadless,
    maxResponses: targetPosts,
    timeoutMs: body.timeoutMs ?? 90_000,
    reporter,
  }, selectedProfile, cfg, getDataDir()))

  if (!result.ok) {
    throw new Error(result.error?.message ?? 'Capture failed.')
  }

  return persistCaptureResult(competitorId, result, targetPosts)
}
```

with:

```ts
/**
 * Run the crawler for one competitor and return the validated output.
 * Shared by the (legacy) persisting path and the stats-only refresh path.
 * Throws on a crawler-level failure so callers/jobs record the error.
 */
async function crawlCompetitorPosts(
  competitorId: string,
  body: CaptureOptions,
  reporter: ProgressReporter,
): Promise<{ result: StandardCrawlerOutput; targetPosts: number }> {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) throw new Error('Competitor not found.')

  const usernameNoAt = competitor.handle.replace(/^@/, '')
  const selectedProfile = body.profile ?? 'public'
  const cfg = stack.appConfig.get()
  const targetPosts = body.targetPosts ?? body.maxResponses ?? 30

  const result = await captureInstagramData(withCrawlerProfileDefaults({
    username: usernameNoAt,
    profile: selectedProfile,
    chromePath: cfg.chromePath,
    headless: body.headless,
    forceHeadless: body.forceHeadless,
    maxResponses: targetPosts,
    timeoutMs: body.timeoutMs ?? 90_000,
    reporter,
  }, selectedProfile, cfg, getDataDir()))

  if (!result.ok) throw new Error(result.error?.message ?? 'Capture failed.')
  return { result, targetPosts }
}

async function runCapture(
  competitorId: string,
  body: CaptureOptions,
  reporter: ProgressReporter,
): Promise<PersistedCapture> {
  const { result, targetPosts } = await crawlCompetitorPosts(competitorId, body, reporter)
  return persistCaptureResult(competitorId, result, targetPosts)
}

/**
 * Capture one competitor, refresh its profile stats (bio/displayName/followers/
 * avgLikes) WITHOUT persisting posts, and return the candidate posts for the
 * caller to surface for selection.
 */
async function captureAndRefreshStats(
  competitorId: string,
  body: CaptureOptions,
  reporter: ProgressReporter,
): Promise<{ candidates: CapturedPostSummary[]; warnings: string[] }> {
  const { result, targetPosts } = await crawlCompetitorPosts(competitorId, body, reporter)
  const refreshed = refreshCompetitorStats(competitorId, result, targetPosts)
  return { candidates: refreshed.candidates, warnings: refreshed.warnings }
}
```

- [ ] **Step 4: Add `refreshCompetitorStats` next to `persistCaptureResult`**

In `packages/backend/src/captures.ts`, immediately AFTER the `persistCaptureResult` function (after its closing `}`), add:

```ts
interface StatsRefresh {
  competitor: NonNullable<ReturnType<ReturnType<typeof getStack>['competitors']['get']>>
  candidates: CapturedPostSummary[]
  warnings: string[]
}

/**
 * Refresh a competitor's profile stats from a crawl result and return the
 * captured posts as candidates — WITHOUT persisting any post. Capture now owns
 * `avgLikes` (computed from the full crawl); `postCount` is left untouched and
 * only changes when the user saves selected posts via `/posts/import`.
 */
function refreshCompetitorStats(
  competitorId: string,
  result: StandardCrawlerOutput,
  targetPosts: number,
): StatsRefresh {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) throw new Error('Competitor not found.')
  const usernameNoAt = competitor.handle.replace(/^@/, '')

  const now = Date.now()
  const posts: CapturedPost[] = uniqueCapturedPosts(result.output.posts
    .filter((p) => Boolean(p.postUrl))
    .slice(0, targetPosts)
    .map((p) => postDataToCapturedPost(competitor.id, usernameNoAt, p, now, competitor.projectId)))

  const profileEntry =
    result.output.profiles.find((p) => p.username === usernameNoAt) ??
    result.output.profiles[0]
  const avgLikesEntry =
    result.meta.avgLikes?.perProfile.find((entry) => entry.username === usernameNoAt) ??
    result.meta.avgLikes?.perProfile[0]
  const avgLikesSummary =
    avgLikesEntry ?? calculateAvgLikesSummary(usernameNoAt, posts.map(capturedPostToPostData))

  stack.competitors.update(competitor.id, {
    displayName: deriveDisplayName(competitor.displayName, profileEntry),
    bio: deriveBio(competitor.bio, profileEntry),
    followers: profileEntry?.followers,
    avgLikes: avgLikesSummary?.avgLikes ?? profileEntry?.avgLikes,
  })
  stack.competitors.markRefreshedAt(competitor.id, now)

  const owner = stack.competitors.get(competitor.id)!
  // Strip `raw` (the full scraped blob) from candidates — the import mapper
  // never sends it and it would bloat the streamed/aggregated payload.
  const candidates: CapturedPostSummary[] = posts.map((post) => {
    const { raw: _raw, ...rest } = post
    return enrichPostForOwner(rest, owner) as CapturedPostSummary
  })

  return { competitor: owner, candidates, warnings: result.meta.warnings }
}
```

- [ ] **Step 5: Add the `CapturedPostSummary` import and a `__testing` export**

In `packages/backend/src/captures.ts`, update the `@anubis/shared` type import (currently `import type { BatchCaptureJobResult, CaptureJobResult } from '@anubis/shared'`) to also pull `CapturedPostSummary`:

```ts
import type { BatchCaptureJobResult, CaptureJobResult, CapturedPostSummary } from '@anubis/shared'
```

Then add a testing hook at the END of the file (so unit tests can call the helper without going through Chrome):

```ts
/** Internal helpers exposed for unit tests only. Not part of the HTTP surface. */
export const __testing = { refreshCompetitorStats }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/capture-stats-refresh.test.ts --maxWorkers=2`
Expected: PASS (2 stats updated, 2 candidates, 0 persisted).

- [ ] **Step 7: Typecheck the backend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit`
Expected: exit 0. (`captureAndRefreshStats` is currently unused — module-level functions don't trip `noUnusedLocals`, so this is fine.)

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/captures.ts packages/backend/tests/capture-stats-refresh.test.ts
git commit -m "feat(backend): refreshCompetitorStats — update stats without persisting posts"
```

---

## Task 2: Backend — per-job candidate store + GET endpoint

**Files:**
- Create: `packages/backend/src/capture-candidates.ts`
- Modify: `packages/backend/src/captures.ts` (add GET route + imports)
- Test: `packages/backend/tests/capture-candidates.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/capture-candidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { CapturedPostSummary } from '@anubis/shared'
import {
  appendBatchCandidates,
  getBatchCandidates,
  clearBatchCandidates,
} from '../src/capture-candidates.js'

function post(id: string): CapturedPostSummary {
  return { id, competitorId: 'c1', username: 'u', postUrl: `https://x/${id}`, capturedAt: 1 }
}

describe('batch candidate store', () => {
  it('appends per job and reads them back, isolated by job id', () => {
    appendBatchCandidates('job-A', [post('a1'), post('a2')])
    appendBatchCandidates('job-A', [post('a3')])
    appendBatchCandidates('job-B', [post('b1')])

    expect(getBatchCandidates('job-A').map((p) => p.id)).toEqual(['a1', 'a2', 'a3'])
    expect(getBatchCandidates('job-B').map((p) => p.id)).toEqual(['b1'])
    expect(getBatchCandidates('unknown')).toEqual([])

    clearBatchCandidates('job-A')
    expect(getBatchCandidates('job-A')).toEqual([])
    expect(getBatchCandidates('job-B').map((p) => p.id)).toEqual(['b1'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/capture-candidates.test.ts --maxWorkers=2`
Expected: FAIL — module `../src/capture-candidates.js` does not exist.

- [ ] **Step 3: Create the store module**

Create `packages/backend/src/capture-candidates.ts`:

```ts
import type { CapturedPostSummary } from '@anubis/shared'
import { jobManager } from './jobs.js'

/* -----------------------------------------------------------
   Live batch-capture candidate store
   -----------------------------------------------------------
   Batch capture no longer persists posts; instead each profile's
   captured posts are appended here, keyed by the batch job id, so
   the results panel can poll them in as the run progresses. The
   final BatchCaptureJobResult also carries the full set for a user
   who returns to a finished job whose store entry was pruned.
   ----------------------------------------------------------- */

const store = new Map<string, CapturedPostSummary[]>()

export function appendBatchCandidates(jobId: string, candidates: CapturedPostSummary[]): void {
  const existing = store.get(jobId)
  if (existing) existing.push(...candidates)
  else store.set(jobId, [...candidates])
}

export function getBatchCandidates(jobId: string): CapturedPostSummary[] {
  return store.get(jobId) ?? []
}

export function clearBatchCandidates(jobId: string): void {
  store.delete(jobId)
}

// Drop a job's candidates when its record is removed (dismiss / prune) so the
// store stays bounded by the job manager's own lifecycle.
jobManager.onChange((event) => {
  if (event.type === 'removed') store.delete(event.id)
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/capture-candidates.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Add the GET endpoint**

In `packages/backend/src/captures.ts`, add imports near the other local imports (after the `runBatchCapture` import line):

```ts
import { appendBatchCandidates, getBatchCandidates } from './capture-candidates.js'
```

Then register the route immediately AFTER the batch POST route (`captureRoutes.post('/competitors/batch', ...)` closing `})`, before the `/competitors/:id` route):

```ts
/**
 * GET /captures/competitors/batch/:jobId/candidates — the captured posts a
 * batch run has surfaced so far (streamed per-profile, served from the live
 * store). The store lives as long as the job record, so a finished-but-not-
 * dismissed job still serves its full set here.
 */
captureRoutes.get('/competitors/batch/:jobId/candidates', (c) => {
  const jobId = c.req.param('jobId')
  const job = jobManager.get(jobId)
  if (!job) return c.json({ ok: false, error: 'not_found' }, 404)
  const running = job.state === 'queued' || job.state === 'running' || job.state === 'stopping'
  return c.json({ ok: true, candidates: getBatchCandidates(jobId), running })
})
```

This endpoint is self-contained (store only) and typechecks independently of Task 3.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/capture-candidates.ts packages/backend/src/captures.ts packages/backend/tests/capture-candidates.test.ts
git commit -m "feat(backend): per-job batch candidate store + candidates endpoint"
```

---

## Task 3: Shared types + orchestrator + batch route — wire candidate counts + streaming

**Files:**
- Modify: `packages/shared/src/index.ts` (`BatchCaptureJobResult`, `BatchCaptureOutcome`)
- Modify: `packages/backend/src/capture-batch.ts` (orchestrator)
- Modify: `packages/backend/tests/capture-batch.test.ts` (update tests)
- Modify: `packages/backend/src/captures.ts` (batch `captureOne` → `captureAndRefreshStats` + append to store)
- Modify: `packages/frontend/src/components/jobs/top-nav-progress.tsx` (`candidateCount`)

The actual candidate posts stream via the per-job store (Task 2) — the route appends them. The job **result** only needs counts, so this is a `capturedCount` → `candidateCount` rename plus the route wiring. Complete all steps before typechecking (the rename ripples).

- [ ] **Step 1: Update the shared types**

In `packages/shared/src/index.ts`, replace the `BatchCaptureOutcome` and `BatchCaptureJobResult` interfaces (rename `capturedCount` → `candidateCount`; no posts array — the candidates themselves are served by the store endpoint):

```ts
/** Per-competitor outcome inside a batch capture run. */
export interface BatchCaptureOutcome {
  handle: string
  /** Candidate posts surfaced for this competitor (not yet saved). */
  candidateCount: number
  ok: boolean
  error?: string
}

/** Result payload for a `capture-posts-batch` job. */
export interface BatchCaptureJobResult {
  /** Profiles queued for the batch. */
  totalProfiles: number
  /** Profiles actually processed (may be < total if the run was stopped). */
  profilesCompleted: number
  /** Total candidate posts surfaced across every processed profile. */
  candidateCount: number
  /** True when the run ended early due to a user stop. */
  stopped: boolean
  /** Per-competitor breakdown, in processing order. */
  perCompetitor: BatchCaptureOutcome[]
}
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @anubis/shared build`
Expected: exit 0.

- [ ] **Step 3: Update the orchestrator**

In `packages/backend/src/capture-batch.ts`:

(a) Change `captureOne`'s type in `RunBatchCaptureDeps` (it now reports a count, not posts — the route appends the actual posts to the store before returning):

```ts
  /** Capture a single competitor's posts. Throwing marks that profile failed. */
  captureOne: (
    target: BatchCaptureTarget,
  ) => Promise<{ candidateCount: number; warnings?: string[] }>
```

(b) In `runBatchCapture`, rename the accumulator `let capturedCount = 0` → `let candidateCount = 0`. Replace the `try { ... } catch { ... }` block (the one calling `captureOne`) with:

```ts
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
```

And replace the final `return { ... }` with:

```ts
  return {
    totalProfiles,
    profilesCompleted,
    candidateCount,
    stopped: signal.aborted,
    perCompetitor,
  }
```

(No `@anubis/shared` import change needed — `CapturedPostSummary` is not used here.)

- [ ] **Step 4: Update the orchestrator tests**

In `packages/backend/tests/capture-batch.test.ts`, the `runBatchCapture` tests change only by renaming the count field. Apply these exact edits:

- `'captures every profile, aggregates counts, and reports chunk/profile progress'`:
  - `captureOne: async (t) => { order.push(t.id); return { capturedCount: 2 } }` → `return { candidateCount: 2 }`
  - assertion `capturedCount: 10` → `candidateCount: 10`
- `'cools down between chunks ...'`:
  - `captureOne: async () => ({ capturedCount: 0 })` → `({ candidateCount: 0 })`
- `'stops between chunks and preserves the already-captured chunk'`:
  - `captureOne: async (t) => { order.push(t.id); ...; return { capturedCount: 1 } }` → `return { candidateCount: 1 }`
  - assertion `res.capturedCount` → `res.candidateCount` (value unchanged: 2)
- `'stops during the inter-chunk cooldown ...'`:
  - `captureOne: async (t) => { order.push(t.id); return { capturedCount: 1 } }` → `return { candidateCount: 1 }`
- `'records a failed profile as a warning and continues the run'`:
  - ok branch `return { capturedCount: 4 }` → `return { candidateCount: 4 }`
  - assertion `res.capturedCount` → `res.candidateCount` (value unchanged: 8)

No new imports or factories needed.

- [ ] **Step 5: Update the batch route to use `captureAndRefreshStats` + append candidates to the store**

In `packages/backend/src/captures.ts`, replace the batch route's job creation (the `const job = jobManager.runJob<BatchCaptureJobResult>( ... )` block and the `return c.json(...)` after it) with:

```ts
  // The executor runs on the next microtask, after `jobId` is assigned below,
  // so candidates can be streamed into the per-job store keyed by this id.
  let jobId = ''
  const job = jobManager.runJob<BatchCaptureJobResult>(
    {
      kind: 'capture-posts-batch',
      label: `Capture · ${targets.length} competitor${targets.length === 1 ? '' : 's'}`,
      projectId,
    },
    (ctx) =>
      runBatchCapture({
        competitors: targets,
        signal: ctx.signal,
        // Per-profile crawler progress is silenced so the batch orchestrator
        // owns the job's progress (chunk/profile counters, not scroll counts).
        captureOne: async (target) => {
          const { candidates, warnings } = await captureAndRefreshStats(
            target.id,
            captureOpts,
            silentReporter(),
          )
          // Stream the actual posts into the per-job store; report only the
          // count up to the orchestrator (the result payload carries counts).
          appendBatchCandidates(jobId, candidates)
          return { candidateCount: candidates.length, warnings }
        },
        reportProgress: ctx.setProgress,
        reportWarning: ctx.warn,
      }),
  )
  jobId = job.id

  return c.json({ ok: true, jobId: job.id })
```

- [ ] **Step 6: Update the frontend top-nav reference**

In `packages/frontend/src/components/jobs/top-nav-progress.tsx`, in `summariseFinished`, the `capture-posts-batch` branch: replace `const posts = result?.capturedCount ?? 0` with `const posts = result?.candidateCount ?? 0` and change the label text from `captured` to `candidate`:

```ts
    const prefix = job.state === 'stopped' ? `Stopped — ${done}/${total} profiles` : `${done} profiles`
    return `${prefix} · ${posts} candidate${posts === 1 ? '' : 's'}`
```

- [ ] **Step 7: Typecheck + run the orchestrator tests**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit && pnpm --filter @anubis/frontend exec tsc --noEmit && pnpm vitest run packages/backend/tests/capture-batch.test.ts --maxWorkers=2`
Expected: both typechecks exit 0; capture-batch tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts packages/backend/src/capture-batch.ts packages/backend/tests/capture-batch.test.ts packages/backend/src/captures.ts packages/frontend/src/components/jobs/top-nav-progress.tsx
git commit -m "feat: batch capture surfaces candidates instead of persisting posts"
```

---

## Task 4: Backend — preview path refreshes stats

**Files:**
- Modify: `packages/backend/src/captures.ts` (preview block in `POST /competitors/:id`)
- Test: `packages/backend/tests/capture-stats-refresh.test.ts` (add a case)

- [ ] **Step 1: Add the failing test case**

In `packages/backend/tests/capture-stats-refresh.test.ts`, add a second `it` inside the existing `describe`:

```ts
  it('captureAndRefreshStats path keeps zero persisted posts (preview parity)', async () => {
    const { __testing } = await import('../src/captures.js')
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    const competitor = stack.competitors.create({ handle: '@previewme', projectId: 'default' })

    const refreshed = __testing.refreshCompetitorStats(competitor.id, fakeResult('previewme'), 12)
    expect(refreshed.candidates).toHaveLength(2)
    expect(stack.competitors.get(competitor.id)!.avgLikes).toBe(110)
    expect(stack.capturedPosts.countForCompetitor(competitor.id)).toBe(0)
  })
```

Run: `pnpm vitest run packages/backend/tests/capture-stats-refresh.test.ts --maxWorkers=2`
Expected: PASS already (helper exists) — this locks in preview parity. (No new code needed for the helper; the route change below is what wires preview to it.)

- [ ] **Step 2: Repoint the preview route block**

In `packages/backend/src/captures.ts`, replace the preview block inside `POST /competitors/:id`:

```ts
  // Preview: build candidate posts without persisting.
  if (body.preview) {
    const now = Date.now()
    const posts = uniqueCapturedPosts(result.output.posts
      .filter((p) => Boolean(p.postUrl))
      .slice(0, targetPosts)
      .map((p) => postDataToCapturedPost(competitor.id, usernameNoAt, p, now, competitor.projectId)))
    return c.json({
      ok: true,
      competitor,
      posts: posts.map((post) => enrichPostForOwner(post, competitor)),
      candidateCount: posts.length,
      warnings: result.meta.warnings,
    })
  }
```

with:

```ts
  // Preview: refresh the competitor's profile stats (bio/followers/avgLikes)
  // and return the captured posts as candidates WITHOUT persisting them.
  if (body.preview) {
    const refreshed = refreshCompetitorStats(competitor.id, result, targetPosts)
    return c.json({
      ok: true,
      competitor: refreshed.competitor,
      posts: refreshed.candidates,
      candidateCount: refreshed.candidates.length,
      warnings: refreshed.warnings,
    })
  }
```

- [ ] **Step 3: Typecheck the backend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit`
Expected: exit 0. (`usernameNoAt`/`now` may now be unused in the synchronous branch — if `tsc` flags an unused local, remove the now-dead `const usernameNoAt`/`now` declarations that were only used by the deleted preview block. The non-preview path below still uses its own locals.)

- [ ] **Step 4: Verify the existing Content preview test still passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/content-capture-preview.test.tsx`
Expected: PASS (response shape `{ competitor, posts, candidateCount, warnings }` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/captures.ts packages/backend/tests/capture-stats-refresh.test.ts
git commit -m "feat(backend): preview capture refreshes competitor stats"
```

---

## Task 5: Backend — `/posts/import` updates postCount only

**Files:**
- Modify: `packages/backend/src/captures.ts` (`refreshCompetitorPostStats`)
- Test: `packages/backend/tests/import-poststats.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/import-poststats.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-import-poststats-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})
afterAll(async () => {
  try { const s = await import('../src/services.js'); await s.shutdownStack() } catch {}
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

describe('POST /posts/import stats', () => {
  it('bumps postCount but leaves capture-owned avgLikes untouched', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()

    const competitor = stack.competitors.create({ handle: '@importme', projectId: 'default' })
    // Capture owns avgLikes — set a value the import must NOT overwrite.
    stack.competitors.update(competitor.id, { avgLikes: 999 })

    const res = await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [
          { competitorId: competitor.id, username: 'importme', postUrl: 'https://www.instagram.com/p/x1/', likes: 10 },
          { competitorId: competitor.id, username: 'importme', postUrl: 'https://www.instagram.com/p/x2/', likes: 20 },
        ],
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, importedCount: 2 })

    const after = stack.competitors.get(competitor.id)!
    expect(after.postCount).toBe(2)     // updated from saved posts
    expect(after.avgLikes).toBe(999)    // capture-owned, NOT recomputed from the subset
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/import-poststats.test.ts --maxWorkers=2`
Expected: FAIL — `after.avgLikes` is the recomputed subset mean (e.g. 15), not 999.

- [ ] **Step 3: Make `refreshCompetitorPostStats` update postCount only**

In `packages/backend/src/captures.ts`, replace the `refreshCompetitorPostStats` function:

```ts
function refreshCompetitorPostStats(competitorId: string) {
  const stack = getStack()
  const competitor = stack.competitors.get(competitorId)
  if (!competitor) return
  // postCount reflects the posts actually saved to Content; avgLikes is owned
  // by capture (refreshCompetitorStats) and is intentionally NOT recomputed
  // from the saved subset, which is a curated selection rather than a sample.
  const count = stack.capturedPosts.countForCompetitor(competitorId)
  stack.competitors.update(competitorId, { postCount: count })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/import-poststats.test.ts --maxWorkers=2`
Expected: PASS (postCount 2, avgLikes 999).

- [ ] **Step 5: Typecheck the backend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit`
Expected: exit 0. (If `calculateAvgLikesSummary` is now unused, it is still used by `refreshCompetitorStats`/`persistCaptureResult`, so the import stays.)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/captures.ts packages/backend/tests/import-poststats.test.ts
git commit -m "feat(backend): /posts/import updates postCount only (capture owns avgLikes)"
```

---

## Task 6: Frontend — `listBatchCandidates` API helper

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Add the helper**

In `packages/frontend/src/api.ts`, add after `captureCompetitorsBatch` (near line 571):

```ts
/**
 * Captured posts a batch run has surfaced so far (streamed per-profile while
 * the job runs; the finished job's full set afterward). The Capture Posts
 * results panel polls this and lets the user select which to save to Content.
 */
export async function listBatchCandidates(
  jobId: string,
): Promise<{ candidates: CapturedPostSummary[]; running: boolean }> {
  const r = await api<{ ok: true; candidates: CapturedPostSummary[]; running: boolean }>(
    `/captures/competitors/batch/${encodeURIComponent(jobId)}/candidates`,
  )
  return { candidates: r.candidates, running: r.running }
}
```

Ensure `CapturedPostSummary` is imported from `@anubis/shared` in `api.ts` (it is already used by `importCapturedPosts`/`listPosts` types — confirm it appears in the `@anubis/shared` import block; if not, add `type CapturedPostSummary` to it).

- [ ] **Step 2: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): listBatchCandidates api helper"
```

---

## Task 7: Frontend — `CaptureResults` poll + selection + save

**Files:**
- Modify: `packages/frontend/src/pages/capture-posts.tsx` (`CaptureResults`, imports, `PostTile`)
- Test: `packages/frontend/tests/pages/capture-posts-select-save.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/pages/capture-posts-select-save.test.tsx` (mirrors the mock pattern in `tests/pages/content-capture-preview.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CapturedPostSummary, JobSummary } from '@anubis/shared'

const mocks = vi.hoisted(() => ({
  listBatchCandidates: vi.fn(),
  importCapturedPosts: vi.fn(),
  listCompetitors: vi.fn(),
  captureCompetitorsBatch: vi.fn(),
  listPosts: vi.fn(),
}))

vi.mock('@/api', () => ({
  listBatchCandidates: mocks.listBatchCandidates,
  importCapturedPosts: mocks.importCapturedPosts,
  listCompetitors: mocks.listCompetitors,
  captureCompetitorsBatch: mocks.captureCompetitorsBatch,
  listPosts: mocks.listPosts,
}))

vi.mock('@/lib/navigation', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }))
vi.mock('@/lib/use-project', () => ({ useProject: () => ({ activeProject: { id: 'default' } }) }))
vi.mock('@/hooks/use-competitor-levels', () => ({
  useCompetitorLevels: () => ({ config: {}, levelFor: () => 'green' }),
}))

const finishedJob: JobSummary = {
  id: 'job-1', kind: 'capture-posts-batch', label: 'Capture', state: 'succeeded',
  progress: { profilesCompleted: 1, totalProfiles: 1 }, warnings: [],
  projectId: 'default', createdAt: 1, startedAt: 1, finishedAt: 2,
  result: { totalProfiles: 1, profilesCompleted: 1, candidateCount: 1, stopped: false, perCompetitor: [], candidates: [] },
} as unknown as JobSummary

vi.mock('@/lib/use-jobs', () => ({
  useJobs: (sel: (s: { jobs: JobSummary[]; stop: () => void }) => unknown) =>
    sel({ jobs: [finishedJob], stop: vi.fn() }),
}))

const candidate: CapturedPostSummary = {
  id: 'p1', competitorId: 'c1', username: 'creator',
  postUrl: 'https://www.instagram.com/p/p1/', caption: 'Hook', likes: 100, comments: 4,
  competitorHandle: '@creator', capturedAt: 1,
}

import { CapturePostsPage } from '@/pages/capture-posts'

describe('CapturePostsPage results — select & save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listCompetitors.mockResolvedValue([])
    mocks.listBatchCandidates.mockResolvedValue({ candidates: [candidate], running: false })
    mocks.importCapturedPosts.mockResolvedValue({ importedCount: 1 })
  })

  it('renders candidates from the job, selects, and saves to Content', async () => {
    render(<CapturePostsPage jobId="job-1" />)

    // Candidate appears from the polled endpoint.
    await waitFor(() => expect(mocks.listBatchCandidates).toHaveBeenCalledWith('job-1'))
    const tile = await screen.findByTestId('candidate-p1')
    fireEvent.click(tile)

    const saveBtn = await screen.findByRole('button', { name: /save 1 to content/i })
    fireEvent.click(saveBtn)

    await waitFor(() =>
      expect(mocks.importCapturedPosts).toHaveBeenCalledWith({
        posts: [expect.objectContaining({ id: 'p1', competitorId: 'c1', postUrl: 'https://www.instagram.com/p/p1/' })],
      }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/capture-posts-select-save.test.tsx`
Expected: FAIL — `listBatchCandidates` not imported/used by the page; no `candidate-p1` testid; no "Save 1 to Content" button.

- [ ] **Step 3: Update imports in `capture-posts.tsx`**

In `packages/frontend/src/pages/capture-posts.tsx`, change the api import line:

```ts
import { captureCompetitorsBatch, listCompetitors, listBatchCandidates, importCapturedPosts } from '@/api'
```

(Remove `listPosts` from this import — it is no longer used by the results panel.)

- [ ] **Step 4: Replace `CaptureResults` and `PostTile`**

In `packages/frontend/src/pages/capture-posts.tsx`, replace the entire `CaptureResults` function AND the `PostTile` function with:

```tsx
/* ---------- Results: poll candidates, select, save ---------- */

function CaptureResults({ job }: { job: JobSummary }) {
  const [candidates, setCandidates] = useState<CapturedPostSummary[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<PostSortKey>>({ key: 'recent', dir: 'desc' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const running = job.state === 'queued' || job.state === 'running' || job.state === 'stopping'

  // Poll the per-job candidate store: live while running, plus a final read on
  // the state transition so the completed set lands even if polling stopped.
  useEffect(() => {
    let active = true
    const fetchCandidates = () => {
      listBatchCandidates(job.id)
        .then((r) => { if (active) setCandidates(r.candidates) })
        .catch(() => { if (active && candidates === null) setCandidates([]) })
    }
    fetchCandidates()
    const timer = running ? setInterval(fetchCandidates, 4_000) : null
    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.state])

  // Drop selections whose candidate is no longer present (defensive).
  useEffect(() => {
    if (!candidates) return
    const ids = new Set(candidates.map((p) => p.id))
    setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))))
  }, [candidates])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = candidates ?? []
    if (!q) return list
    return list.filter((p) =>
      [p.username, p.competitorHandle, p.caption].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [candidates, query])
  const visible = useSorted(filtered, sort, POST_SORT_ACCESSORS)

  const total = candidates?.length ?? 0
  const count = selected.size

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (count === 0 || saving || !candidates) return
    setSaving(true)
    setSaveError(null)
    setSavedNote(null)
    const picked = candidates.filter((p) => selected.has(p.id))
    try {
      const result = await importCapturedPosts({ posts: picked.map(candidateToImportInput) })
      setSelected(new Set())
      setSavedNote(`Saved ${result.importedCount} post${result.importedCount === 1 ? '' : 's'} to Content.`)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save selected posts.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-card'>
      <div className='flex flex-col gap-3 border-b border-border px-4 py-3'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-[15px] font-semibold tracking-[-0.01em]'>
            {total} candidate{total === 1 ? '' : 's'}
            {running && <span className='ml-2 text-[12px] font-normal text-muted-foreground'>· streaming…</span>}
          </h2>
          <div className='flex items-center gap-2 text-[12px]'>
            <button
              type='button'
              onClick={() => setSelected(new Set(visible.map((p) => p.id)))}
              className='text-[var(--anubis-gold)] hover:underline'
            >
              Select all
            </button>
            <span className='text-muted-foreground'>·</span>
            <button
              type='button'
              onClick={() => setSelected(new Set())}
              className='text-muted-foreground hover:text-foreground hover:underline'
            >
              Clear
            </button>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          <SearchBox value={query} onChange={setQuery} placeholder='Search handle, caption…' className='w-full sm:w-[280px]' />
          <SortControl options={POST_SORT_OPTIONS} value={sort} onChange={setSort} className='ml-auto' />
        </div>
      </div>

      <div className='max-h-[min(64vh,620px)] overflow-y-auto p-3'>
        {candidates === null ? (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className='aspect-square animate-pulse rounded-md border border-border bg-background/60' />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className='m-4 text-center text-[13px] text-muted-foreground'>
            {running
              ? 'No candidates yet — they appear here as each profile finishes.'
              : 'No posts were captured for this run.'}
          </p>
        ) : (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            {visible.map((post) => (
              <PostTile key={post.id} post={post} selected={selected.has(post.id)} onToggle={() => toggle(post.id)} />
            ))}
          </div>
        )}
      </div>

      <div className='flex flex-col gap-2 border-t border-border px-4 py-3'>
        {saveError && (
          <p className='rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12.5px] text-destructive'>
            {saveError}
          </p>
        )}
        {savedNote && (
          <p className='rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] px-3 py-2 text-[12.5px] text-foreground'>
            {savedNote}
          </p>
        )}
        <button
          type='button'
          onClick={() => void handleSave()}
          disabled={count === 0 || saving}
          className={cn(
            'inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-md px-4 text-[13.5px] font-semibold transition-colors',
            count === 0 || saving
              ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
              : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
          )}
        >
          <DownloadCloudIcon className='size-[15px]' strokeWidth={2.2} />
          {saving ? 'Saving…' : `Save ${count > 0 ? count : ''} to Content`}
        </button>
      </div>
    </div>
  )
}

function PostTile({
  post,
  selected,
  onToggle,
}: {
  post: CapturedPostSummary
  selected: boolean
  onToggle: () => void
}) {
  const [failed, setFailed] = useState(false)
  const showImage = !!post.mediaUrl && !failed
  return (
    <button
      type='button'
      data-testid={`candidate-${post.id}`}
      onClick={onToggle}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-md border bg-background/40 text-left transition-colors',
        selected
          ? 'border-[var(--anubis-gold)] ring-1 ring-[var(--anubis-gold)]'
          : 'border-border hover:border-[color-mix(in_oklab,var(--anubis-gold)_30%,var(--border))]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-1.5 top-1.5 z-10 inline-flex size-[18px] items-center justify-center rounded-[5px] border',
          selected ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]' : 'border-border bg-black/55',
        )}
      >
        {selected && (
          <svg viewBox='0 0 24 24' className='size-3' fill='none' stroke='currentColor' strokeWidth={3.5} strokeLinecap='round' strokeLinejoin='round'>
            <path d='M20 6L9 17l-5-5' />
          </svg>
        )}
      </span>
      <a
        href={post.postUrl}
        target='_blank'
        rel='noreferrer'
        onClick={(e) => e.stopPropagation()}
        className='absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100'
      >
        <ExternalLinkIcon className='size-3' strokeWidth={2} />
        Open
      </a>
      <div className='relative aspect-square w-full overflow-hidden bg-muted'>
        {showImage ? (
          <img
            src={post.mediaUrl}
            alt=''
            loading='lazy'
            onError={() => setFailed(true)}
            className='h-full w-full object-cover transition-transform group-hover:scale-[1.03]'
          />
        ) : (
          <div className='flex h-full w-full items-center justify-center text-[11px] text-muted-foreground'>No preview</div>
        )}
      </div>
      <div className='flex flex-col gap-1 p-2'>
        <span className='truncate font-mono text-[11.5px] text-foreground'>
          {post.competitorHandle ?? `@${post.username}`}
        </span>
        {post.caption && (
          <span className='line-clamp-2 text-[11px] leading-snug text-muted-foreground'>{post.caption}</span>
        )}
        <div className='mt-0.5 flex items-center gap-3 font-mono text-[10.5px] tabular-nums text-muted-foreground'>
          <span className='inline-flex items-center gap-1'>
            <HeartIcon className='size-3' strokeWidth={2} />
            {formatBigNumber(post.likes)}
          </span>
          <span className='inline-flex items-center gap-1'>
            <MessageCircleIcon className='size-3' strokeWidth={2} />
            {formatBigNumber(post.comments)}
          </span>
        </div>
      </div>
    </button>
  )
}

/** Map a captured-post candidate to the `/posts/import` input shape. */
function candidateToImportInput(post: CapturedPostSummary) {
  return {
    id: post.id,
    competitorId: post.competitorId,
    username: post.username,
    postUrl: post.postUrl,
    caption: post.caption,
    likes: post.likes,
    comments: post.comments,
    postedAt: post.postedAt,
    mediaKind: post.mediaKind,
    mediaUrl: post.mediaUrl,
    carouselCount: post.carouselCount,
    capturedAt: post.capturedAt,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/capture-posts-select-save.test.tsx`
Expected: PASS (candidate renders, select, save calls `importCapturedPosts` with `[{ id: 'p1', ... }]`).

- [ ] **Step 6: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: exit 0. (If `listPosts` import was left and is now unused, remove it; if `CapturedPostSummary` is not yet imported in `capture-posts.tsx`, it already is via the top `import type { ... CapturedPostSummary ... } from '@anubis/shared'` — confirm it is present in that import block.)

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/capture-posts.tsx packages/frontend/tests/pages/capture-posts-select-save.test.tsx
git commit -m "feat(frontend): Capture Posts results — select candidates and save to Content"
```

---

## Task 8: Full verification + graph update

**Files:** none (verification only)

- [ ] **Step 1: Backend tests (capture-related)**

Run: `pnpm --filter @anubis/shared build && pnpm vitest run packages/backend/tests/capture-stats-refresh.test.ts packages/backend/tests/capture-candidates.test.ts packages/backend/tests/capture-batch.test.ts packages/backend/tests/capture-batch-route.test.ts packages/backend/tests/import-poststats.test.ts --maxWorkers=2`
Expected: all PASS. (If a mass run shows `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3` first — it is an ABI mismatch, not a regression.)

- [ ] **Step 2: Frontend capture tests**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/capture-posts-select-save.test.tsx tests/pages/content-capture-preview.test.tsx`
Expected: PASS.

- [ ] **Step 3: Typecheck everything**

Run: `pnpm typecheck`
Expected: exit 0 across all packages.

- [ ] **Step 4: Update the knowledge graph (project convention)**

Run: `graphify update .`
Expected: "Code graph updated".

- [ ] **Step 5: Manual smoke (optional, requires the app + a logged-in Chrome profile)**

Capture a small competitor selection on the Capture Posts page. Confirm: competitor cards show refreshed bio/followers/avgLikes; **no** posts appear on the Content page until you select candidates and click "Save N to Content"; saved posts then appear on Content and the competitor's postCount reflects only the saved count.

---

## Notes for the implementer

- **Route ordering:** the new `GET /competitors/batch/:jobId/candidates` is a GET; the `POST /competitors/:id` route can't shadow it (different method, deeper path). The batch POST stays registered before `POST /competitors/:id` (see the comment in `captures.ts`). Do not reorder those.
- **`persistCaptureResult` / `runCapture` stay** for the (UI-dead) single-competitor async route `POST /competitors/:id` with `async:true`; leaving them avoids scope creep and behavior risk. Do not delete them.
- **avgLikes ownership:** capture sets it from the full crawl; import never recomputes it. This is intentional and load-bearing for competitor level coloring.
