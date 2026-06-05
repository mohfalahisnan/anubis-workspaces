# Level Multiplier Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate each captured post by its viral multiplier (post likes ÷ competitor avgLikes), bucketed by the competitor's level into green/yellow/red/unrated, with editable thresholds in Settings, a per-post badge, and a Content-page filter.

**Architecture:** Config + pure computation live in `@anubis/shared` (mirroring the existing `competitorLevels` / `levelFor` pattern). The backend persists thresholds in `config.json` via `AppConfigService` and joins the competitor's `avgLikes` onto each post. The frontend reads thresholds through a `useLevelMultipliers` hook, renders a `PostMultiplierBadge`, and filters with a `PostMultiplierFilter`.

**Tech Stack:** TypeScript (ESM), React 19 + Vite + Tailwind v4, Hono + Zod backend, better-sqlite3 via the conversation package, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-level-multiplier-settings-design.md`

---

## File Structure

**Created:**
- `packages/shared/tests/level-multiplier.test.ts` — unit tests for the shared computation + validator.
- `packages/frontend/src/hooks/use-level-multipliers.ts` — module-cached hook distributing `LevelMultipliersConfig`.
- `packages/frontend/src/components/post-multiplier-badge.tsx` — per-post colored badge + multiplier value.
- `packages/frontend/src/components/post-multiplier-filter.tsx` — Content-page filter control + `matchesMultiplierFilter`.

**Modified:**
- `packages/shared/src/index.ts` — new types, defaults, `multiplierRatingFor`, `isValidLevelMultipliers`; add `levelMultipliers` to `AppConfig`; add `competitorAvgLikes` to `CapturedPostSummary`.
- `packages/conversation/src/config/app-config.ts` — `levelMultipliers` field + `sanitize` support.
- `packages/conversation/tests/config/app-config.test.ts` — tests for the new block.
- `packages/backend/src/config.ts` — Zod schema for `levelMultipliers` in `PatchBody`.
- `packages/backend/src/captures.ts` — join `competitorAvgLikes` onto post summaries (two spots).
- `packages/frontend/src/pages/settings.tsx` — "Level multipliers" section, dirty/validity wiring, save.
- `packages/frontend/src/pages/content.tsx` — badge on `PostCard`, filter control + filter logic.

---

## Task 1: Shared types, defaults, computation, validator

**Files:**
- Modify: `packages/shared/src/index.ts` (add after the competitor-levels block, around line 257)
- Test: `packages/shared/tests/level-multiplier.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/level-multiplier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LEVEL_MULTIPLIERS,
  isValidLevelMultipliers,
  multiplierRatingFor,
  type LevelMultipliersConfig,
} from '../src/index.js'

describe('multiplierRatingFor (default config)', () => {
  const cfg = DEFAULT_LEVEL_MULTIPLIERS

  it('is unrated when the competitor level is not green/yellow/red', () => {
    expect(multiplierRatingFor('black', 1000, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('unknown', 1000, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
  })

  it('is unrated when likes or avgLikes is missing or avgLikes <= 0', () => {
    expect(multiplierRatingFor('green', null, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('green', undefined, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('green', 100, null, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('green', 100, 0, cfg)).toEqual({ rating: 'unrated', multiplier: null })
  })

  it('green competitor: < 5x red, [5x,10x) yellow, >= 10x green', () => {
    expect(multiplierRatingFor('green', 49, 10, cfg).rating).toBe('red')   // 4.9x
    expect(multiplierRatingFor('green', 50, 10, cfg).rating).toBe('yellow') // 5x boundary
    expect(multiplierRatingFor('green', 99, 10, cfg).rating).toBe('yellow') // 9.9x
    expect(multiplierRatingFor('green', 100, 10, cfg).rating).toBe('green') // 10x boundary
  })

  it('yellow competitor: < 10x red, [10x,15x) yellow, >= 15x green', () => {
    expect(multiplierRatingFor('yellow', 99, 10, cfg).rating).toBe('red')
    expect(multiplierRatingFor('yellow', 100, 10, cfg).rating).toBe('yellow')
    expect(multiplierRatingFor('yellow', 150, 10, cfg).rating).toBe('green')
  })

  it('red competitor: < 15x red, [15x,20x) yellow, >= 20x green', () => {
    expect(multiplierRatingFor('red', 149, 10, cfg).rating).toBe('red')
    expect(multiplierRatingFor('red', 150, 10, cfg).rating).toBe('yellow')
    expect(multiplierRatingFor('red', 200, 10, cfg).rating).toBe('green')
  })

  it('returns the numeric multiplier alongside the rating', () => {
    expect(multiplierRatingFor('green', 123, 10, cfg).multiplier).toBeCloseTo(12.3)
  })
})

describe('isValidLevelMultipliers', () => {
  it('accepts the default config', () => {
    expect(isValidLevelMultipliers(DEFAULT_LEVEL_MULTIPLIERS)).toBe(true)
  })

  it('accepts fractional thresholds with min < good', () => {
    const cfg: LevelMultipliersConfig = {
      green: { min: 2.5, good: 5 },
      yellow: { min: 5, good: 7.5 },
      red: { min: 7.5, good: 10 },
    }
    expect(isValidLevelMultipliers(cfg)).toBe(true)
  })

  it('rejects when a band has min >= good', () => {
    expect(isValidLevelMultipliers({
      green: { min: 10, good: 10 },
      yellow: { min: 10, good: 15 },
      red: { min: 15, good: 20 },
    })).toBe(false)
  })

  it('rejects when any value is non-positive', () => {
    expect(isValidLevelMultipliers({
      green: { min: 0, good: 10 },
      yellow: { min: 10, good: 15 },
      red: { min: 15, good: 20 },
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/tests/level-multiplier.test.ts`
Expected: FAIL — `DEFAULT_LEVEL_MULTIPLIERS`, `isValidLevelMultipliers`, `multiplierRatingFor` are not exported.

- [ ] **Step 3: Implement in shared**

In `packages/shared/src/index.ts`, immediately after `isValidCompetitorLevels` (currently ends at line 257), add:

```typescript
/* ============================================================
   Level multipliers
   ============================================================
   Rates an individual captured post by its "viral multiplier"
   (post likes ÷ the owning competitor's avgLikes). The
   competitor's effective level selects a threshold band; the
   multiplier then buckets the post into green / yellow / red.
   Posts that can't be scored (competitor not green/yellow/red,
   or missing/zero avgLikes / missing likes) are 'unrated'.
   ============================================================ */

/** A threshold band: `min` is the yellow floor, `good` is the green floor. */
export interface MultiplierBand {
  min: number
  good: number
}

export interface LevelMultipliersConfig {
  green: MultiplierBand
  yellow: MultiplierBand
  red: MultiplierBand
}

export const DEFAULT_LEVEL_MULTIPLIERS: LevelMultipliersConfig = {
  green: { min: 5, good: 10 },
  yellow: { min: 10, good: 15 },
  red: { min: 15, good: 20 },
}

export type MultiplierRating = 'green' | 'yellow' | 'red' | 'unrated'

/** The competitor levels that carry a multiplier band. */
type RatedLevel = 'green' | 'yellow' | 'red'

function isRatedLevel(level: CompetitorLevel): level is RatedLevel {
  return level === 'green' || level === 'yellow' || level === 'red'
}

/**
 * Rate a post by post-likes ÷ competitor-avgLikes against the band
 * for the competitor's (effective) level. Pass the effective level so
 * a manual competitor override drives which band is used.
 */
export function multiplierRatingFor(
  competitorLevel: CompetitorLevel,
  postLikes: number | null | undefined,
  avgLikes: number | null | undefined,
  cfg: LevelMultipliersConfig = DEFAULT_LEVEL_MULTIPLIERS,
): { rating: MultiplierRating; multiplier: number | null } {
  if (!isRatedLevel(competitorLevel)) return { rating: 'unrated', multiplier: null }
  if (postLikes == null || avgLikes == null || avgLikes <= 0) {
    return { rating: 'unrated', multiplier: null }
  }
  const multiplier = postLikes / avgLikes
  const band = cfg[competitorLevel]
  if (multiplier >= band.good) return { rating: 'green', multiplier }
  if (multiplier >= band.min) return { rating: 'yellow', multiplier }
  return { rating: 'red', multiplier }
}

function isValidBand(band: MultiplierBand): boolean {
  return (
    Number.isFinite(band.min) &&
    Number.isFinite(band.good) &&
    band.min > 0 &&
    band.good > 0 &&
    band.min < band.good
  )
}

export function isValidLevelMultipliers(cfg: LevelMultipliersConfig): boolean {
  return isValidBand(cfg.green) && isValidBand(cfg.yellow) && isValidBand(cfg.red)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/tests/level-multiplier.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Rebuild shared so downstream packages see the new exports**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/tests/level-multiplier.test.ts
git commit -m "feat(shared): level multiplier config + post rating computation"
```

---

## Task 2: Add `levelMultipliers` to AppConfig type (shared)

**Files:**
- Modify: `packages/shared/src/index.ts:187-194` (the `AppConfig` interface)

- [ ] **Step 1: Add the field**

In `packages/shared/src/index.ts`, change the `AppConfig` interface (lines 187-194) from:

```typescript
export interface AppConfig {
  /** Path to chrome.exe / Chrome binary, when not on PATH. */
  chromePath?: string
  /** Optional research-crawler project/data root whose Chrome profiles should be reused. */
  crawlerProfileRoot?: string
  /** Follower-count bands that drive the competitor level badge. */
  competitorLevels?: CompetitorLevelsConfig
}
```

to:

```typescript
export interface AppConfig {
  /** Path to chrome.exe / Chrome binary, when not on PATH. */
  chromePath?: string
  /** Optional research-crawler project/data root whose Chrome profiles should be reused. */
  crawlerProfileRoot?: string
  /** Follower-count bands that drive the competitor level badge. */
  competitorLevels?: CompetitorLevelsConfig
  /** Viral-multiplier thresholds (post likes ÷ avgLikes) per competitor level. */
  levelMultipliers?: LevelMultipliersConfig
}
```

Note: `LevelMultipliersConfig` is declared later in the file (Task 1). TypeScript interface fields may reference a type declared later in the same module, so order is fine.

- [ ] **Step 2: Rebuild shared and typecheck**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add levelMultipliers to AppConfig"
```

---

## Task 3: Persist `levelMultipliers` in AppConfigService (conversation)

**Files:**
- Modify: `packages/conversation/src/config/app-config.ts`
- Test: `packages/conversation/tests/config/app-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/conversation/tests/config/app-config.test.ts` (inside the file, after the existing `describe` block at line 99):

```typescript
describe('AppConfigService — levelMultipliers', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cfg-mult-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const valid = {
    green: { min: 5, good: 10 },
    yellow: { min: 10, good: 15 },
    red: { min: 15, good: 20 },
  }

  it('accepts a valid levelMultipliers block and reloads it', () => {
    new AppConfigService(dir).update({ levelMultipliers: valid })
    const reloaded = new AppConfigService(dir).get()
    expect(reloaded.levelMultipliers).toEqual(valid)
  })

  it('accepts fractional thresholds', () => {
    const frac = {
      green: { min: 2.5, good: 5 },
      yellow: { min: 5, good: 7.5 },
      red: { min: 7.5, good: 10 },
    }
    const next = new AppConfigService(dir).update({ levelMultipliers: frac })
    expect(next.levelMultipliers).toEqual(frac)
  })

  it('drops the block when a band has min >= good', () => {
    const next = new AppConfigService(dir).update({
      levelMultipliers: {
        green: { min: 10, good: 10 },
        yellow: { min: 10, good: 15 },
        red: { min: 15, good: 20 },
      },
    })
    expect(next.levelMultipliers).toBeUndefined()
  })

  it('drops the block when any value is non-positive', () => {
    const next = new AppConfigService(dir).update({
      levelMultipliers: {
        green: { min: 0, good: 10 },
        yellow: { min: 10, good: 15 },
        red: { min: 15, good: 20 },
      },
    })
    expect(next.levelMultipliers).toBeUndefined()
  })

  it('drops the block when a level is missing', () => {
    const next = new AppConfigService(dir).update({
      // @ts-expect-error — deliberately incomplete to exercise sanitize
      levelMultipliers: { green: { min: 5, good: 10 } },
    })
    expect(next.levelMultipliers).toBeUndefined()
  })

  it('leaves competitorLevels untouched when updating levelMultipliers', () => {
    const svc = new AppConfigService(dir)
    svc.update({
      competitorLevels: { minActive: 1_000, greenMax: 10_000, yellowMax: 50_000, maxActive: 200_000 },
    })
    const next = svc.update({ levelMultipliers: valid })
    expect(next.competitorLevels?.greenMax).toBe(10_000)
    expect(next.levelMultipliers).toEqual(valid)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/conversation/tests/config/app-config.test.ts`
Expected: FAIL — `levelMultipliers` is always undefined (not yet sanitized/persisted).

- [ ] **Step 3: Implement the config support**

In `packages/conversation/src/config/app-config.ts`:

(a) Add the interfaces after `CompetitorLevelsConfig` (after line 30):

```typescript
export interface MultiplierBand {
  min: number
  good: number
}

export interface LevelMultipliersConfig {
  green: MultiplierBand
  yellow: MultiplierBand
  red: MultiplierBand
}
```

(b) Add the field to `AppConfig` (currently lines 32-36):

```typescript
export interface AppConfig {
  chromePath?: string
  crawlerProfileRoot?: string
  competitorLevels?: CompetitorLevelsConfig
  levelMultipliers?: LevelMultipliersConfig
}
```

(c) In `sanitize` (currently lines 71-80), add the multipliers branch before `return out`:

```typescript
function sanitize(obj: Record<string, unknown>): AppConfig {
  const out: AppConfig = {}
  const chromePath = typeof obj.chromePath === 'string' ? obj.chromePath.trim() : ''
  if (chromePath) out.chromePath = chromePath
  const crawlerProfileRoot = typeof obj.crawlerProfileRoot === 'string' ? obj.crawlerProfileRoot.trim() : ''
  if (crawlerProfileRoot) out.crawlerProfileRoot = crawlerProfileRoot
  const levels = sanitizeLevels(obj.competitorLevels)
  if (levels) out.competitorLevels = levels
  const multipliers = sanitizeMultipliers(obj.levelMultipliers)
  if (multipliers) out.levelMultipliers = multipliers
  return out
}
```

(d) Add the sanitizers after `sanitizeLevels` (after line 101) and a positive-number helper after `toPositiveInt` (after line 108):

```typescript
function sanitizeMultipliers(raw: unknown): LevelMultipliersConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const green = sanitizeBand(r.green)
  const yellow = sanitizeBand(r.yellow)
  const red = sanitizeBand(r.red)
  if (!green || !yellow || !red) return undefined
  return { green, yellow, red }
}

function sanitizeBand(raw: unknown): MultiplierBand | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const min = toPositiveNumber(r.min)
  const good = toPositiveNumber(r.good)
  if (min === undefined || good === undefined) return undefined
  if (!(min < good)) return undefined
  return { min, good }
}

function toPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return n > 0 ? n : undefined
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/conversation/tests/config/app-config.test.ts`
Expected: PASS (both the existing `competitorLevels` suite and the new `levelMultipliers` suite).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/config/app-config.ts packages/conversation/tests/config/app-config.test.ts
git commit -m "feat(conversation): persist + sanitize levelMultipliers in AppConfig"
```

---

## Task 4: Validate `levelMultipliers` in the backend config route

**Files:**
- Modify: `packages/backend/src/config.ts:21-32`

- [ ] **Step 1: Add the Zod schema and wire it into PatchBody**

In `packages/backend/src/config.ts`, after `CompetitorLevelsSchema` (ends line 26) add:

```typescript
const MultiplierBandSchema = z.object({
  min: z.number().positive(),
  good: z.number().positive(),
}).strict()

const LevelMultipliersSchema = z.object({
  green: MultiplierBandSchema,
  yellow: MultiplierBandSchema,
  red: MultiplierBandSchema,
}).strict()
```

Then change `PatchBody` (lines 28-32) to include the field:

```typescript
const PatchBody = z.object({
  chromePath: z.string().optional(),
  crawlerProfileRoot: z.string().optional(),
  competitorLevels: CompetitorLevelsSchema.optional(),
  levelMultipliers: LevelMultipliersSchema.optional(),
}).strict()
```

Note: like `competitorLevels`, the Zod layer only checks positivity; the `min < good` invariant is enforced (and invalid blocks dropped) by `sanitize` in the conversation package — no duplicate ordering check here.

- [ ] **Step 2: Typecheck the backend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/config.ts
git commit -m "feat(backend): accept levelMultipliers in PATCH /config"
```

---

## Task 5: Join `competitorAvgLikes` onto captured posts

**Files:**
- Modify: `packages/shared/src/index.ts:302-324` (`CapturedPostSummary`)
- Modify: `packages/backend/src/captures.ts:158-165` and `:229-236`

- [ ] **Step 1: Add the field to the summary type**

In `packages/shared/src/index.ts`, add to `CapturedPostSummary` after `competitorFollowers` (line 321), before `competitorLevel`:

```typescript
  /** Owning competitor's avgLikes, joined in by the route layer. */
  competitorAvgLikes?: number
```

- [ ] **Step 2: Rebuild shared**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no errors.

- [ ] **Step 3: Join the field in both backend spots**

In `packages/backend/src/captures.ts`, the list handler (lines 159-165) currently returns:

```typescript
    return {
      ...row,
      competitorHandle: owner?.handle,
      competitorTint: owner?.tint,
      competitorFollowers: owner?.followers,
      competitorLevel: owner?.level,
    }
```

Add the avgLikes line:

```typescript
    return {
      ...row,
      competitorHandle: owner?.handle,
      competitorTint: owner?.tint,
      competitorFollowers: owner?.followers,
      competitorAvgLikes: owner?.avgLikes,
      competitorLevel: owner?.level,
    }
```

And the single-post helper (lines 230-236) currently returns:

```typescript
  return {
    ...post,
    competitorHandle: owner?.handle,
    competitorTint: owner?.tint,
    competitorFollowers: owner?.followers,
    competitorLevel: owner?.level,
  }
```

Add the avgLikes line:

```typescript
  return {
    ...post,
    competitorHandle: owner?.handle,
    competitorTint: owner?.tint,
    competitorFollowers: owner?.followers,
    competitorAvgLikes: owner?.avgLikes,
    competitorLevel: owner?.level,
  }
```

- [ ] **Step 4: Typecheck the backend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/backend/src/captures.ts
git commit -m "feat: expose competitor avgLikes on captured post summaries"
```

---

## Task 6: `useLevelMultipliers` hook (frontend)

**Files:**
- Create: `packages/frontend/src/hooks/use-level-multipliers.ts`

- [ ] **Step 1: Create the hook (mirrors use-competitor-levels.ts)**

Create `packages/frontend/src/hooks/use-level-multipliers.ts`:

```typescript
import { useEffect, useState } from 'react'
import {
  DEFAULT_LEVEL_MULTIPLIERS,
  type LevelMultipliersConfig,
} from '@anubis/shared'
import { getAppConfig } from '@/api'

/* Module-local cache so multiple consumers (Content, Settings) share
   one fetch and re-render together when Settings saves a new config. */
let cached: LevelMultipliersConfig | null = null
const subscribers = new Set<(cfg: LevelMultipliersConfig) => void>()

function notify(next: LevelMultipliersConfig): void {
  cached = next
  for (const fn of subscribers) fn(next)
}

export function setLevelMultipliers(cfg: LevelMultipliersConfig): void {
  notify(cfg)
}

export function useLevelMultipliers(): LevelMultipliersConfig {
  const [config, setConfig] = useState<LevelMultipliersConfig>(
    cached ?? DEFAULT_LEVEL_MULTIPLIERS,
  )

  useEffect(() => {
    const sub = (next: LevelMultipliersConfig): void => setConfig(next)
    subscribers.add(sub)
    if (!cached) {
      void getAppConfig()
        .then((cfg) => notify(cfg.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS))
        .catch(() => notify(DEFAULT_LEVEL_MULTIPLIERS))
    }
    return () => {
      subscribers.delete(sub)
    }
  }, [])

  return config
}
```

- [ ] **Step 2: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors (the hook is unused so far, but must compile).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/use-level-multipliers.ts
git commit -m "feat(frontend): useLevelMultipliers config hook"
```

---

## Task 7: `PostMultiplierBadge` and `PostMultiplierFilter` components (frontend)

**Files:**
- Create: `packages/frontend/src/components/post-multiplier-badge.tsx`
- Create: `packages/frontend/src/components/post-multiplier-filter.tsx`

- [ ] **Step 1: Create the badge component**

Create `packages/frontend/src/components/post-multiplier-badge.tsx`:

```typescript
import type { CompetitorLevel, CompetitorLevelOverride, CompetitorLevelsConfig, LevelMultipliersConfig, MultiplierRating } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, DEFAULT_LEVEL_MULTIPLIERS, effectiveLevel, multiplierRatingFor } from '@anubis/shared'
import { cn } from '@/lib/utils'

const RATING_COLOR: Record<MultiplierRating, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  red: '#B5483E',
  unrated: '#6B6F78',
}

interface Props {
  likes: number | null | undefined
  competitorFollowers: number | null | undefined
  competitorAvgLikes: number | null | undefined
  competitorLevelOverride?: CompetitorLevelOverride | null
  levelsConfig?: CompetitorLevelsConfig
  multipliersConfig?: LevelMultipliersConfig
  className?: string
}

function tooltipFor(rating: MultiplierRating, multiplier: number | null, level: CompetitorLevel): string {
  if (rating === 'unrated') {
    if (level !== 'green' && level !== 'yellow' && level !== 'red') {
      return 'Unrated — competitor is out of range or has no level yet'
    }
    return 'Unrated — capture posts to get avgLikes'
  }
  return `${rating} — ${multiplier!.toFixed(1)}× avg likes (${level} competitor)`
}

export function PostMultiplierBadge({
  likes,
  competitorFollowers,
  competitorAvgLikes,
  competitorLevelOverride,
  levelsConfig,
  multipliersConfig,
  className,
}: Props) {
  const level = effectiveLevel(competitorLevelOverride, competitorFollowers, levelsConfig ?? DEFAULT_COMPETITOR_LEVELS)
  const { rating, multiplier } = multiplierRatingFor(
    level,
    likes,
    competitorAvgLikes,
    multipliersConfig ?? DEFAULT_LEVEL_MULTIPLIERS,
  )
  const tip = tooltipFor(rating, multiplier, level)
  return (
    <span
      aria-label={tip}
      title={tip}
      data-rating={rating}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[10px] tabular-nums',
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${RATING_COLOR[rating]} 50%, transparent)`,
        color: RATING_COLOR[rating],
      }}
    >
      <span aria-hidden className='size-1.5 rounded-full' style={{ background: RATING_COLOR[rating] }} />
      {multiplier === null ? '—' : `${multiplier.toFixed(1)}×`}
    </span>
  )
}
```

- [ ] **Step 2: Create the filter component (mirrors competitor-level-filter.tsx)**

Create `packages/frontend/src/components/post-multiplier-filter.tsx`:

```typescript
import type { MultiplierRating } from '@anubis/shared'
import { cn } from '@/lib/utils'

export type MultiplierFilter = MultiplierRating | 'all'

interface Option {
  value: MultiplierFilter
  label: string
  dot: string | null
}

const OPTIONS: Option[] = [
  { value: 'all', label: 'All', dot: null },
  { value: 'green', label: 'Green', dot: '#5E8F55' },
  { value: 'yellow', label: 'Yellow', dot: '#C9A645' },
  { value: 'red', label: 'Red', dot: '#B5483E' },
  { value: 'unrated', label: 'Unrated', dot: '#6B6F78' },
]

interface Props {
  value: MultiplierFilter
  onChange: (next: MultiplierFilter) => void
  className?: string
}

export function PostMultiplierFilter({ value, onChange, className }: Props) {
  return (
    <div
      role='radiogroup'
      aria-label='Filter by multiplier'
      className={cn('inline-flex flex-wrap items-center gap-1.5', className)}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
              active
                ? 'border-[var(--anubis-gold)] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {opt.dot && (
              <span
                aria-hidden
                className='size-2 rounded-full ring-1 ring-black/20'
                style={{ background: opt.dot }}
              />
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function matchesMultiplierFilter(rating: MultiplierRating, filter: MultiplierFilter): boolean {
  return filter === 'all' || filter === rating
}
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/post-multiplier-badge.tsx packages/frontend/src/components/post-multiplier-filter.tsx
git commit -m "feat(frontend): post multiplier badge + filter components"
```

---

## Task 8: Settings page — "Level multipliers" section

**Files:**
- Modify: `packages/frontend/src/pages/settings.tsx`

- [ ] **Step 1: Update imports**

In `packages/frontend/src/pages/settings.tsx`, change the shared import (lines 6-7) from:

```typescript
import type { AppConfig, CompetitorLevelsConfig } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, isValidCompetitorLevels } from '@anubis/shared'
```

to:

```typescript
import type { AppConfig, CompetitorLevelsConfig, LevelMultipliersConfig } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, DEFAULT_LEVEL_MULTIPLIERS, isValidCompetitorLevels, isValidLevelMultipliers } from '@anubis/shared'
```

And change the hook import (line 12) from:

```typescript
import { setCompetitorLevels } from '@/hooks/use-competitor-levels'
```

to:

```typescript
import { setCompetitorLevels } from '@/hooks/use-competitor-levels'
import { setLevelMultipliers } from '@/hooks/use-level-multipliers'
```

- [ ] **Step 2: Add derived state for multipliers**

In `settings.tsx`, after the `effectiveLevels` block (lines 37-38) add:

```typescript
  const effectiveMultipliers: LevelMultipliersConfig =
    form.levelMultipliers ?? config?.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS
```

Then change the dirty/valid block (lines 41-48) from:

```typescript
  const levelsDirty =
    config !== null &&
    JSON.stringify(form.competitorLevels ?? config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS) !==
    JSON.stringify(config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
  const levelsValid = isValidCompetitorLevels(effectiveLevels)

  const dirty = chromePathDirty || levelsDirty
  const canSave = dirty && levelsValid
```

to:

```typescript
  const levelsDirty =
    config !== null &&
    JSON.stringify(form.competitorLevels ?? config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS) !==
    JSON.stringify(config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
  const levelsValid = isValidCompetitorLevels(effectiveLevels)

  const multipliersDirty =
    config !== null &&
    JSON.stringify(form.levelMultipliers ?? config.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS) !==
    JSON.stringify(config.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS)
  const multipliersValid = isValidLevelMultipliers(effectiveMultipliers)

  const dirty = chromePathDirty || levelsDirty || multipliersDirty
  const canSave = dirty && levelsValid && multipliersValid
```

- [ ] **Step 3: Send + distribute multipliers on save**

In `handleSave` (lines 50-70), change the body from:

```typescript
      const next = await updateAppConfig({
        chromePath: form.chromePath ?? '',
        competitorLevels: form.competitorLevels ?? config?.competitorLevels,
      })
      setConfig(next)
      setForm((f) => ({
        ...f,
        chromePath: next.chromePath ?? '',
        competitorLevels: next.competitorLevels,
      }))
      setCompetitorLevels(next.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
      setBanner({ kind: 'success', message: 'Saved.' })
```

to:

```typescript
      const next = await updateAppConfig({
        chromePath: form.chromePath ?? '',
        competitorLevels: form.competitorLevels ?? config?.competitorLevels,
        levelMultipliers: form.levelMultipliers ?? config?.levelMultipliers,
      })
      setConfig(next)
      setForm((f) => ({
        ...f,
        chromePath: next.chromePath ?? '',
        competitorLevels: next.competitorLevels,
        levelMultipliers: next.levelMultipliers,
      }))
      setCompetitorLevels(next.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
      setLevelMultipliers(next.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS)
      setBanner({ kind: 'success', message: 'Saved.' })
```

- [ ] **Step 4: Add the section UI**

In `settings.tsx`, immediately after the closing `</section>` of the "Competitor levels" section (line 195) and before the closing `</div></div></div>`, insert:

```tsx
        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Level multipliers</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Per-post viral multiplier (<span className='font-mono'>post likes ÷ competitor avgLikes</span>) thresholds.
            For each competitor level: at or above <span className='font-mono'>min</span> is yellow, at or above <span className='font-mono'>good</span> is green; below <span className='font-mono'>min</span> is red.
          </p>

          <div className='mt-4 flex flex-col gap-3'>
            <MultiplierRow
              label='Green competitor'
              band={effectiveMultipliers.green}
              onChange={(band) => setForm((f) => ({ ...f, levelMultipliers: { ...effectiveMultipliers, green: band } }))}
            />
            <MultiplierRow
              label='Yellow competitor'
              band={effectiveMultipliers.yellow}
              onChange={(band) => setForm((f) => ({ ...f, levelMultipliers: { ...effectiveMultipliers, yellow: band } }))}
            />
            <MultiplierRow
              label='Red competitor'
              band={effectiveMultipliers.red}
              onChange={(band) => setForm((f) => ({ ...f, levelMultipliers: { ...effectiveMultipliers, red: band } }))}
            />
          </div>

          {!multipliersValid && (
            <p className='mt-3 text-[12px] text-destructive'>
              For each level, "min" and "good" must be &gt; 0 and min &lt; good.
            </p>
          )}
        </section>
```

- [ ] **Step 5: Add the MultiplierRow component**

In `settings.tsx`, after the `LevelInput` function (ends line 218), add:

```tsx
function MultiplierRow({
  label,
  band,
  onChange,
}: {
  label: string
  band: import('@anubis/shared').MultiplierBand
  onChange: (band: import('@anubis/shared').MultiplierBand) => void
}) {
  return (
    <div className='grid grid-cols-[1fr_auto_auto] items-end gap-3 sm:grid-cols-[160px_1fr_1fr]'>
      <span className='text-[12.5px] font-medium text-foreground'>{label}</span>
      <MultiplierInput
        label='Min (yellow)'
        value={band.min}
        onChange={(n) => onChange({ ...band, min: n })}
      />
      <MultiplierInput
        label='Good (green)'
        value={band.good}
        onChange={(n) => onChange({ ...band, good: n })}
      />
    </div>
  )
}

function MultiplierInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-[12px] text-muted-foreground'>{label}</span>
      <div className='relative'>
        <input
          type='number'
          min={0}
          step={0.5}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? Math.max(0, n) : 0)
          }}
          className='h-10 w-full rounded-md border border-border bg-card pl-3 pr-7 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
        />
        <span className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-muted-foreground'>×</span>
      </div>
    </label>
  )
}
```

- [ ] **Step 6: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/settings.tsx
git commit -m "feat(frontend): level multipliers settings section"
```

---

## Task 9: Content page — badge + filter wiring

**Files:**
- Modify: `packages/frontend/src/pages/content.tsx`

- [ ] **Step 1: Add imports**

In `packages/frontend/src/pages/content.tsx`, after the existing component imports (after line 34) add:

```typescript
import { PostMultiplierBadge } from '@/components/post-multiplier-badge'
import { PostMultiplierFilter, matchesMultiplierFilter, type MultiplierFilter } from '@/components/post-multiplier-filter'
import { useLevelMultipliers } from '@/hooks/use-level-multipliers'
```

And extend the shared import (line 26) from:

```typescript
import { effectiveLevel } from '@anubis/shared'
```

to:

```typescript
import { effectiveLevel, multiplierRatingFor } from '@anubis/shared'
```

- [ ] **Step 2: Add state + config**

In `ContentPage`, after `const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')` (line 239) add:

```typescript
  const [multiplierFilter, setMultiplierFilter] = useState<MultiplierFilter>('all')
```

And after `const { config: levelsCfg } = useCompetitorLevels()` (line 240) add:

```typescript
  const multipliersCfg = useLevelMultipliers()
```

- [ ] **Step 3: Apply the multiplier filter**

Change the `cards` filter chain (lines 411-423) from:

```typescript
  const cards = allCards
    .filter((card) => matchesFilters(card, {
      query,
      competitor: competitorFilter,
      dateFrom,
      dateTo,
    }))
    .filter((card) =>
      matchesLevelFilter(
        effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg),
        levelFilter,
      ),
    )
```

to:

```typescript
  const cards = allCards
    .filter((card) => matchesFilters(card, {
      query,
      competitor: competitorFilter,
      dateFrom,
      dateTo,
    }))
    .filter((card) =>
      matchesLevelFilter(
        effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg),
        levelFilter,
      ),
    )
    .filter((card) => {
      const level = effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg)
      const { rating } = multiplierRatingFor(level, card.post?.likes, card.post?.competitorAvgLikes, multipliersCfg)
      return matchesMultiplierFilter(rating, multiplierFilter)
    })
```

- [ ] **Step 4: Include the multiplier filter in `filtersActive` and Clear**

Change `filtersActive` (line 426) from:

```typescript
  const filtersActive = query || competitorFilter !== 'all' || dateFrom || dateTo || levelFilter !== 'all'
```

to:

```typescript
  const filtersActive = query || competitorFilter !== 'all' || dateFrom || dateTo || levelFilter !== 'all' || multiplierFilter !== 'all'
```

And in the Clear button handler (lines 564-570) add `setMultiplierFilter('all')` alongside `setLevelFilter('all')`:

```typescript
                onClick={() => {
                  setQuery('')
                  setCompetitorFilter('all')
                  setDateFrom('')
                  setDateTo('')
                  setLevelFilter('all')
                  setMultiplierFilter('all')
                }}
```

- [ ] **Step 5: Render the filter control**

Change the filter rail block (lines 609-611) from:

```tsx
          <div className='mt-2 px-1'>
            <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
          </div>
```

to:

```tsx
          <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1'>
            <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
            <PostMultiplierFilter value={multiplierFilter} onChange={setMultiplierFilter} />
          </div>
```

- [ ] **Step 6: Pass multipliers config into PostCard and render the badge**

`PostCard` already receives `levelsCfg`. Add a `multipliersCfg` prop. First, in the grid render (lines 633-645), add the prop to the `<PostCard>` usage:

```tsx
              <PostCard
                key={card.key}
                card={card}
                levelsCfg={levelsCfg}
                multipliersCfg={multipliersCfg}
                starred={!!stars[card.key]}
                onStar={() => toggleStar(card.key)}
                onEdit={card.post ? () => setEditingPost(card.post!) : undefined}
                onDelete={card.post ? () => void handleDeletePost(card.post!) : undefined}
                selectMode={selectMode}
                selected={card.post ? selected.has(card.post.id) : false}
                onToggleSelect={card.post ? () => toggleSelected(card.post!.id) : undefined}
              />
```

Then change the `PostCard` signature (lines 791-811) to accept it:

```tsx
function PostCard({
  card,
  starred,
  onStar,
  onEdit,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
  levelsCfg,
  multipliersCfg,
}: {
  card: CardModel
  starred: boolean
  onStar: () => void
  onEdit?: () => void
  onDelete?: () => void
  selectMode: boolean
  selected: boolean
  onToggleSelect?: () => void
  levelsCfg: import('@anubis/shared').CompetitorLevelsConfig
  multipliersCfg: import('@anubis/shared').LevelMultipliersConfig
}) {
```

Then render the badge next to the handle row. Change the handle row (lines 850-866) from:

```tsx
        <div className='flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-foreground'>
          <CompetitorLevelDot followers={card.post?.competitorFollowers} levelOverride={card.post?.competitorLevel} config={levelsCfg} />
          {card.postUrl ? (
            <a
              href={card.postUrl}
              target='_blank'
              rel='noreferrer'
              className='truncate hover:underline'
            >
              {card.handle}
            </a>
          ) : (
            <span className='truncate'>{card.handle}</span>
          )}
          <span className='text-muted-foreground'>·</span>
          <span className='shrink-0 text-muted-foreground'>{card.date}</span>
        </div>
```

to (adds the badge at the end of the row; only meaningful for real posts):

```tsx
        <div className='flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-foreground'>
          <CompetitorLevelDot followers={card.post?.competitorFollowers} levelOverride={card.post?.competitorLevel} config={levelsCfg} />
          {card.postUrl ? (
            <a
              href={card.postUrl}
              target='_blank'
              rel='noreferrer'
              className='truncate hover:underline'
            >
              {card.handle}
            </a>
          ) : (
            <span className='truncate'>{card.handle}</span>
          )}
          <span className='text-muted-foreground'>·</span>
          <span className='shrink-0 text-muted-foreground'>{card.date}</span>
          {card.post && (
            <PostMultiplierBadge
              className='ml-auto'
              likes={card.post.likes}
              competitorFollowers={card.post.competitorFollowers}
              competitorAvgLikes={card.post.competitorAvgLikes}
              competitorLevelOverride={card.post.competitorLevel}
              levelsConfig={levelsCfg}
              multipliersConfig={multipliersCfg}
            />
          )}
        </div>
```

- [ ] **Step 7: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/pages/content.tsx
git commit -m "feat(frontend): post multiplier badge + filter on Content page"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS, including the new `level-multiplier.test.ts` and the extended `app-config.test.ts`.

- [ ] **Step 2: Typecheck every package**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run: `pnpm dev`
Verify:
- Settings shows a "Level multipliers" section with green/yellow/red rows, each with Min/Good inputs defaulting to 5/10, 10/15, 15/20. Editing to an invalid band (min ≥ good) shows the red validation message and disables Save.
- Content page shows a multiplier badge (e.g. `12.3×`) on real captured post cards and an unrated `—` badge when the competitor has no avgLikes/level. The new multiplier filter narrows the grid.

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
git add -A
git commit -m "chore: level multiplier settings — verification pass"
```

---

## Notes for the implementer

- **Build order matters.** After any change to `packages/shared/src/index.ts`, run `pnpm --filter @anubis/shared build` before typechecking `backend`/`frontend`, since they consume shared's built output.
- **Multipliers are fractional.** Unlike `competitorLevels` (integers), multiplier thresholds use `Number.isFinite` + `> 0` (no `Math.floor`). Do not copy the integer helpers.
- **The `min < good` invariant** is enforced in two places only: `isValidLevelMultipliers` (shared, used by the Settings form) and `sanitizeMultipliers` (conversation, used on persist). The backend Zod schema deliberately checks positivity only, matching the existing `competitorLevels` pattern.
- **Effective level drives the band.** Always pass `effectiveLevel(override, followers, levelsCfg)` to `multiplierRatingFor` so a manual competitor-level override selects the right band.
