# Capture posts: stats-only auto-save + select-to-save — design

**Date:** 2026-06-11
**Status:** Approved (pending spec review)

## Goal

Change the **batch Capture Posts page** so that running a capture no longer
auto-saves every scraped post into the Content library. Instead:

1. **Every capture refreshes the competitor's profile stats** — `bio`,
   `displayName`, `followers`, `avgLikes` — and marks `lastRefreshedAt`. No
   posts are written.
2. **Captured posts are surfaced as candidates** the user reviews and selects
   from. Only the **selected** posts are saved into Content (the
   `captured_posts` table), via the existing `/posts/import` route.
3. Candidates **stream in per-profile** as the batch run progresses (today's
   live-results behavior is preserved, without persistence).

This mirrors the existing Discover/Competitors selection pattern ("select
first, then save").

## Background — current state

- **Batch capture** (`POST /captures/competitors/batch`, `captures.ts`) runs a
  chunked background job. Per competitor it calls `runCapture` →
  `persistCaptureResult`, which:
  - `capturedPosts.upsertMany(posts)` — **persists all scraped posts**, and
  - updates the competitor row: `displayName`, `bio`, `followers`, `avgLikes`,
    `postCount` (= count of posts now in DB), and `markRefreshedAt`.
- The results panel (`capture-posts.tsx` → `CaptureResults`) reads
  `GET /posts` (the DB) and polls every 5s while running, so posts appear as
  each profile completes — **because they were persisted**.
- **Preview capture** (`POST /captures/competitors/:id` with `preview: true`,
  used by the **Content page**) builds candidate posts **without persisting and
  without updating any competitor stats**, returns them, and the Content page
  lets the user select + `importCapturedPosts`.
- **`/posts/import`** upserts the selected posts and calls
  `refreshCompetitorPostStats(competitorId)`, which **recomputes `avgLikes` and
  `postCount` from the saved posts** and writes them to the competitor.
- The background **job manager** (`jobs.ts`) only sets `job.result` when the
  executor returns; mid-run it publishes `progress` and `warnings`. There is no
  incremental-result channel.

## Decisions (from brainstorming)

- **Stats auto-saved on capture:** all profile stats — `bio`, `displayName`,
  `followers`, `avgLikes`. `avgLikes` is computed from the full in-memory crawl
  result (the dominant-cluster mean, same calculation as today). `postCount` is
  **not** bumped on capture — it reflects only posts the user actually saves.
- **Selection UI:** inline on the Capture Posts results panel (checkboxes +
  select-all/clear + a "Save N to Content" button).
- **Streaming:** candidates appear **per-profile** as the run progresses.
- **avgLikes ownership:** **capture owns `avgLikes`.** `/posts/import` updates
  **`postCount` only** and no longer recomputes `avgLikes`. Consequence: to keep
  avgLikes alive on the **Content page** (whose preview capture sets no stats
  today), the **preview path also gains the stats refresh**. Net model: *every
  capture refreshes profile stats; posts persist only on explicit save.* This is
  a small, necessary touch to the Content flow and an improvement (Content
  captures will now refresh bio/followers/avgLikes).
- **Scope:** batch Capture Posts page is the primary target; the preview path
  change above is the minimal change needed to keep the model consistent.

## Architecture

### Backend

**1. `refreshCompetitorStats(competitorId, result, targetPosts)` (new, `captures.ts`)**

Extracted from `persistCaptureResult`, **minus** post persistence and
`postCount`:

- Build candidate posts from `result.output.posts` (same `postDataToCapturedPost`
  + `uniqueCapturedPosts` + `slice(targetPosts)` pipeline as the preview path).
- Compute `avgLikes` from `result.meta.avgLikes` / `calculateAvgLikesSummary`
  (full crawl, **not** the candidate subset).
- `competitors.update(id, { displayName, bio, followers, avgLikes })` —
  no `postCount`.
- `markRefreshedAt(id, now)`.
- **Return** the candidates as enriched `CapturedPostSummary[]`
  (`enrichPostForOwner`).

`persistCaptureResult` is removed (no remaining callers) or kept only if another
caller surfaces; the audit during implementation decides. Both the batch path
and the preview path call `refreshCompetitorStats`.

**2. Preview route (`POST /competitors/:id`, `preview: true`)**

Replace the inline "build candidates, return" block with a call to
`refreshCompetitorStats` so the Content page's preview capture now refreshes
profile stats while still returning candidates (response shape unchanged:
`CapturePreviewPayload`).

**3. Batch route + orchestrator**

- `capture-batch.ts`: `captureOne` returns `{ candidates: CapturedPostSummary[],
  warnings? }` instead of `{ capturedCount }`. `runBatchCapture` concatenates
  candidates across competitors into the result and exposes `candidateCount`.
  Per-competitor `BatchCaptureOutcome.capturedCount` → `candidateCount`. On stop,
  candidates collected so far are preserved (existing chunk-preservation logic).
- Batch route: the `captureOne` wrapper calls `refreshCompetitorStats`, then
  **appends that competitor's candidates to the live candidate store** (below).

**4. Live candidate store + poll endpoint (streaming)**

- In-memory `Map<jobId, CapturedPostSummary[]>` (new `capture-candidates.ts`, or
  module-local in `captures.ts`). Appended per-profile by the batch executor.
  The batch route captures the job id into the executor via a mutable ref
  (`let jobId = ''; const job = runJob(..., exec); jobId = job.id`) — safe
  because the executor runs on the next microtask.
- `GET /captures/competitors/batch/:jobId/candidates` →
  `{ ok: true, candidates: CapturedPostSummary[], running: boolean }`. Serves the
  store. (4-segment GET path — no route-ordering conflict with the POST routes.)
- Store entries are pruned when the job is removed, via
  `jobManager.onChange` (drop on `{ type: 'removed' }`). Because the store lives
  exactly as long as the job record, a finished-but-not-dismissed job still
  serves its full candidate set — so the job **result** carries only counts, not
  the posts (no redundant copy).

**5. `BatchCaptureJobResult` (shared)**

```ts
interface BatchCaptureJobResult {
  totalProfiles: number
  profilesCompleted: number
  candidateCount: number          // was capturedCount
  stopped: boolean
  perCompetitor: BatchCaptureOutcome[]  // .candidateCount
}
// The candidate posts themselves are served by the store endpoint, not the
// result — the store outlives nothing the job needs.
```

Update `top-nav-progress.tsx` (reads `BatchCaptureJobResult`/`CaptureJobResult`).

**6. `/posts/import`**

`refreshCompetitorPostStats` updates **`postCount` only** (drop the `avgLikes`
recompute). `delete` already uses an inline count and is unaffected.

### Frontend (`capture-posts.tsx` → `CaptureResults`)

- Stop reading `GET /posts`. Source candidates from the live endpoint
  (`GET .../batch/:jobId/candidates`), polled every ~4s while the job runs and
  once more on the finished transition (the store still holds them).
- Render candidates in the existing post-tile grid **with selection** (checkbox
  per tile, select-all/clear, running selected count).
- A **"Save N to Content"** button calls `importCapturedPosts` with the selected
  posts (mapped via the existing `postToImportInput`-style mapper), then toasts
  success and clears the selection. Saved posts now appear on the Content page.

## Data flow

```
Batch run (per competitor, streamed):
  crawler result
    → refreshCompetitorStats: update competitor {bio,displayName,followers,avgLikes}, markRefreshed
    → return candidates (NOT persisted)
    → append candidates to store[jobId]            ──► GET .../batch/:jobId/candidates (poll)
  ...all competitors...
    → runBatchCapture aggregates counts → job.result (candidateCount, perCompetitor)

User selects candidates → POST /posts/import
    → upsert selected posts into captured_posts
    → refreshCompetitorPostStats: postCount only   (avgLikes already owned by capture)
    → posts visible on Content page
```

## Error handling

- A failed profile during the batch is recorded as a warning and the run
  continues (unchanged). It contributes no candidates.
- `refreshCompetitorStats` throws on a missing competitor (as
  `persistCaptureResult` does today); the job manager records it.
- The candidates endpoint returns `404 not_found` for an unknown job id and
  `{ candidates: [], running: false }` for a known job with no candidates yet.
- Import of a post whose competitor was deleted mid-flow throws (existing
  behavior in `/posts/import`).

## Testing

- **`capture-batch.test.ts`** — update: `captureOne` returns candidates;
  `runBatchCapture` aggregates them, exposes `candidateCount`, and preserves
  candidates captured before a stop.
- **New backend route test** — batch capture: competitor stats (bio/avgLikes/
  followers) update, **zero** rows written to `captured_posts`, and the
  candidates endpoint returns the streamed candidates. Then `/posts/import` of a
  selected subset bumps `postCount` **without** changing `avgLikes`.
- **New backend test** — preview capture now refreshes stats (avgLikes set) and
  still persists nothing.
- **Frontend** — `CaptureResults` renders polled candidates with selection and
  calls `importCapturedPosts` with the selected subset on Save.

## Out of scope

- The Content page's own capture UI beyond the preview-stats-refresh consequence.
- Single-competitor non-preview capture (`POST /competitors/:id` without
  `preview`/`async`) — left as-is unless the implementation audit finds it is the
  only remaining `persistCaptureResult` caller, in which case it is migrated too.
- Persisting candidates across app restarts (the live store is in-memory and
  job-scoped, matching the job manager).
