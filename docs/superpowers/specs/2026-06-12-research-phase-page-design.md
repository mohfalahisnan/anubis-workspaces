# Research Phase Page — Design Spec

**Date:** 2026-06-12
**Status:** Approved for planning
**Scope:** The Research Phase of content creation only. The Generating Content Phase is explicitly out of scope.

## 1. Goal

A dedicated page that moves the user from raw competitor posts to a clean list of
**validated content candidates**, ready to hand to the (later) Generating Content Phase.

The page supports five jobs:

1. Manage competitor sources.
2. Identify high-performing competitor content.
3. Score competitor posts against each competitor's *own* normal performance.
4. Filter valid content candidates.
5. Prepare a clean candidate library.

## 2. Approach

This **composes existing machinery** rather than building a parallel system. The app already has:

- `competitors` table + a working Competitors page (CRUD, capture, discover, export/import).
- `captured_posts` table (per-post likes, caption, postedAt, mediaKind, url).
- `avgLikes` per competitor computed as a **modal-cluster mean** (dominant engagement cluster, viral-spikes excluded).
- `levelFor(followers)` → green/yellow/red competitor levels (configurable thresholds).
- `multiplierRatingFor()` → `score = postLikes / avgLikes` rated per competitor level.
- A `content_items` table (`idea → … → published`) referencing a captured post.
- `POST /ai-agent/run` → blocking agent run in the project `workdir`, which contains the `knowledge/` base.

The Research Phase work is therefore: a few new competitor fields, a **median** baseline, the
user's exact scoring/leveling rules, AI niche validation, a candidate store, and a new page.

The existing Competitors page remains for heavy competitor management. The Research page is a
focused workflow surface that reuses competitor/capture/scoring data.

## 3. Decisions (resolved during brainstorming)

| Decision | Choice |
| --- | --- |
| Baseline metric | **Add a new median-based `baselineLikes`** field (median of recent N post likes). `avgLikes` stays untouched. `baselineLikes` is the score denominator. |
| Scoring rules | **Update the shared scoring config to spec** (single source of truth). Changes the existing Competitors page ratings too. |
| Niche alignment | **AI-judged** against the workspace knowledge base (the niche lives in the user's workspace). |
| Candidate persistence | **New `research_candidates` table** (not `content_items`). This table *is* the candidate library and the output. |
| Competitor `status` values | `active` / `paused` / `archived` |
| Global threshold change | Approved — affects the existing Competitors page. |
| Delivery | **Phased: A then B** (see §11). |

## 4. Data model

### 4.1 Competitor — new fields (migration `023`)

Add to `competitors` (+ `competitors-repo.ts`, shared `CompetitorSummary` / `CreateCompetitorInput` / `UpdateCompetitorInput`, `/competitors` create+patch):

- `platform TEXT NOT NULL DEFAULT 'instagram'` — crawler is IG-only today; field future-proofs the filter.
- `status TEXT NOT NULL DEFAULT 'active'` — CHECK in (`active`, `paused`, `archived`).
- `favorite INTEGER NOT NULL DEFAULT 0` — boolean.
- `baseline_likes INTEGER` — **median of the most recent 20 post likes** (or all captured posts if fewer than 20); null until captured. Falls back to average if median is unavailable.
- `baseline_sample_size INTEGER` — number of posts the median was taken over.
- `baseline_updated_at INTEGER` — epoch ms.

`avgLikes` (modal-cluster mean) is **kept** and still computed on capture; `baselineLikes` is computed alongside it.

Highest/lowest post likes and "recent posts analyzed" for the Baseline section are computed from
`captured_posts` at query time (not stored).

### 4.2 `research_sessions` (migration `024`)

One row per research run.

```
id            TEXT PRIMARY KEY
project_id    TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id)
controls      TEXT NOT NULL                 -- JSON: the ResearchControls used
status        TEXT NOT NULL                 -- 'crawling' | 'scoring' | 'validating' | 'done' | 'error'
job_id        TEXT                          -- backing async capture job, if any
counts        TEXT                          -- JSON: { candidates, valid, green, yellow, neutral }
error         TEXT
created_at    INTEGER NOT NULL
updated_at    INTEGER NOT NULL
deleted_at    INTEGER
```

### 4.3 `research_candidates` (migration `024`)

The candidate library and the page's output.

```
id                  TEXT PRIMARY KEY
project_id          TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id)
session_id          TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE
competitor_id       TEXT NOT NULL REFERENCES competitors(id)
post_id             TEXT NOT NULL REFERENCES captured_posts(id)
-- snapshots taken at scoring time (so re-capture doesn't mutate history)
platform            TEXT
post_url            TEXT
posted_at           TEXT
caption             TEXT
media_kind          TEXT
likes               INTEGER
baseline_likes      INTEGER
-- scoring
score               REAL
competitor_level    TEXT                    -- 'green' | 'yellow' | 'red' | 'black' | 'unknown'
candidate_level     TEXT                    -- 'green' | 'yellow' | 'neutral'
-- validation
niche_aligned       INTEGER                 -- 1 | 0 | NULL (pending)
niche_reason        TEXT
validation_status   TEXT NOT NULL           -- 'valid' | 'invalid' | 'pending'
validation_failures TEXT                    -- JSON array of failed rule keys
-- user action
decision            TEXT NOT NULL DEFAULT 'none'  -- 'none' | 'selected' | 'rejected' | 'saved'
created_at          INTEGER NOT NULL
updated_at          INTEGER NOT NULL
deleted_at          INTEGER
UNIQUE(session_id, post_id)
```

Migrations follow the existing mechanism: new `.sql` files under
`packages/conversation/src/db/migrations/` + registry entries in `index.ts`.

> Bridge to the next phase (out of scope now): promoting a `saved` candidate into a `content_items`
> row is left as a thin, explicit hook for the Generating Content Phase. Not built here.

## 5. Scoring & leveling library (`packages/shared/src/index.ts`)

Pure functions, fully unit-tested. **This changes existing behavior (approved).**

### 5.1 Competitor level

Update `DEFAULT_COMPETITOR_LEVELS` / `levelFor`:

```
followers == null      -> 'unknown'
followers < 10_000     -> 'black'    (inactive; below research floor)
10_000 .. 40_000       -> 'green'
40_001 .. 1_000_000    -> 'yellow'
> 1_000_000            -> 'red'
```

(Today `>1M` collapses to `black` and yellow caps at 100K — both change. Config becomes a clean
three-tier `{ minActive, greenMax, yellowMax }`; `red = followers > yellowMax`. `effectiveLevel`
and `isValidCompetitorLevels` adjust accordingly.)

### 5.2 Score

```ts
scoreFor(postLikes, baselineLikes): number   // postLikes / baselineLikes; guards 0/missing -> null-ish
```

### 5.3 Candidate level

```ts
type CandidateLevel = 'green' | 'yellow' | 'neutral'

function getCandidateLevel(score: number, competitorLevel: CompetitorLevel): CandidateLevel {
  if (competitorLevel === 'green') {
    if (score >= 10) return 'green'
    if (score >= 5) return 'yellow'
    return 'neutral'
  }
  if (competitorLevel === 'yellow') {
    if (score >= 20) return 'green'
    if (score >= 10) return 'yellow'
    return 'neutral'
  }
  if (competitorLevel === 'red') {
    if (score >= 20) return 'yellow'   // red can NEVER be green
    return 'neutral'
  }
  return 'neutral'                      // black / unknown
}
```

The existing Competitors-page post badges are re-pointed at `getCandidateLevel` so green/yellow/neutral
labels are consistent everywhere.

### 5.4 Worked examples → unit tests

- green competitor, baseline 50, likes 1000 → score 20 → `green`
- green competitor, score 5 → `yellow`; score 4.9 → `neutral`
- yellow competitor, score 20 → `green`; score 10 → `yellow`; score 9.9 → `neutral`
- red competitor, score 100 → `yellow` (never green); score 19.9 → `neutral`
- black/unknown competitor → always `neutral`

## 6. Validation logic

A candidate is `valid` only if **all** rules pass. `validation_failures` lists the failed keys.

| Key | Rule |
| --- | --- |
| `recency` | `postedAt >= now − maxContentAgeDays` (default 7 days) |
| `niche` | `niche_aligned === true` (AI step §7). Until it runs → `pending` |
| `score` | `baselineLikes` present and `> 0`, and `score` finite |
| `source` | competitor exists, not archived, not soft-deleted |

`validation_status`:
- `pending` while niche alignment hasn't run.
- `valid` if all four pass.
- `invalid` otherwise.

`candidate_level` (green/yellow/neutral) is **prioritization, independent of validity**.
The page output `validatedContentCandidates` = rows with `validation_status === 'valid'`, sorted by
candidate level (green → yellow → neutral) then score desc.

## 7. AI niche validation

No lightweight classify helper exists; the only model path is `POST /ai-agent/run` (blocking, runs
`claude` in the project `workdir`, which contains `knowledge/`). So niche alignment runs as **one
batched agent call per research run**, not per candidate:

- Input: the candidate list (`postId`, `caption`, competitor handle + `niche`).
- Instruction: consult the workspace knowledge base for "our niche"; return structured JSON
  `[{ postId, aligned: boolean, reason: string }]`.
- Output fills `niche_aligned` / `niche_reason` and finalizes `validation_status`.
- The user can override alignment per row (PATCH).

## 8. Backend routes (`packages/backend/src/research.ts`)

- `POST /research/sessions` — start a run; body = `ResearchControls`. Reuses the existing **async
  capture + job/progress** infra for the crawl, then scores + validates. Returns `{ sessionId, jobId? }`.
- `GET /research/sessions` — list sessions (by project).
- `GET /research/sessions/:id` — session + counts.
- `GET /research/sessions/:id/candidates` — candidates for a session (filterable).
- `GET /research/candidates` — cross-session candidate library (filter by level / validation / decision).
- `POST /research/sessions/:id/validate-niche` — run the batched AI alignment (Phase B).
- `PATCH /research/candidates/:id` — set `decision` / manual niche override.
- Extend `/competitors` create + patch for `favorite` / `status` / `platform`.

Errors normalized by `app.ts` (`ZodError` → 400, else 500). Route ordering: register static
segments (`/research/sessions`, `/research/candidates`) before any `/:param` routes
(per the Hono route-ordering convention).

### 8.1 `ResearchControls` (shared type)

```ts
interface ResearchControls {
  competitorIds?: string[]        // explicit selection; empty = all eligible
  favoriteOnly?: boolean          // default false
  platform?: string               // default undefined = any
  niche?: string                  // default undefined = any
  dateFrom?: string               // ISO; optional
  dateTo?: string                 // ISO; optional
  maxPostsPerProfile?: number     // default 20
  maxContentAgeDays?: number      // default 7
}
```

## 9. Research run flow (end to end)

1. User configures **Research Controls**, clicks Start.
2. Backend creates a `research_sessions` row, then **captures fresh posts** for each selected
   competitor (reuses the existing crawler, `targetPosts = maxPostsPerProfile`) via the async job
   infra; progress streams through the existing `useJobs` mechanism.
3. On capture completion: recompute each competitor's `baselineLikes` (median of recent N;
   fall back to average if median unavailable per spec).
4. Build candidates from captured posts within the date range; compute `score`, `competitorLevel`,
   `candidateLevel`; run validation rules `recency` / `score` / `source`.
5. (Phase B) Run the batched AI niche-alignment agent; set `niche_aligned` / `niche_reason`;
   finalize `validation_status`.
6. Persist `research_candidates`; update session counts.
7. Page renders the candidate table; user reviews and sets decisions; `saved` rows are the output.

Research runs are long-running (CDP browser); they use the existing job/progress infrastructure.

## 10. The page (`packages/frontend/src/pages/research.tsx`)

New top-level page. Registered in `lib/navigation.tsx` (`Route` union), `components/dashboard/index.tsx`
(`CurrentPage` switch + `BREADCRUMBS`), and the sidebar `components/dashboard/data.ts` (`navItems`,
lucide icon). API helpers in a new `packages/frontend/src/api/research.ts` using the existing
`getApiBaseUrl()` + `api<T>()` pattern.

Six sections (per requirements §7):

1. **Competitor Library** — totals (total / favorite / by-platform / by-niche / by-status); favorite
   toggle + status inline; quick add/edit; link to the full Competitors page for bulk work.
2. **Baseline Performance** — per competitor: recent posts analyzed, `baselineLikes` (median),
   highest / lowest post likes, last updated.
3. **Research Controls** — select competitors, favorite-only toggle, platform, niche, date range,
   `maxPostsPerProfile = 20`, `maxContentAgeDays = 7`, Start (defaults shown above).
4. **Content Candidate Table** — columns: status, competitor, platform, post date, likes, baseline,
   score, performance level, niche alignment, validation result, actions (view post, view details,
   mark selected, reject, save).
5. **Candidate Validation** — filter valid / invalid; show reasons.
6. **Candidate Detail Preview** — side sheet: post/media preview, caption, competitor info, likes,
   baseline, score calculation, performance level, validation result + reason why valid/invalid, save.

Reuses shadcn/ui primitives (`Card`, `Dialog`, `Sheet`, `Select`, `Switch`, `Badge`, `Tabs`, etc.)
and the list-control helpers (`SearchBox`, `SortControl`, `PaginationBar`, `useSorted`, `paginate`),
matching the Competitors page conventions.

## 11. Phasing

**Phase A — workflow without AI**
- Competitor fields (`favorite` / `status` / `platform`), median `baselineLikes`.
- Shared scoring/leveling library (`levelFor` thresholds, `scoreFor`, `getCandidateLevel`) + tests.
- `research_sessions` + `research_candidates` tables and repos.
- Backend research routes (session create → capture → score → validate with `recency`/`score`/`source`).
- The page with all six sections; niche alignment as a **manual** per-row toggle (validation rule
  `niche` reads the manual value).
- Re-point Competitors page badges at `getCandidateLevel`.

Phase A is independently useful and fully testable (no external API cost).

**Phase B — AI niche validation**
- Batched `POST /research/sessions/:id/validate-niche` agent call against the workspace knowledge base.
- Auto-run niche alignment as step 5 of the research flow; keep manual override.

Each phase goes through its own implementation plan.

## 12. Testing

- **Unit (shared):** `levelFor` new thresholds; `scoreFor` guards; `getCandidateLevel` all branches
  (the §5.4 worked examples); `baselineLikes` median + average fallback; validation rule evaluation.
- **Backend:** session create → candidate build (recency / score / source); candidate decision PATCH;
  competitor create/patch with new fields. (Watch the better-sqlite3 ABI rebuild + worker-contention
  test caveats noted in project memory; run focused vitest with `--maxWorkers=2`.)
- **Frontend:** candidate table rendering, validation filter, detail sheet, controls defaults.

## 13. Packaging note

No new third-party runtime deps are anticipated. If any are added to a workspace package that runs
inside the packaged backend, they must also be added to the **root `package.json` dependencies**
(electron-builder only packages root-reachable deps) — per the project's recurring packaging trap.
