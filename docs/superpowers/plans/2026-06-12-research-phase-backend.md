# Research Phase — Backend Foundations Implementation Plan (Phase A, Part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend + shared-library foundations for the Research Phase: the scoring/leveling/validation library, the new competitor fields and median baseline, and a persisted research-session/candidate store exposed over HTTP — all unit- and route-testable, with no UI.

**Architecture:** Pure scoring/validation functions live in `@anubis/shared`. New competitor columns and two new tables (`research_sessions`, `research_candidates`) are added via SQLite migrations in `@anubis/conversation`, with repos + a `ResearchService` that builds candidates from already-captured posts (recomputing each competitor's median baseline), scores them, and evaluates validation rules. `@anubis/backend` exposes `/research/*` Hono routes. Niche alignment is a **manual** per-candidate toggle in this part; the AI step is Phase B.

**Tech Stack:** TypeScript (ESM, strict, `isolatedModules`), better-sqlite3, Hono, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-research-phase-page-design.md`

---

## Testing notes (read first)

- **Rebuild changed packages before testing dependents.** Vitest resolves `@anubis/*` imports to each package's `dist/`. A package's *own* tests import from `../src/...` and need no build, but tests in a *downstream* package (conversation/backend importing `@anubis/shared`) only see changes after a build. So after editing `packages/shared`, run `pnpm --filter @anubis/shared build` before running conversation/backend tests.
- **Run focused tests with bounded workers:** `pnpm vitest run <path> --maxWorkers=2`. The full suite flakes under worker contention (embedding-model load).
- **If backend tests fail en masse with `ERR_DLOPEN_FAILED` / NODE_MODULE_VERSION mismatch**, that is a native-ABI issue, not a regression: run `pnpm rebuild better-sqlite3` and re-run.
- Run all commands from the repo root.

## File structure

**Modify:**
- `packages/shared/src/index.ts` — adjust `DEFAULT_COMPETITOR_LEVELS`; add `scoreFor`, `CandidateLevel`, `getCandidateLevel`, `medianLikes`, `evaluateCandidateValidation`, research DTO types, competitor field additions.
- `packages/shared/tests/competitor-level.test.ts` — update default-config expectations.
- `packages/conversation/src/db/repositories/competitors-repo.ts` — new columns in `Competitor`, `Row`, mappers, insert, update.
- `packages/conversation/src/competitors/competitors-service.ts` — accept new fields on create/update.
- `packages/conversation/src/db/migrations/index.ts` — register migrations 23 & 24.
- `packages/conversation/src/index.ts` — wire `ResearchService` + repos into `ConversationStack`.
- `packages/backend/src/competitors.ts` — Zod for `favorite`/`status`/`platform`.
- `packages/backend/src/app.ts` — mount `/research`.

**Create:**
- `packages/shared/tests/candidate-score.test.ts`
- `packages/shared/tests/candidate-validation.test.ts`
- `packages/conversation/src/db/migrations/023_competitor_research_fields.sql`
- `packages/conversation/src/db/migrations/024_research_tables.sql`
- `packages/conversation/src/db/repositories/research-sessions-repo.ts`
- `packages/conversation/src/db/repositories/research-candidates-repo.ts`
- `packages/conversation/src/research/research-service.ts`
- `packages/conversation/tests/research/research-service.test.ts`
- `packages/backend/src/research.ts`
- `packages/backend/tests/research-routes.test.ts`

---

## Group 1 — Shared scoring & validation library

### Task 1: Retune competitor-level defaults

The spec wants green 10K–40K, yellow 40K–1M, red >1M. The struct and `levelFor` logic stay; only `DEFAULT_COMPETITOR_LEVELS` changes (yellow ceiling → 1M; active ceiling → effectively unbounded so >1M reads as `red`, not `black`).

**Files:**
- Modify: `packages/shared/src/index.ts:524-529`
- Test: `packages/shared/tests/competitor-level.test.ts`

- [ ] **Step 1: Update the failing test expectations**

Replace the three default-config `it` blocks (currently lines ~28-43) in `packages/shared/tests/competitor-level.test.ts` with:

```ts
  it('returns "yellow" above greenMax and up to yellowMax inclusive', () => {
    expect(levelFor(40_001, cfg)).toBe('yellow')
    expect(levelFor(75_000, cfg)).toBe('yellow')
    expect(levelFor(1_000_000, cfg)).toBe('yellow')
  })

  it('returns "red" above yellowMax', () => {
    expect(levelFor(1_000_001, cfg)).toBe('red')
    expect(levelFor(50_000_000, cfg)).toBe('red')
    expect(levelFor(660_000_000, cfg)).toBe('red')
  })

  it('returns "black" only above the (effectively unbounded) active ceiling', () => {
    expect(levelFor(1_000_000_001, cfg)).toBe('black')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/shared/tests/competitor-level.test.ts --maxWorkers=2`
Expected: FAIL — `levelFor(1_000_001)` returns `'black'` (old default), expected `'red'`.

- [ ] **Step 3: Update the default config**

In `packages/shared/src/index.ts`, replace `DEFAULT_COMPETITOR_LEVELS`:

```ts
export const DEFAULT_COMPETITOR_LEVELS: CompetitorLevelsConfig = {
  minActive: 10_000,
  greenMax: 40_000,
  yellowMax: 1_000_000,
  // Effectively unbounded: any account over yellowMax reads as 'red'. The upper
  // 'black' region only triggers above this ceiling, which no real account hits.
  maxActive: 1_000_000_000,
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/shared/tests/competitor-level.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/tests/competitor-level.test.ts
git commit -m "feat(shared): retune competitor-level defaults (yellow to 1M, red >1M)"
```

---

### Task 2: Add candidate scoring (`scoreFor`, `getCandidateLevel`, `medianLikes`)

**Files:**
- Modify: `packages/shared/src/index.ts` (append after the level-multiplier section, near line 642)
- Test: `packages/shared/tests/candidate-score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/candidate-score.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scoreFor, getCandidateLevel, medianLikes } from '../src/index.js'

describe('scoreFor', () => {
  it('divides post likes by the baseline', () => {
    expect(scoreFor(1000, 50)).toBe(20)
  })
  it('returns null when baseline is missing or non-positive', () => {
    expect(scoreFor(1000, 0)).toBeNull()
    expect(scoreFor(1000, null)).toBeNull()
    expect(scoreFor(1000, undefined)).toBeNull()
  })
  it('returns null when likes are missing or non-finite', () => {
    expect(scoreFor(null, 50)).toBeNull()
    expect(scoreFor(Infinity, 50)).toBeNull()
  })
})

describe('getCandidateLevel — green competitor', () => {
  it('green at >=10, yellow at >=5, neutral below 5', () => {
    expect(getCandidateLevel(20, 'green')).toBe('green')
    expect(getCandidateLevel(10, 'green')).toBe('green')
    expect(getCandidateLevel(5, 'green')).toBe('yellow')
    expect(getCandidateLevel(4.9, 'green')).toBe('neutral')
  })
})

describe('getCandidateLevel — yellow competitor', () => {
  it('green at >=20, yellow at >=10, neutral below 10', () => {
    expect(getCandidateLevel(20, 'yellow')).toBe('green')
    expect(getCandidateLevel(10, 'yellow')).toBe('yellow')
    expect(getCandidateLevel(9.9, 'yellow')).toBe('neutral')
  })
})

describe('getCandidateLevel — red competitor (never green)', () => {
  it('caps at yellow at >=20, otherwise neutral', () => {
    expect(getCandidateLevel(100, 'red')).toBe('yellow')
    expect(getCandidateLevel(20, 'red')).toBe('yellow')
    expect(getCandidateLevel(19.9, 'red')).toBe('neutral')
  })
})

describe('getCandidateLevel — black/unknown competitor', () => {
  it('always neutral', () => {
    expect(getCandidateLevel(1000, 'black')).toBe('neutral')
    expect(getCandidateLevel(1000, 'unknown')).toBe('neutral')
  })
})

describe('medianLikes', () => {
  it('returns the middle value for odd counts', () => {
    expect(medianLikes([10, 100, 20])).toBe(20)
  })
  it('averages the two middle values for even counts (rounded)', () => {
    expect(medianLikes([10, 20, 30, 41])).toBe(25) // (20+30)/2
  })
  it('ignores non-finite/negative values', () => {
    expect(medianLikes([10, -5, NaN, 30])).toBe(20)
  })
  it('returns null for an empty set', () => {
    expect(medianLikes([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/shared/tests/candidate-score.test.ts --maxWorkers=2`
Expected: FAIL — `scoreFor`/`getCandidateLevel`/`medianLikes` are not exported.

- [ ] **Step 3: Implement the functions**

Append to `packages/shared/src/index.ts` (after the `isValidLevelMultipliers` block, ~line 642):

```ts
/* ============================================================
   Candidate scoring (Research Phase)
   ============================================================
   score = postLikes / competitorBaselineLikes. The candidate level
   depends on the competitor's level band — see getCandidateLevel.
   ============================================================ */

export type CandidateLevel = 'green' | 'yellow' | 'neutral'

/** post likes ÷ baseline likes; null when either is missing/non-finite or baseline <= 0. */
export function scoreFor(
  postLikes: number | null | undefined,
  baselineLikes: number | null | undefined,
): number | null {
  if (postLikes == null || baselineLikes == null) return null
  if (!Number.isFinite(postLikes) || !Number.isFinite(baselineLikes)) return null
  if (baselineLikes <= 0) return null
  return postLikes / baselineLikes
}

/**
 * Candidate level from a multiplier score and the owning competitor's level.
 * Thresholds rise with competitor size; red competitors can never yield 'green'
 * (massive distribution = inspiration signal, not direct validation).
 */
export function getCandidateLevel(score: number, competitorLevel: CompetitorLevel): CandidateLevel {
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
    if (score >= 20) return 'yellow'
    return 'neutral'
  }
  return 'neutral'
}

/**
 * Median of like counts, rounded. Non-finite/negative values are dropped.
 * The viral-resistant baseline ("typical" likes) for a competitor. Returns null
 * for an empty input (no average fallback is possible without samples).
 */
export function medianLikes(values: number[]): number | null {
  const clean = values
    .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  const median = clean.length % 2 === 1 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2
  return Math.round(median)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/shared/tests/candidate-score.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/tests/candidate-score.test.ts
git commit -m "feat(shared): candidate scoring (scoreFor, getCandidateLevel, medianLikes)"
```

---

### Task 3: Add candidate validation evaluator

**Files:**
- Modify: `packages/shared/src/index.ts` (append after Task 2 block)
- Test: `packages/shared/tests/candidate-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/candidate-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateCandidateValidation } from '../src/index.js'

const NOW = 1_700_000_000_000 // fixed "now" for deterministic recency
const dayMs = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const base = {
  baselineLikes: 50,
  score: 20,
  competitorActive: true,
  nicheAligned: true as boolean | null,
  maxContentAgeDays: 7,
  nowMs: NOW,
}

describe('evaluateCandidateValidation', () => {
  it('is valid when every rule passes', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(2 * dayMs) })
    expect(r.status).toBe('valid')
    expect(r.failures).toEqual([])
  })

  it('fails recency when older than maxContentAgeDays', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(8 * dayMs) })
    expect(r.status).toBe('invalid')
    expect(r.failures).toContain('recency')
  })

  it('fails recency when postedAt is missing', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: undefined })
    expect(r.failures).toContain('recency')
  })

  it('fails score when baseline is non-positive or score missing', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), baselineLikes: 0, score: null })
    expect(r.failures).toContain('score')
  })

  it('fails source when the competitor is inactive', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), competitorActive: false })
    expect(r.failures).toContain('source')
  })

  it('fails niche when explicitly not aligned', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), nicheAligned: false })
    expect(r.status).toBe('invalid')
    expect(r.failures).toContain('niche')
  })

  it('is pending when only niche is unresolved (null) and all else passes', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(dayMs), nicheAligned: null })
    expect(r.status).toBe('pending')
    expect(r.failures).toEqual([])
  })

  it('is invalid (not pending) when a hard rule fails even if niche is unresolved', () => {
    const r = evaluateCandidateValidation({ ...base, postedAt: iso(99 * dayMs), nicheAligned: null })
    expect(r.status).toBe('invalid')
    expect(r.failures).toContain('recency')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/shared/tests/candidate-validation.test.ts --maxWorkers=2`
Expected: FAIL — `evaluateCandidateValidation` is not exported.

- [ ] **Step 3: Implement the evaluator**

Append to `packages/shared/src/index.ts`:

```ts
export type CandidateValidationStatus = 'valid' | 'invalid' | 'pending'
export type CandidateValidationRule = 'recency' | 'niche' | 'score' | 'source'

export interface CandidateValidationArgs {
  postedAt?: string
  baselineLikes?: number | null
  score?: number | null
  competitorActive: boolean
  /** true = aligned, false = not aligned, null/undefined = not yet judged. */
  nicheAligned?: boolean | null
  maxContentAgeDays: number
  nowMs: number
}

export interface CandidateValidationResult {
  status: CandidateValidationStatus
  failures: CandidateValidationRule[]
}

/**
 * A candidate is valid only if recency, score, source, and niche all pass.
 * Niche being unresolved (null) yields 'pending' — unless a hard rule already
 * failed, in which case the candidate is 'invalid'.
 */
export function evaluateCandidateValidation(args: CandidateValidationArgs): CandidateValidationResult {
  const failures: CandidateValidationRule[] = []

  const postedMs = args.postedAt ? Date.parse(args.postedAt) : NaN
  const maxAgeMs = args.maxContentAgeDays * 24 * 60 * 60 * 1000
  const recencyOk = Number.isFinite(postedMs) && postedMs >= args.nowMs - maxAgeMs
  if (!recencyOk) failures.push('recency')

  const scoreOk =
    args.baselineLikes != null && args.baselineLikes > 0 &&
    args.score != null && Number.isFinite(args.score) && args.score > 0
  if (!scoreOk) failures.push('score')

  if (!args.competitorActive) failures.push('source')

  if (args.nicheAligned === false) failures.push('niche')

  if (failures.length > 0) return { status: 'invalid', failures }
  if (args.nicheAligned == null) return { status: 'pending', failures: [] }
  return { status: 'valid', failures: [] }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/shared/tests/candidate-validation.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/tests/candidate-validation.test.ts
git commit -m "feat(shared): candidate validation evaluator"
```

---

### Task 4: Add shared DTO types for competitors + research

These are the wire contracts used by the backend and (later) frontend. No new behavior — types only — so no separate test; they are exercised by later route tests.

**Files:**
- Modify: `packages/shared/src/index.ts` (competitor interfaces ~312-353; append research types after Task 3 block)

- [ ] **Step 1: Extend the competitor DTOs**

In `packages/shared/src/index.ts`, add the new fields to the three competitor interfaces:

```ts
export type CompetitorStatus = 'active' | 'paused' | 'archived'
```

Add to `CompetitorSummary` (after `level?`):

```ts
  platform?: string
  status?: CompetitorStatus
  favorite?: boolean
  baselineLikes?: number
  baselineSampleSize?: number
  baselineUpdatedAt?: number
```

Add to `CreateCompetitorInput` (after `level?`):

```ts
  platform?: string
  status?: CompetitorStatus
  favorite?: boolean
```

Add to `UpdateCompetitorInput` (after `level?`):

```ts
  platform?: string
  status?: CompetitorStatus
  favorite?: boolean
```

- [ ] **Step 2: Append the research DTO types**

Append to `packages/shared/src/index.ts`:

```ts
/* ============================================================
   Research Phase — sessions & candidates
   ============================================================ */

export interface ResearchControls {
  competitorIds?: string[]
  favoriteOnly?: boolean
  platform?: string
  niche?: string
  dateFrom?: string            // ISO; inclusive lower bound on postedAt
  dateTo?: string              // ISO; inclusive upper bound on postedAt
  maxPostsPerProfile?: number  // default 20 (also the baseline sample window)
  maxContentAgeDays?: number   // default 7
}

export type ResearchSessionStatus = 'scoring' | 'validating' | 'done' | 'error'

export interface ResearchSessionCounts {
  candidates: number
  valid: number
  green: number
  yellow: number
  neutral: number
}

export interface ResearchSessionSummary {
  id: string
  projectId?: string
  controls: ResearchControls
  status: ResearchSessionStatus
  counts: ResearchSessionCounts
  error?: string
  createdAt: number
  updatedAt: number
}

export type CandidateDecision = 'none' | 'selected' | 'rejected' | 'saved'

export interface ResearchCandidateSummary {
  id: string
  projectId?: string
  sessionId: string
  competitorId: string
  competitorHandle?: string
  competitorLevel: CompetitorLevel
  postId: string
  platform?: string
  postUrl?: string
  postedAt?: string
  caption?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  likes?: number
  baselineLikes?: number
  score?: number
  candidateLevel: CandidateLevel
  nicheAligned?: boolean
  nicheReason?: string
  validationStatus: CandidateValidationStatus
  validationFailures: CandidateValidationRule[]
  decision: CandidateDecision
  createdAt: number
  updatedAt: number
}

export interface CreateResearchSessionInput {
  projectId?: string
  controls?: ResearchControls
}

export interface UpdateResearchCandidateInput {
  decision?: CandidateDecision
  nicheAligned?: boolean | null
  nicheReason?: string | null
}

export type ResearchSessionListResponse = ListResponse<ResearchSessionSummary>
export type ResearchCandidateListResponse = ListResponse<ResearchCandidateSummary>
```

> Note: `ListResponse<T>` already exists in this file (used by `CapturedPostListResponse`). If the `ListResponse` definition appears *below* this insertion point, move these two `type ... = ListResponse<...>` aliases to the end of the file instead.

- [ ] **Step 3: Build shared and typecheck**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/shared typecheck`
Expected: both succeed (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): competitor + research DTO types"
```

---

## Group 2 — Competitor new fields + baseline persistence

### Task 5: Migration 023 — competitor research columns

**Files:**
- Create: `packages/conversation/src/db/migrations/023_competitor_research_fields.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts:99` (append to `MIGRATIONS`)
- Test: `packages/conversation/tests/db/migrate.test.ts` is generic; verification happens via the repo test in Task 6.

- [ ] **Step 1: Write the migration SQL**

Create `packages/conversation/src/db/migrations/023_competitor_research_fields.sql`:

```sql
-- Research Phase competitor fields.
-- platform: the source network (crawler is Instagram-only today).
ALTER TABLE competitors ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram';
-- status: 'active' | 'paused' | 'archived' (enforced in the service/Zod layer).
ALTER TABLE competitors ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
-- favorite: prioritised during research (0/1).
ALTER TABLE competitors ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
-- baselineLikes: median of the most recent posts; the score denominator.
ALTER TABLE competitors ADD COLUMN baseline_likes INTEGER;
ALTER TABLE competitors ADD COLUMN baseline_sample_size INTEGER;
ALTER TABLE competitors ADD COLUMN baseline_updated_at INTEGER;
```

- [ ] **Step 2: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, add to the `MIGRATIONS` array after the `load(22, ...)` line:

```ts
  load(23, '023_competitor_research_fields.sql'),
```

- [ ] **Step 3: Verify migrations apply cleanly**

Run: `pnpm vitest run packages/conversation/tests/db/migrate.test.ts --maxWorkers=2`
Expected: PASS (the migration runner applies version 23 without error).

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/db/migrations/023_competitor_research_fields.sql packages/conversation/src/db/migrations/index.ts
git commit -m "feat(conversation): migration 023 — competitor research fields"
```

---

### Task 6: Competitor repo + service for the new fields

**Files:**
- Modify: `packages/conversation/src/db/repositories/competitors-repo.ts`
- Modify: `packages/conversation/src/competitors/competitors-service.ts`
- Test: `packages/conversation/tests/competitors/competitors-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/conversation/tests/competitors/competitors-service.test.ts` (inside the `describe`):

```ts
  it('defaults platform/status/favorite and round-trips them', () => {
    const c = svc.create({ handle: '@baseliner' })
    expect(c.platform).toBe('instagram')
    expect(c.status).toBe('active')
    expect(c.favorite).toBe(false)

    const next = svc.update(c.id, { favorite: true, status: 'paused', platform: 'tiktok' })
    expect(next.favorite).toBe(true)
    expect(next.status).toBe('paused')
    expect(next.platform).toBe('tiktok')

    // omitting them on a later patch preserves stored values
    const after = svc.update(c.id, { niche: 'Fitness' })
    expect(after.favorite).toBe(true)
    expect(after.status).toBe('paused')
  })

  it('persists baseline fields via setBaseline', () => {
    const c = svc.create({ handle: '@withbaseline' })
    svc.setBaseline(c.id, { baselineLikes: 120, baselineSampleSize: 18, baselineUpdatedAt: 1_700_000_000_000 })
    const got = svc.get(c.id)!
    expect(got.baselineLikes).toBe(120)
    expect(got.baselineSampleSize).toBe(18)
    expect(got.baselineUpdatedAt).toBe(1_700_000_000_000)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/competitors/competitors-service.test.ts --maxWorkers=2`
Expected: FAIL — `platform`/`status`/`favorite` undefined and `svc.setBaseline` not a function.

- [ ] **Step 3: Extend the repo**

In `packages/conversation/src/db/repositories/competitors-repo.ts`:

Add to the `Competitor` interface (after `level?`):

```ts
  platform: string
  status: 'active' | 'paused' | 'archived'
  favorite: boolean
  baselineLikes?: number
  baselineSampleSize?: number
  baselineUpdatedAt?: number
```

Add to the `Row` interface (after `level`):

```ts
  platform: string
  status: string
  favorite: number
  baseline_likes: number | null
  baseline_sample_size: number | null
  baseline_updated_at: number | null
```

Add to `toCompetitor` (after the `level:` line):

```ts
    platform: r.platform ?? 'instagram',
    status: (r.status as Competitor['status']) ?? 'active',
    favorite: Boolean(r.favorite),
    baselineLikes: r.baseline_likes ?? undefined,
    baselineSampleSize: r.baseline_sample_size ?? undefined,
    baselineUpdatedAt: r.baseline_updated_at ?? undefined,
```

Replace the `insert` SQL + params to include the columns. New column list and values:

```ts
  insert(c: Competitor): void {
    this.db.prepare(`
      INSERT INTO competitors (
        id, handle, project_id, display_name, niche, tint, followers, avg_likes,
        post_count, last_refreshed_at, notes, bio, level,
        platform, status, favorite, baseline_likes, baseline_sample_size, baseline_updated_at,
        added_at, updated_at, deleted_at
      ) VALUES (
        @id, @handle, @projectId, @displayName, @niche, @tint, @followers, @avgLikes,
        @postCount, @lastRefreshedAt, @notes, @bio, @level,
        @platform, @status, @favorite, @baselineLikes, @baselineSampleSize, @baselineUpdatedAt,
        @addedAt, @updatedAt, @deletedAt
      )
    `).run({
      id: c.id,
      handle: c.handle,
      projectId: c.projectId ?? 'default',
      displayName: c.displayName ?? null,
      niche: c.niche ?? null,
      tint: c.tint ?? null,
      followers: c.followers ?? null,
      avgLikes: c.avgLikes ?? null,
      postCount: c.postCount,
      lastRefreshedAt: c.lastRefreshedAt ?? null,
      notes: c.notes ?? null,
      bio: c.bio ?? null,
      level: c.level ?? null,
      platform: c.platform ?? 'instagram',
      status: c.status ?? 'active',
      favorite: c.favorite ? 1 : 0,
      baselineLikes: c.baselineLikes ?? null,
      baselineSampleSize: c.baselineSampleSize ?? null,
      baselineUpdatedAt: c.baselineUpdatedAt ?? null,
      addedAt: c.addedAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    })
  }
```

Replace the `update` SQL + bound params to include the new columns:

```ts
    this.db
      .prepare(`
        UPDATE competitors SET
          display_name = ?, niche = ?, tint = ?, followers = ?,
          avg_likes = ?, post_count = ?, last_refreshed_at = ?, notes = ?,
          bio = ?, level = ?, platform = ?, status = ?, favorite = ?,
          baseline_likes = ?, baseline_sample_size = ?, baseline_updated_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.displayName ?? null,
        next.niche ?? null,
        next.tint ?? null,
        next.followers ?? null,
        next.avgLikes ?? null,
        next.postCount,
        next.lastRefreshedAt ?? null,
        next.notes ?? null,
        next.bio ?? null,
        next.level ?? null,
        next.platform ?? 'instagram',
        next.status ?? 'active',
        next.favorite ? 1 : 0,
        next.baselineLikes ?? null,
        next.baselineSampleSize ?? null,
        next.baselineUpdatedAt ?? null,
        next.updatedAt,
        id,
      )
```

- [ ] **Step 4: Extend the service**

In `packages/conversation/src/competitors/competitors-service.ts`:

Add the new optional fields to the service's `CreateCompetitorInput` (after `level?`):

```ts
  platform?: string
  status?: 'active' | 'paused' | 'archived'
  favorite?: boolean
```

and to `UpdateCompetitorInput` (after `level?`):

```ts
  platform?: string
  status?: 'active' | 'paused' | 'archived'
  favorite?: boolean
```

In `create()`, set defaults on the new `Competitor` object (after the `level:` line):

```ts
      platform: input.platform ?? 'instagram',
      status: input.status ?? 'active',
      favorite: input.favorite ?? false,
```

In `update()`, thread the new fields through the patch object passed to `this.repo.update` (after the `level:` line):

```ts
      platform: patch.platform ?? existing.platform,
      status: patch.status ?? existing.status,
      favorite: patch.favorite ?? existing.favorite,
```

Add a `setBaseline` method (after `markRefreshedAt`):

```ts
  /**
   * Persist a recomputed performance baseline. Owned by the Research flow and
   * kept off the open update() surface so it can't be spoofed by clients.
   */
  setBaseline(
    id: string,
    baseline: { baselineLikes: number | null; baselineSampleSize: number; baselineUpdatedAt: number },
  ): void {
    this.repo.update(id, {
      baselineLikes: baseline.baselineLikes ?? undefined,
      baselineSampleSize: baseline.baselineSampleSize,
      baselineUpdatedAt: baseline.baselineUpdatedAt,
    })
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/competitors/competitors-service.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/db/repositories/competitors-repo.ts packages/conversation/src/competitors/competitors-service.ts packages/conversation/tests/competitors/competitors-service.test.ts
git commit -m "feat(conversation): competitor platform/status/favorite + baseline persistence"
```

---

### Task 7: Backend competitor routes accept the new fields

**Files:**
- Modify: `packages/backend/src/competitors.ts:7-30`
- Test: covered by the research route test (Task 13); add a focused assertion here.

- [ ] **Step 1: Extend the Zod bodies**

In `packages/backend/src/competitors.ts`, add to `CreateBody` (before the closing `}).strict()`):

```ts
  platform: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  favorite: z.boolean().optional(),
```

Add the same three lines to `UpdateBody` (before its closing `}).strict()`).

- [ ] **Step 2: Build the dependency chain and typecheck the backend**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend typecheck`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/competitors.ts
git commit -m "feat(backend): accept platform/status/favorite on competitor routes"
```

---

## Group 3 — Research session & candidate store

### Task 8: Migration 024 — research tables

**Files:**
- Create: `packages/conversation/src/db/migrations/024_research_tables.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/conversation/src/db/migrations/024_research_tables.sql`:

```sql
CREATE TABLE research_sessions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  controls    TEXT NOT NULL,                       -- JSON ResearchControls
  status      TEXT NOT NULL,                       -- 'scoring'|'validating'|'done'|'error'
  counts      TEXT,                                -- JSON ResearchSessionCounts
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_research_sessions_project
  ON research_sessions(project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE research_candidates (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  session_id          TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  competitor_id       TEXT NOT NULL REFERENCES competitors(id),
  post_id             TEXT NOT NULL REFERENCES captured_posts(id),
  platform            TEXT,
  post_url            TEXT,
  posted_at           TEXT,
  caption             TEXT,
  media_kind          TEXT,
  likes               INTEGER,
  baseline_likes      INTEGER,
  score               REAL,
  competitor_level    TEXT,
  candidate_level     TEXT,
  niche_aligned       INTEGER,                     -- 1|0|NULL(pending)
  niche_reason        TEXT,
  validation_status   TEXT NOT NULL,               -- 'valid'|'invalid'|'pending'
  validation_failures TEXT,                        -- JSON array of rule keys
  decision            TEXT NOT NULL DEFAULT 'none',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  UNIQUE(session_id, post_id)
);

CREATE INDEX idx_research_candidates_session
  ON research_candidates(session_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_research_candidates_project
  ON research_candidates(project_id, validation_status)
  WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, add after the `load(23, ...)` line:

```ts
  load(24, '024_research_tables.sql'),
```

- [ ] **Step 3: Verify it applies**

Run: `pnpm vitest run packages/conversation/tests/db/migrate.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/db/migrations/024_research_tables.sql packages/conversation/src/db/migrations/index.ts
git commit -m "feat(conversation): migration 024 — research sessions & candidates"
```

---

### Task 9: Research repos

Plain data-access repos following the `captured-posts-repo.ts` style. They are exercised by the `ResearchService` test (Task 11), so no standalone repo test.

**Files:**
- Create: `packages/conversation/src/db/repositories/research-sessions-repo.ts`
- Create: `packages/conversation/src/db/repositories/research-candidates-repo.ts`

- [ ] **Step 1: Write the sessions repo**

Create `packages/conversation/src/db/repositories/research-sessions-repo.ts`:

```ts
import type {
  ResearchControls,
  ResearchSessionCounts,
  ResearchSessionStatus,
} from '@anubis/shared'
import type { Db } from '../client.js'

export interface ResearchSession {
  id: string
  projectId?: string
  controls: ResearchControls
  status: ResearchSessionStatus
  counts?: ResearchSessionCounts
  error?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface Row {
  id: string
  project_id: string | null
  controls: string
  status: string
  counts: string | null
  error: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toSession(r: Row): ResearchSession {
  return {
    id: r.id,
    projectId: r.project_id ?? undefined,
    controls: JSON.parse(r.controls) as ResearchControls,
    status: r.status as ResearchSessionStatus,
    counts: r.counts ? (JSON.parse(r.counts) as ResearchSessionCounts) : undefined,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ResearchSessionsRepo {
  constructor(private db: Db) {}

  insert(s: ResearchSession): void {
    this.db.prepare(`
      INSERT INTO research_sessions (id, project_id, controls, status, counts, error, created_at, updated_at, deleted_at)
      VALUES (@id, @projectId, @controls, @status, @counts, @error, @createdAt, @updatedAt, @deletedAt)
    `).run({
      id: s.id,
      projectId: s.projectId ?? 'default',
      controls: JSON.stringify(s.controls),
      status: s.status,
      counts: s.counts ? JSON.stringify(s.counts) : null,
      error: s.error ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      deletedAt: s.deletedAt ?? null,
    })
  }

  findById(id: string): ResearchSession | null {
    const r = this.db
      .prepare('SELECT * FROM research_sessions WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return r ? toSession(r) : null
  }

  list(projectId?: string): ResearchSession[] {
    const sql = projectId
      ? 'SELECT * FROM research_sessions WHERE deleted_at IS NULL AND project_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM research_sessions WHERE deleted_at IS NULL ORDER BY created_at DESC'
    const rows = (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as Row[]
    return rows.map(toSession)
  }

  update(id: string, patch: Partial<Pick<ResearchSession, 'status' | 'counts' | 'error'>>): ResearchSession | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: ResearchSession = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE research_sessions SET status = ?, counts = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(
      next.status,
      next.counts ? JSON.stringify(next.counts) : null,
      next.error ?? null,
      next.updatedAt,
      id,
    )
    return next
  }
}
```

- [ ] **Step 2: Write the candidates repo**

Create `packages/conversation/src/db/repositories/research-candidates-repo.ts`:

```ts
import type {
  CandidateDecision,
  CandidateLevel,
  CandidateValidationRule,
  CandidateValidationStatus,
  CompetitorLevel,
} from '@anubis/shared'
import type { Db } from '../client.js'

export interface ResearchCandidate {
  id: string
  projectId?: string
  sessionId: string
  competitorId: string
  postId: string
  platform?: string
  postUrl?: string
  postedAt?: string
  caption?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  likes?: number
  baselineLikes?: number
  score?: number
  competitorLevel: CompetitorLevel
  candidateLevel: CandidateLevel
  nicheAligned?: boolean | null
  nicheReason?: string
  validationStatus: CandidateValidationStatus
  validationFailures: CandidateValidationRule[]
  decision: CandidateDecision
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface ListCandidatesOpts {
  sessionId?: string
  projectId?: string
  validationStatus?: CandidateValidationStatus
  candidateLevel?: CandidateLevel
  decision?: CandidateDecision
}

interface Row {
  id: string
  project_id: string | null
  session_id: string
  competitor_id: string
  post_id: string
  platform: string | null
  post_url: string | null
  posted_at: string | null
  caption: string | null
  media_kind: string | null
  likes: number | null
  baseline_likes: number | null
  score: number | null
  competitor_level: string | null
  candidate_level: string | null
  niche_aligned: number | null
  niche_reason: string | null
  validation_status: string
  validation_failures: string | null
  decision: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

function toCandidate(r: Row): ResearchCandidate {
  return {
    id: r.id,
    projectId: r.project_id ?? undefined,
    sessionId: r.session_id,
    competitorId: r.competitor_id,
    postId: r.post_id,
    platform: r.platform ?? undefined,
    postUrl: r.post_url ?? undefined,
    postedAt: r.posted_at ?? undefined,
    caption: r.caption ?? undefined,
    mediaKind: (r.media_kind as ResearchCandidate['mediaKind']) ?? undefined,
    likes: r.likes ?? undefined,
    baselineLikes: r.baseline_likes ?? undefined,
    score: r.score ?? undefined,
    competitorLevel: (r.competitor_level as CompetitorLevel) ?? 'unknown',
    candidateLevel: (r.candidate_level as CandidateLevel) ?? 'neutral',
    nicheAligned: r.niche_aligned == null ? null : r.niche_aligned === 1,
    nicheReason: r.niche_reason ?? undefined,
    validationStatus: r.validation_status as CandidateValidationStatus,
    validationFailures: r.validation_failures
      ? (JSON.parse(r.validation_failures) as CandidateValidationRule[])
      : [],
    decision: r.decision as CandidateDecision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? undefined,
  }
}

export class ResearchCandidatesRepo {
  constructor(private db: Db) {}

  insertMany(candidates: ResearchCandidate[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO research_candidates (
        id, project_id, session_id, competitor_id, post_id, platform, post_url, posted_at,
        caption, media_kind, likes, baseline_likes, score, competitor_level, candidate_level,
        niche_aligned, niche_reason, validation_status, validation_failures, decision,
        created_at, updated_at, deleted_at
      ) VALUES (
        @id, @projectId, @sessionId, @competitorId, @postId, @platform, @postUrl, @postedAt,
        @caption, @mediaKind, @likes, @baselineLikes, @score, @competitorLevel, @candidateLevel,
        @nicheAligned, @nicheReason, @validationStatus, @validationFailures, @decision,
        @createdAt, @updatedAt, @deletedAt
      )
    `)
    const tx = this.db.transaction((items: ResearchCandidate[]) => {
      for (const c of items) {
        stmt.run({
          id: c.id,
          projectId: c.projectId ?? 'default',
          sessionId: c.sessionId,
          competitorId: c.competitorId,
          postId: c.postId,
          platform: c.platform ?? null,
          postUrl: c.postUrl ?? null,
          postedAt: c.postedAt ?? null,
          caption: c.caption ?? null,
          mediaKind: c.mediaKind ?? null,
          likes: c.likes ?? null,
          baselineLikes: c.baselineLikes ?? null,
          score: c.score ?? null,
          competitorLevel: c.competitorLevel,
          candidateLevel: c.candidateLevel,
          nicheAligned: c.nicheAligned == null ? null : c.nicheAligned ? 1 : 0,
          nicheReason: c.nicheReason ?? null,
          validationStatus: c.validationStatus,
          validationFailures: JSON.stringify(c.validationFailures),
          decision: c.decision,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          deletedAt: c.deletedAt ?? null,
        })
      }
    })
    tx(candidates)
  }

  findById(id: string): ResearchCandidate | null {
    const r = this.db
      .prepare('SELECT * FROM research_candidates WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    return r ? toCandidate(r) : null
  }

  list(opts: ListCandidatesOpts = {}): ResearchCandidate[] {
    const where: string[] = ['deleted_at IS NULL']
    const params: unknown[] = []
    if (opts.sessionId) { where.push('session_id = ?'); params.push(opts.sessionId) }
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId) }
    if (opts.validationStatus) { where.push('validation_status = ?'); params.push(opts.validationStatus) }
    if (opts.candidateLevel) { where.push('candidate_level = ?'); params.push(opts.candidateLevel) }
    if (opts.decision) { where.push('decision = ?'); params.push(opts.decision) }
    const sql = `SELECT * FROM research_candidates WHERE ${where.join(' AND ')} ORDER BY score DESC, created_at DESC`
    const rows = this.db.prepare(sql).all(...params) as Row[]
    return rows.map(toCandidate)
  }

  update(
    id: string,
    patch: Partial<Pick<ResearchCandidate, 'decision' | 'nicheAligned' | 'nicheReason' | 'validationStatus' | 'validationFailures'>>,
  ): ResearchCandidate | null {
    const cur = this.findById(id)
    if (!cur) return null
    const next: ResearchCandidate = { ...cur, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE research_candidates SET
        decision = ?, niche_aligned = ?, niche_reason = ?,
        validation_status = ?, validation_failures = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.decision,
      next.nicheAligned == null ? null : next.nicheAligned ? 1 : 0,
      next.nicheReason ?? null,
      next.validationStatus,
      JSON.stringify(next.validationFailures),
      next.updatedAt,
      id,
    )
    return next
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: succeeds (repos compile against the shared types built in Task 4).

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/db/repositories/research-sessions-repo.ts packages/conversation/src/db/repositories/research-candidates-repo.ts
git commit -m "feat(conversation): research sessions & candidates repos"
```

---

### Task 10: ResearchService — build, score, validate

The orchestrator. Builds candidates from **already-captured posts** (the crawl is triggered separately via the existing capture endpoints — see the frontend plan), recomputes each competitor's median baseline, scores each post, evaluates validation (niche unresolved → `pending`), and persists.

**Files:**
- Create: `packages/conversation/src/research/research-service.ts`
- Test: `packages/conversation/tests/research/research-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/conversation/tests/research/research-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { CompetitorsRepo } from '../../src/db/repositories/competitors-repo.js'
import { CompetitorsService } from '../../src/competitors/competitors-service.js'
import { CapturedPostsRepo } from '../../src/db/repositories/captured-posts-repo.js'
import { ResearchSessionsRepo } from '../../src/db/repositories/research-sessions-repo.js'
import { ResearchCandidatesRepo } from '../../src/db/repositories/research-candidates-repo.js'
import { ResearchService } from '../../src/research/research-service.js'

describe('ResearchService', () => {
  let db: Db
  let competitors: CompetitorsService
  let posts: CapturedPostsRepo
  let svc: ResearchService

  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    competitors = new CompetitorsService(new CompetitorsRepo(db))
    posts = new CapturedPostsRepo(db)
    svc = new ResearchService({
      competitors,
      capturedPosts: posts,
      sessions: new ResearchSessionsRepo(db),
      candidates: new ResearchCandidatesRepo(db),
    })
  })

  function seedGreenCompetitorWithPosts() {
    const c = competitors.create({ handle: '@green', followers: 25_000 }) // green tier
    // baseline pool: likes mostly ~50, one viral 1000 → median 50
    const likes = [40, 45, 50, 50, 55, 60, 1000]
    likes.forEach((n, i) => posts.upsert({
      id: `p${i}`,
      competitorId: c.id,
      username: 'green',
      postUrl: `https://www.instagram.com/p/g${i}/`,
      likes: n,
      postedAt: isoDaysAgo(1),
      capturedAt: Date.now(),
    }))
    return c
  }

  it('recomputes a median baseline and scores candidates by competitor level', async () => {
    const c = seedGreenCompetitorWithPosts()
    const { session, candidates } = await svc.createSession({ projectId: 'default', controls: {} })

    // baseline persisted on the competitor (median of the 7 likes = 50)
    expect(competitors.get(c.id)!.baselineLikes).toBe(50)
    expect(session.status).toBe('done')

    // the viral 1000-like post → score 20 on a green competitor → green candidate
    const viral = candidates.find((x) => x.likes === 1000)!
    expect(viral.score).toBe(20)
    expect(viral.candidateLevel).toBe('green')
    // niche unresolved in Phase A → pending (recency/score/source all pass)
    expect(viral.validationStatus).toBe('pending')

    // a typical 50-like post → score 1 → neutral
    const typical = candidates.find((x) => x.likes === 50)!
    expect(typical.candidateLevel).toBe('neutral')
  })

  it('marks old posts invalid on recency', async () => {
    const c = competitors.create({ handle: '@stale', followers: 25_000 })
    posts.upsert({ id: 'old1', competitorId: c.id, username: 'stale', postUrl: 'https://www.instagram.com/p/old1/', likes: 500, postedAt: isoDaysAgo(30), capturedAt: Date.now() })
    posts.upsert({ id: 'old2', competitorId: c.id, username: 'stale', postUrl: 'https://www.instagram.com/p/old2/', likes: 60, postedAt: isoDaysAgo(30), capturedAt: Date.now() })
    const { candidates } = await svc.createSession({ projectId: 'default', controls: { maxContentAgeDays: 7 } })
    expect(candidates.every((x) => x.validationStatus === 'invalid')).toBe(true)
    expect(candidates[0]!.validationFailures).toContain('recency')
  })

  it('updateCandidate sets the niche verdict and re-evaluates validation', async () => {
    seedGreenCompetitorWithPosts()
    const { candidates } = await svc.createSession({ projectId: 'default', controls: {} })
    const fresh = candidates.find((x) => x.validationStatus === 'pending')!
    const updated = svc.updateCandidate(fresh.id, { nicheAligned: true })!
    expect(updated.nicheAligned).toBe(true)
    expect(updated.validationStatus).toBe('valid')

    const rejected = svc.updateCandidate(fresh.id, { nicheAligned: false })!
    expect(rejected.validationStatus).toBe('invalid')
    expect(rejected.validationFailures).toContain('niche')
  })

  it('respects favoriteOnly and explicit competitorIds filters', async () => {
    const fav = competitors.create({ handle: '@fav', followers: 25_000, favorite: true })
    const other = competitors.create({ handle: '@other', followers: 25_000 })
    for (const c of [fav, other]) {
      posts.upsert({ id: `${c.handle}-1`, competitorId: c.id, username: c.handle, postUrl: `https://www.instagram.com/p/${c.id}/`, likes: 100, postedAt: isoDaysAgo(1), capturedAt: Date.now() })
    }
    const { candidates } = await svc.createSession({ projectId: 'default', controls: { favoriteOnly: true } })
    expect(candidates.every((x) => x.competitorId === fav.id)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/research/research-service.test.ts --maxWorkers=2`
Expected: FAIL — `ResearchService` does not exist.

- [ ] **Step 3: Implement the service**

Create `packages/conversation/src/research/research-service.ts`:

```ts
import {
  effectiveLevel,
  evaluateCandidateValidation,
  getCandidateLevel,
  medianLikes,
  scoreFor,
  type CandidateValidationResult,
  type CreateResearchSessionInput,
  type ResearchControls,
  type ResearchSessionCounts,
} from '@anubis/shared'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { CompetitorsService } from '../competitors/competitors-service.js'
import type { Competitor } from '../db/repositories/competitors-repo.js'
import type { CapturedPostsRepo } from '../db/repositories/captured-posts-repo.js'
import { ResearchSessionsRepo, type ResearchSession } from '../db/repositories/research-sessions-repo.js'
import { ResearchCandidatesRepo, type ResearchCandidate } from '../db/repositories/research-candidates-repo.js'

const DEFAULT_MAX_POSTS = 20
const DEFAULT_MAX_AGE_DAYS = 7

export interface ResearchServiceDeps {
  competitors: CompetitorsService
  capturedPosts: CapturedPostsRepo
  sessions: ResearchSessionsRepo
  candidates: ResearchCandidatesRepo
}

export interface CreateSessionResult {
  session: ResearchSession
  candidates: ResearchCandidate[]
}

export class ResearchService {
  constructor(private deps: ResearchServiceDeps) {}

  async createSession(input: CreateResearchSessionInput): Promise<CreateSessionResult> {
    const projectId = input.projectId ?? 'default'
    const controls: ResearchControls = input.controls ?? {}
    const maxPosts = controls.maxPostsPerProfile ?? DEFAULT_MAX_POSTS
    const maxAgeDays = controls.maxContentAgeDays ?? DEFAULT_MAX_AGE_DAYS
    const now = nowMs()

    const session: ResearchSession = {
      id: newId(),
      projectId,
      controls,
      status: 'scoring',
      createdAt: now,
      updatedAt: now,
    }
    this.deps.sessions.insert(session)

    const eligible = this.selectCompetitors(projectId, controls)
    const built: ResearchCandidate[] = []

    for (const competitor of eligible) {
      const pool = this.deps.capturedPosts.list({
        competitorId: competitor.id,
        projectId,
        orderBy: 'recent',
        limit: maxPosts,
      })
      if (pool.length === 0) continue

      const baseline = medianLikes(pool.map((p) => p.likes ?? NaN))
      this.deps.competitors.setBaseline(competitor.id, {
        baselineLikes: baseline,
        baselineSampleSize: pool.length,
        baselineUpdatedAt: now,
      })

      const compLevel = effectiveLevel(competitor.level, competitor.followers)
      const competitorActive = competitor.status !== 'archived'

      for (const post of pool) {
        if (!withinDateRange(post.postedAt, controls)) continue
        const score = scoreFor(post.likes, baseline)
        const candidateLevel = score == null ? 'neutral' : getCandidateLevel(score, compLevel)
        const validation: CandidateValidationResult = evaluateCandidateValidation({
          postedAt: post.postedAt,
          baselineLikes: baseline,
          score,
          competitorActive,
          nicheAligned: null, // Phase A: manual niche, unresolved at build time
          maxContentAgeDays: maxAgeDays,
          nowMs: now,
        })
        built.push({
          id: newId(),
          projectId,
          sessionId: session.id,
          competitorId: competitor.id,
          postId: post.id,
          platform: competitor.platform,
          postUrl: post.postUrl,
          postedAt: post.postedAt,
          caption: post.caption,
          mediaKind: post.mediaKind,
          likes: post.likes,
          baselineLikes: baseline ?? undefined,
          score: score ?? undefined,
          competitorLevel: compLevel,
          candidateLevel,
          nicheAligned: null,
          validationStatus: validation.status,
          validationFailures: validation.failures,
          decision: 'none',
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    this.deps.candidates.insertMany(built)
    const counts = countCandidates(built)
    const updated = this.deps.sessions.update(session.id, { status: 'done', counts })!
    return { session: updated, candidates: built }
  }

  listSessions(projectId?: string): ResearchSession[] {
    return this.deps.sessions.list(projectId)
  }

  getSession(id: string): ResearchSession | null {
    return this.deps.sessions.findById(id)
  }

  listCandidates(opts: Parameters<ResearchCandidatesRepo['list']>[0]): ResearchCandidate[] {
    return this.deps.candidates.list(opts)
  }

  /** Update a candidate's decision and/or niche verdict; re-evaluate validation. */
  updateCandidate(
    id: string,
    patch: { decision?: ResearchCandidate['decision']; nicheAligned?: boolean | null; nicheReason?: string | null },
  ): ResearchCandidate | null {
    const cur = this.deps.candidates.findById(id)
    if (!cur) return null
    const session = this.deps.sessions.findById(cur.sessionId)
    const competitor = this.deps.competitors.get(cur.competitorId)
    const maxAgeDays = session?.controls.maxContentAgeDays ?? DEFAULT_MAX_AGE_DAYS

    const nicheAligned =
      patch.nicheAligned === undefined ? cur.nicheAligned : patch.nicheAligned
    const validation = evaluateCandidateValidation({
      postedAt: cur.postedAt,
      baselineLikes: cur.baselineLikes,
      score: cur.score,
      competitorActive: (competitor?.status ?? 'archived') !== 'archived',
      nicheAligned,
      maxContentAgeDays: maxAgeDays,
      nowMs: nowMs(),
    })

    return this.deps.candidates.update(id, {
      decision: patch.decision ?? cur.decision,
      nicheAligned,
      nicheReason: patch.nicheReason === undefined ? cur.nicheReason : (patch.nicheReason ?? undefined),
      validationStatus: validation.status,
      validationFailures: validation.failures,
    })
  }

  private selectCompetitors(projectId: string, controls: ResearchControls): Competitor[] {
    let list = this.deps.competitors.list(projectId)
    if (controls.competitorIds && controls.competitorIds.length > 0) {
      const wanted = new Set(controls.competitorIds)
      list = list.filter((c) => wanted.has(c.id))
    }
    if (controls.favoriteOnly) list = list.filter((c) => c.favorite)
    if (controls.platform) list = list.filter((c) => c.platform === controls.platform)
    if (controls.niche) list = list.filter((c) => c.niche === controls.niche)
    return list
  }
}

function withinDateRange(postedAt: string | undefined, controls: ResearchControls): boolean {
  if (!controls.dateFrom && !controls.dateTo) return true
  if (!postedAt) return false
  const t = Date.parse(postedAt)
  if (!Number.isFinite(t)) return false
  if (controls.dateFrom && t < Date.parse(controls.dateFrom)) return false
  if (controls.dateTo && t > Date.parse(controls.dateTo)) return false
  return true
}

function countCandidates(candidates: ResearchCandidate[]): ResearchSessionCounts {
  return {
    candidates: candidates.length,
    valid: candidates.filter((c) => c.validationStatus === 'valid').length,
    green: candidates.filter((c) => c.candidateLevel === 'green').length,
    yellow: candidates.filter((c) => c.candidateLevel === 'yellow').length,
    neutral: candidates.filter((c) => c.candidateLevel === 'neutral').length,
  }
}
```

> If `../util/time.js` has no `nowMs`, use `Date.now()` directly (the competitors service imports `nowMs` from `../util/time.js`, so it exists).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/research/research-service.test.ts --maxWorkers=2`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/research/research-service.ts packages/conversation/tests/research/research-service.test.ts
git commit -m "feat(conversation): ResearchService — build, score, validate candidates"
```

---

### Task 11: Wire ResearchService into the conversation stack

**Files:**
- Modify: `packages/conversation/src/index.ts`

- [ ] **Step 1: Add imports**

In `packages/conversation/src/index.ts`, after the `CapturedPostsRepo` import (line 17), add:

```ts
import { ResearchSessionsRepo } from './db/repositories/research-sessions-repo.js'
import { ResearchCandidatesRepo } from './db/repositories/research-candidates-repo.js'
import { ResearchService } from './research/research-service.js'
```

- [ ] **Step 2: Add to the `ConversationStack` interface**

After the `capturedPosts: CapturedPostsRepo` line (line 48):

```ts
  research: ResearchService
```

- [ ] **Step 3: Construct and expose it**

After `const capturedPosts = new CapturedPostsRepo(db)` (line 102):

```ts
  const research = new ResearchService({
    competitors,
    capturedPosts,
    sessions: new ResearchSessionsRepo(db),
    candidates: new ResearchCandidatesRepo(db),
  })
```

Add `research` to the `stack` object literal (alongside `competitors, capturedPosts, ...`, line 154):

```ts
    competitors, capturedPosts, research, contentItems, tasks,
```

- [ ] **Step 4: Export the public types**

Near the other repo exports (after line 186), add:

```ts
export type { ResearchSession } from './db/repositories/research-sessions-repo.js'
export type { ResearchCandidate, ListCandidatesOpts } from './db/repositories/research-candidates-repo.js'
export { ResearchService } from './research/research-service.js'
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @anubis/conversation typecheck && pnpm --filter @anubis/conversation build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/index.ts
git commit -m "feat(conversation): expose ResearchService on the stack"
```

---

### Task 12: Backend research routes

**Files:**
- Create: `packages/backend/src/research.ts`
- Modify: `packages/backend/src/app.ts` (import + mount)

- [ ] **Step 1: Write the routes**

Create `packages/backend/src/research.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const ControlsSchema = z.object({
  competitorIds: z.array(z.string().min(1)).optional(),
  favoriteOnly: z.boolean().optional(),
  platform: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  dateFrom: z.string().min(1).optional(),
  dateTo: z.string().min(1).optional(),
  maxPostsPerProfile: z.number().int().positive().max(200).optional(),
  maxContentAgeDays: z.number().int().positive().max(365).optional(),
}).strict()

const CreateSessionBody = z.object({
  projectId: z.string().min(1).optional(),
  controls: ControlsSchema.optional(),
}).strict()

const UpdateCandidateBody = z.object({
  decision: z.enum(['none', 'selected', 'rejected', 'saved']).optional(),
  nicheAligned: z.boolean().nullable().optional(),
  nicheReason: z.string().nullable().optional(),
}).strict()

export const researchRoutes = new Hono()

// Static segments before parameterised ones (Hono resolves by registration order).
researchRoutes.post('/sessions', async (c) => {
  const body = CreateSessionBody.parse(await c.req.json())
  const { session, candidates } = await getStack().research.createSession(body)
  return c.json({ ok: true, session, candidates }, 201)
})

researchRoutes.get('/sessions', (c) => {
  const projectId = c.req.query('projectId')
  return c.json({ ok: true, items: getStack().research.listSessions(projectId) })
})

researchRoutes.get('/sessions/:id/candidates', (c) => {
  const items = getStack().research.listCandidates({ sessionId: c.req.param('id') })
  return c.json({ ok: true, items })
})

researchRoutes.get('/sessions/:id', (c) => {
  const session = getStack().research.getSession(c.req.param('id'))
  if (!session) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, session })
})

researchRoutes.get('/candidates', (c) => {
  const items = getStack().research.listCandidates({
    projectId: c.req.query('projectId'),
    validationStatus: c.req.query('validation') as never,
    candidateLevel: c.req.query('level') as never,
    decision: c.req.query('decision') as never,
  })
  return c.json({ ok: true, items })
})

researchRoutes.patch('/candidates/:id', async (c) => {
  const body = UpdateCandidateBody.parse(await c.req.json())
  const updated = getStack().research.updateCandidate(c.req.param('id'), body)
  if (!updated) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, candidate: updated })
})
```

- [ ] **Step 2: Mount the routes**

In `packages/backend/src/app.ts`, add the import after the `snapshotRoutes` import (line 24):

```ts
import { researchRoutes } from './research.js'
```

and mount it after the `/snapshot` route (line 75):

```ts
app.route('/research', researchRoutes)
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/research.ts packages/backend/src/app.ts
git commit -m "feat(backend): /research routes (sessions, candidates)"
```

---

### Task 13: Backend route integration test

**Files:**
- Create: `packages/backend/tests/research-routes.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/backend/tests/research-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-research-'))
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

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('research routes', () => {
  it('runs a session, scores candidates, and updates a niche verdict', async () => {
    const app = await loadApp()

    const comp = await app.request('/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@routetest', projectId: 'default', followers: 25_000, favorite: true }),
    }).then((r) => r.json()) as { competitor: { id: string } }
    const competitorId = comp.competitor.id

    // Three typical posts (~50) + one viral (1000) → median baseline = 50,
    // so the viral post scores 1000/50 = 20.
    await app.request('/posts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        posts: [
          { id: 'rp1', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp1/', likes: 50, postedAt: isoDaysAgo(1) },
          { id: 'rp2', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp2/', likes: 50, postedAt: isoDaysAgo(1) },
          { id: 'rp3', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp3/', likes: 50, postedAt: isoDaysAgo(1) },
          { id: 'rp4', competitorId, username: 'routetest', postUrl: 'https://www.instagram.com/p/rp4/', likes: 1000, postedAt: isoDaysAgo(1) },
        ],
      }),
    })

    const created = await app.request('/research/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', controls: { favoriteOnly: true } }),
    })
    expect(created.status).toBe(201)
    const body = await created.json() as {
      session: { id: string; status: string; counts: { candidates: number } }
      candidates: Array<{ id: string; likes: number; score?: number; candidateLevel: string; validationStatus: string }>
    }
    expect(body.session.status).toBe('done')
    expect(body.session.counts.candidates).toBe(4)

    const viral = body.candidates.find((x) => x.likes === 1000)!
    expect(viral.score).toBe(20)
    expect(viral.candidateLevel).toBe('green')
    expect(viral.validationStatus).toBe('pending')

    const patched = await app.request(`/research/candidates/${viral.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nicheAligned: true, decision: 'saved' }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = await patched.json() as { candidate: { validationStatus: string; decision: string } }
    expect(patchedBody.candidate.validationStatus).toBe('valid')
    expect(patchedBody.candidate.decision).toBe('saved')

    const listed = await app.request(`/research/sessions/${body.session.id}/candidates`).then((r) => r.json()) as { items: unknown[] }
    expect(listed.items).toHaveLength(4)

    const validOnly = await app.request('/research/candidates?projectId=default&validation=valid').then((r) => r.json()) as { items: unknown[] }
    expect(validOnly.items).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Build dependencies and run the test**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build && pnpm vitest run packages/backend/tests/research-routes.test.ts --maxWorkers=2`
Expected: PASS. (If `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3` first.)

- [ ] **Step 3: Commit**

```bash
git add packages/backend/tests/research-routes.test.ts
git commit -m "test(backend): research routes integration"
```

---

## Final verification

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: passes across every package. (Existing `multiplierRatingFor` / Competitors-page code is untouched and still compiles; only `DEFAULT_COMPETITOR_LEVELS` values changed.)

- [ ] **Step 2: Run the new + adjacent test files together**

Run:
```bash
pnpm vitest run packages/shared/tests/competitor-level.test.ts packages/shared/tests/candidate-score.test.ts packages/shared/tests/candidate-validation.test.ts packages/conversation/tests/competitors/competitors-service.test.ts packages/conversation/tests/research/research-service.test.ts packages/backend/tests/research-routes.test.ts --maxWorkers=2
```
Expected: all PASS.

- [ ] **Step 3: Sanity-check the existing level-multiplier tests still pass** (defaults changed)

Run: `pnpm vitest run packages/shared/tests/level-multiplier.test.ts packages/conversation/tests/config/app-config.test.ts --maxWorkers=2`
Expected: PASS. If `app-config.test.ts` asserted the old default `maxActive`/`yellowMax`, update those expectations to the new defaults (greenMax 40_000, yellowMax 1_000_000, maxActive 1_000_000_000) and re-run.

---

## Spec coverage (self-review)

- §3 baseline (median) → Tasks 2, 6, 10. §3 scoring config update → Tasks 1, 2. §5 competitor `status` → Tasks 5–7.
- §4.1 competitor fields → Tasks 5–7. §4.2/§4.3 research tables → Tasks 8–9.
- §5 scoring/leveling library → Tasks 1–2. §6 validation → Tasks 3, 10.
- §8 routes → Task 12. `ResearchControls` → Task 4. §9 run flow (build/score/validate from stored posts; capture triggered separately) → Task 10.
- **Deferred to Plan 2 (frontend):** §7 niche AI step (Phase B), §10 page UI, re-pointing the Competitors page badges at `getCandidateLevel`, and the "capture fresh then create session" orchestration via existing capture endpoints.

---

## Next

Plan 2 (the Research Phase **page** + capture orchestration, then Phase B's AI niche step) is a separate document: `docs/superpowers/plans/2026-06-12-research-phase-frontend.md` (to be written after this plan lands).
