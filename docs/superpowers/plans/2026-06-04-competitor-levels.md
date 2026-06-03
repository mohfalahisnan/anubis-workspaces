# Competitor Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive a Black / Green / Yellow / Red / Unknown badge from each competitor's follower count using four user-tunable thresholds in `config.json`. Render the badge on competitor cards and content posts, and add a per-level filter on both pages.

**Architecture:** Levels are computed live on the frontend via a pure `levelFor()` function in `@anubis/shared`. Thresholds live in the existing per-machine `config.json` (no DB migration, no `level` column on `competitors`). The backend already round-trips the full `AppConfig`; we just extend the type, the conversation-side sanitizer, and the backend Zod validator. Posts already join the owning competitor's handle/tint at the route layer — we add `competitorFollowers` to that join so post cards can derive a level without a second lookup.

**Tech Stack:** TypeScript, Vitest (Node), React 19, Tailwind v4, Hono, Zod, pnpm monorepo.

**Spec:** [docs/superpowers/specs/2026-06-04-competitor-levels-design.md](docs/superpowers/specs/2026-06-04-competitor-levels-design.md)

---

## File Structure

**Create**
- `packages/shared/tests/competitor-level.test.ts` — unit tests for the pure derivation function
- `packages/conversation/tests/config/app-config.test.ts` — sanitizer tests for the new block
- `packages/frontend/src/hooks/use-competitor-levels.ts` — module-cached config loader + `levelFor` wrapper
- `packages/frontend/src/components/competitor-level-dot.tsx` — colored-dot badge with tooltip
- `packages/frontend/src/components/competitor-level-filter.tsx` — single-select filter chip group

**Modify**
- `packages/shared/src/index.ts` — add `CompetitorLevel`, `CompetitorLevelsConfig`, `DEFAULT_COMPETITOR_LEVELS`, `levelFor()`, extend `AppConfig`, add `competitorFollowers` to `CapturedPostSummary`
- `packages/conversation/src/config/app-config.ts` — extend `AppConfig` and `sanitize()` with the new block
- `packages/backend/src/config.ts` — extend `PatchBody` Zod schema with optional `competitorLevels`
- `packages/backend/src/captures.ts` — populate `competitorFollowers` in the two enrichment sites (lines 156–163 and `enrichPost` at 218–225)
- `packages/frontend/src/pages/settings.tsx` — new "Competitor levels" section
- `packages/frontend/src/pages/competitors.tsx` — badge on card + filter chip
- `packages/frontend/src/pages/content.tsx` — badge on post card + filter chip

---

## Task 1: Add shared types + pure `levelFor` (TDD)

**Files:**
- Modify: `packages/shared/src/index.ts` (add new exports near the existing `AppConfig` block around line 181)
- Create: `packages/shared/tests/competitor-level.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/shared/tests/competitor-level.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COMPETITOR_LEVELS,
  levelFor,
  type CompetitorLevelsConfig,
} from '../src/index.js'

describe('levelFor (default config)', () => {
  const cfg = DEFAULT_COMPETITOR_LEVELS

  it('returns "unknown" when followers is null or undefined', () => {
    expect(levelFor(null, cfg)).toBe('unknown')
    expect(levelFor(undefined, cfg)).toBe('unknown')
  })

  it('returns "black" below minActive', () => {
    expect(levelFor(0, cfg)).toBe('black')
    expect(levelFor(9_999, cfg)).toBe('black')
  })

  it('returns "green" at minActive and up to greenMax inclusive', () => {
    expect(levelFor(10_000, cfg)).toBe('green')
    expect(levelFor(25_000, cfg)).toBe('green')
    expect(levelFor(40_000, cfg)).toBe('green')
  })

  it('returns "yellow" above greenMax and up to yellowMax inclusive', () => {
    expect(levelFor(40_001, cfg)).toBe('yellow')
    expect(levelFor(75_000, cfg)).toBe('yellow')
    expect(levelFor(100_000, cfg)).toBe('yellow')
  })

  it('returns "red" above yellowMax and up to maxActive inclusive', () => {
    expect(levelFor(100_001, cfg)).toBe('red')
    expect(levelFor(500_000, cfg)).toBe('red')
    expect(levelFor(1_000_000, cfg)).toBe('red')
  })

  it('returns "black" above maxActive', () => {
    expect(levelFor(1_000_001, cfg)).toBe('black')
    expect(levelFor(50_000_000, cfg)).toBe('black')
  })

  it('uses default config when none is supplied', () => {
    expect(levelFor(25_000)).toBe('green')
  })
})

describe('isValidCompetitorLevels', () => {
  it('accepts the default config', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels(DEFAULT_COMPETITOR_LEVELS)).toBe(true)
  })

  it('rejects when bands are equal (greenMax === yellowMax)', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels({
      minActive: 1_000, greenMax: 50_000, yellowMax: 50_000, maxActive: 100_000,
    })).toBe(false)
  })

  it('rejects when any band is non-positive', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels({
      minActive: 0, greenMax: 10_000, yellowMax: 20_000, maxActive: 30_000,
    })).toBe(false)
  })

  it('rejects when bands are out of order', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels({
      minActive: 100_000, greenMax: 50_000, yellowMax: 200_000, maxActive: 500_000,
    })).toBe(false)
  })
})

describe('levelFor (custom config)', () => {
  const custom: CompetitorLevelsConfig = {
    minActive: 500,
    greenMax: 5_000,
    yellowMax: 50_000,
    maxActive: 500_000,
  }

  it('honours custom bands', () => {
    expect(levelFor(499, custom)).toBe('black')
    expect(levelFor(500, custom)).toBe('green')
    expect(levelFor(5_001, custom)).toBe('yellow')
    expect(levelFor(50_001, custom)).toBe('red')
    expect(levelFor(500_001, custom)).toBe('black')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run packages/shared/tests/competitor-level.test.ts`

Expected: FAIL with messages indicating `levelFor`, `DEFAULT_COMPETITOR_LEVELS`, and `CompetitorLevelsConfig` cannot be imported from `../src/index.js`.

- [ ] **Step 3: Implement the types and function in `@anubis/shared`**

Edit `packages/shared/src/index.ts`. Find the existing `AppConfig` block (around line 181) and replace it with the following, then add the new exports immediately after:

```ts
export interface AppConfig {
  /** Path to chrome.exe / Chrome binary, when not on PATH. */
  chromePath?: string
  /** Optional research-crawler project/data root whose Chrome profiles should be reused. */
  crawlerProfileRoot?: string
  /** Follower-count bands that drive the competitor level badge. */
  competitorLevels?: CompetitorLevelsConfig
}

/* ============================================================
   Competitor levels
   ============================================================
   Five visible buckets derived live from `followers`. Two "black"
   regions (below minActive and above maxActive) collapse to a
   single 'black' value; the UI distinguishes them in tooltips.
   ============================================================ */

export type CompetitorLevel = 'black' | 'green' | 'yellow' | 'red' | 'unknown'

export interface CompetitorLevelsConfig {
  minActive: number
  greenMax: number
  yellowMax: number
  maxActive: number
}

export const DEFAULT_COMPETITOR_LEVELS: CompetitorLevelsConfig = {
  minActive: 10_000,
  greenMax: 40_000,
  yellowMax: 100_000,
  maxActive: 1_000_000,
}

export function levelFor(
  followers: number | null | undefined,
  cfg: CompetitorLevelsConfig = DEFAULT_COMPETITOR_LEVELS,
): CompetitorLevel {
  if (followers == null) return 'unknown'
  if (followers < cfg.minActive || followers > cfg.maxActive) return 'black'
  if (followers <= cfg.greenMax) return 'green'
  if (followers <= cfg.yellowMax) return 'yellow'
  return 'red'
}

export function isValidCompetitorLevels(cfg: CompetitorLevelsConfig): boolean {
  return (
    Number.isInteger(cfg.minActive) &&
    Number.isInteger(cfg.greenMax) &&
    Number.isInteger(cfg.yellowMax) &&
    Number.isInteger(cfg.maxActive) &&
    cfg.minActive > 0 &&
    cfg.minActive < cfg.greenMax &&
    cfg.greenMax < cfg.yellowMax &&
    cfg.yellowMax < cfg.maxActive
  )
}
```

Then find `interface CapturedPostSummary` (around line 231) and add one new optional field next to `competitorHandle` / `competitorTint`:

```ts
  /** Owning competitor's accent tint, joined in by the route layer. */
  competitorTint?: string
  /** Owning competitor's follower count, joined in by the route layer. */
  competitorFollowers?: number
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vitest run packages/shared/tests/competitor-level.test.ts`

Expected: PASS — all 8 cases green.

- [ ] **Step 5: Typecheck the workspace to ensure no consumers broke**

Run: `pnpm typecheck`

Expected: clean exit. (Adding an optional field to `AppConfig` and `CapturedPostSummary` is non-breaking.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/tests/competitor-level.test.ts
git commit -m "feat(shared): competitor level derivation + types"
```

---

## Task 2: Sanitize `competitorLevels` in `AppConfigService` (TDD)

**Files:**
- Modify: `packages/conversation/src/config/app-config.ts`
- Create: `packages/conversation/tests/config/app-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/conversation/tests/config/app-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppConfigService } from '../../src/config/app-config.js'

describe('AppConfigService — competitorLevels', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cfg-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a valid competitorLevels block', () => {
    const svc = new AppConfigService(dir)
    const next = svc.update({
      competitorLevels: {
        minActive: 5_000,
        greenMax: 20_000,
        yellowMax: 80_000,
        maxActive: 500_000,
      },
    })
    expect(next.competitorLevels).toEqual({
      minActive: 5_000,
      greenMax: 20_000,
      yellowMax: 80_000,
      maxActive: 500_000,
    })
  })

  it('persists the block to disk and reloads it', () => {
    new AppConfigService(dir).update({
      competitorLevels: {
        minActive: 1_000,
        greenMax: 10_000,
        yellowMax: 50_000,
        maxActive: 200_000,
      },
    })
    const reloaded = new AppConfigService(dir).get()
    expect(reloaded.competitorLevels?.greenMax).toBe(10_000)
  })

  it('drops the block when the invariant is broken (greenMax >= yellowMax)', () => {
    const svc = new AppConfigService(dir)
    const next = svc.update({
      competitorLevels: {
        minActive: 1_000,
        greenMax: 50_000,
        yellowMax: 50_000, // not strictly greater
        maxActive: 100_000,
      },
    })
    expect(next.competitorLevels).toBeUndefined()
  })

  it('drops the block when any value is non-positive', () => {
    const svc = new AppConfigService(dir)
    const next = svc.update({
      competitorLevels: {
        minActive: 0,
        greenMax: 10_000,
        yellowMax: 20_000,
        maxActive: 30_000,
      },
    })
    expect(next.competitorLevels).toBeUndefined()
  })

  it('leaves chromePath untouched when updating competitorLevels', () => {
    const svc = new AppConfigService(dir)
    svc.update({ chromePath: 'C:\\chrome.exe' })
    const next = svc.update({
      competitorLevels: {
        minActive: 1_000,
        greenMax: 10_000,
        yellowMax: 50_000,
        maxActive: 200_000,
      },
    })
    expect(next.chromePath).toBe('C:\\chrome.exe')
  })

  it('falls back to empty when config.json holds a corrupt block', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        competitorLevels: { minActive: 'bogus', greenMax: 'x', yellowMax: 'y', maxActive: 'z' },
      }),
    )
    const cfg = new AppConfigService(dir).get()
    expect(cfg.competitorLevels).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run packages/conversation/tests/config/app-config.test.ts`

Expected: FAIL — `competitorLevels` returns `undefined` in every test that expects a value.

- [ ] **Step 3: Extend `AppConfig` and `sanitize()`**

Replace the contents of `packages/conversation/src/config/app-config.ts` with:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/* ============================================================
   Application-level configuration
   ============================================================
   Lives at {dataDir}/config.json. Holds per-machine knobs the
   user can tweak at runtime:

     - chromePath:           optional path to chrome.exe (when
                             not on PATH)
     - crawlerProfileRoot:   optional research-crawler project/data
                             root to reuse Chrome profiles from a
                             standalone crawler checkout.
     - competitorLevels:     follower-count bands for the Black/
                             Green/Yellow/Red badge. Dropped
                             silently if the invariant
                             0 < minActive < greenMax < yellowMax
                             < maxActive is not satisfied.

   Persisted as a flat object; partial PATCHes merge. Empty
   strings collapse to "unset" for clean form-clear behaviour.
   ============================================================ */

export interface CompetitorLevelsConfig {
  minActive: number
  greenMax: number
  yellowMax: number
  maxActive: number
}

export interface AppConfig {
  chromePath?: string
  crawlerProfileRoot?: string
  competitorLevels?: CompetitorLevelsConfig
}

const CONFIG_FILE = 'config.json'

export class AppConfigService {
  private readonly path: string
  private cache: AppConfig | null = null

  constructor(dataDir: string) {
    this.path = join(dataDir, CONFIG_FILE)
  }

  get(): AppConfig {
    if (this.cache) return this.cache
    if (!existsSync(this.path)) {
      this.cache = {}
      return this.cache
    }
    try {
      const raw = readFileSync(this.path, 'utf8')
      this.cache = sanitize(JSON.parse(raw) as Record<string, unknown>)
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  update(patch: Partial<AppConfig>): AppConfig {
    const merged = sanitize({ ...this.get(), ...patch })
    writeFileSync(this.path, JSON.stringify(merged, null, 2))
    this.cache = merged
    return merged
  }
}

function sanitize(obj: Record<string, unknown>): AppConfig {
  const out: AppConfig = {}
  const chromePath = typeof obj.chromePath === 'string' ? obj.chromePath.trim() : ''
  if (chromePath) out.chromePath = chromePath
  const crawlerProfileRoot = typeof obj.crawlerProfileRoot === 'string' ? obj.crawlerProfileRoot.trim() : ''
  if (crawlerProfileRoot) out.crawlerProfileRoot = crawlerProfileRoot
  const levels = sanitizeLevels(obj.competitorLevels)
  if (levels) out.competitorLevels = levels
  return out
}

function sanitizeLevels(raw: unknown): CompetitorLevelsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const minActive = toPositiveInt(r.minActive)
  const greenMax = toPositiveInt(r.greenMax)
  const yellowMax = toPositiveInt(r.yellowMax)
  const maxActive = toPositiveInt(r.maxActive)
  if (
    minActive === undefined ||
    greenMax === undefined ||
    yellowMax === undefined ||
    maxActive === undefined
  ) {
    return undefined
  }
  if (!(minActive < greenMax && greenMax < yellowMax && yellowMax < maxActive)) {
    return undefined
  }
  return { minActive, greenMax, yellowMax, maxActive }
}

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  const i = Math.floor(n)
  return i > 0 ? i : undefined
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vitest run packages/conversation/tests/config/app-config.test.ts`

Expected: PASS — all 6 cases green.

- [ ] **Step 5: Run the wider test suite to check nothing regressed**

Run: `pnpm vitest run packages/conversation`

Expected: all conversation tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/config/app-config.ts packages/conversation/tests/config/app-config.test.ts
git commit -m "feat(conversation): sanitize competitorLevels block in AppConfig"
```

---

## Task 3: Accept `competitorLevels` in the backend `/config` PATCH

**Files:**
- Modify: `packages/backend/src/config.ts`

- [ ] **Step 1: Update the Zod schema**

Replace the `PatchBody` definition in `packages/backend/src/config.ts` with:

```ts
const CompetitorLevelsSchema = z.object({
  minActive: z.number().int().positive(),
  greenMax: z.number().int().positive(),
  yellowMax: z.number().int().positive(),
  maxActive: z.number().int().positive(),
}).strict()

const PatchBody = z.object({
  chromePath: z.string().optional(),
  crawlerProfileRoot: z.string().optional(),
  competitorLevels: CompetitorLevelsSchema.optional(),
}).strict()
```

The cross-field invariant (`minActive < greenMax < yellowMax < maxActive`) is enforced by the conversation-side sanitizer, which silently drops a bad block — that matches the existing `chromePath` "junk in → field unset" pattern and keeps the route handler trivial.

- [ ] **Step 2: Typecheck the backend**

Run: `pnpm --filter @anubis/backend typecheck`

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/config.ts
git commit -m "feat(backend): accept competitorLevels in /config PATCH"
```

---

## Task 4: Join `competitorFollowers` into post enrichment

**Files:**
- Modify: `packages/backend/src/captures.ts` (two sites)

- [ ] **Step 1: Update the list-route enrichment site**

In `packages/backend/src/captures.ts`, find the list handler around line 156–163 and change the mapped object to include `competitorFollowers`:

```ts
  const competitorsById = new Map(stack.competitors.list().map((c) => [c.id, c]))
  const items = rows.map((row) => {
    const owner = competitorsById.get(row.competitorId)
    return {
      ...row,
      competitorHandle: owner?.handle,
      competitorTint: owner?.tint,
      competitorFollowers: owner?.followers,
    }
  })
```

- [ ] **Step 2: Update the `enrichPost` helper used by the PATCH route**

In the same file, change `enrichPost` (around line 218):

```ts
function enrichPost(post: CapturedPost) {
  const owner = getStack().competitors.get(post.competitorId)
  return {
    ...post,
    competitorHandle: owner?.handle,
    competitorTint: owner?.tint,
    competitorFollowers: owner?.followers,
  }
}
```

- [ ] **Step 3: Typecheck and run backend tests**

Run: `pnpm --filter @anubis/backend typecheck && pnpm vitest run packages/backend`

Expected: clean typecheck; existing post tests still pass (the new field is additive).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/captures.ts
git commit -m "feat(backend): join competitorFollowers into post payloads"
```

---

## Task 5: Frontend hook `useCompetitorLevels`

**Files:**
- Create: `packages/frontend/src/hooks/use-competitor-levels.ts`

- [ ] **Step 1: Create the hook**

Create `packages/frontend/src/hooks/use-competitor-levels.ts`:

```ts
import { useEffect, useState, useCallback } from 'react'
import {
  DEFAULT_COMPETITOR_LEVELS,
  levelFor as sharedLevelFor,
  type CompetitorLevel,
  type CompetitorLevelsConfig,
} from '@anubis/shared'
import { getAppConfig } from '@/api'

/* Module-local cache so multiple consumers (Competitors, Content,
   Settings) share one fetch and re-render together when Settings
   saves a new config. */
let cached: CompetitorLevelsConfig | null = null
const subscribers = new Set<(cfg: CompetitorLevelsConfig) => void>()

function notify(next: CompetitorLevelsConfig): void {
  cached = next
  for (const fn of subscribers) fn(next)
}

export function setCompetitorLevels(cfg: CompetitorLevelsConfig): void {
  notify(cfg)
}

export interface UseCompetitorLevels {
  config: CompetitorLevelsConfig
  levelFor: (followers: number | null | undefined) => CompetitorLevel
  reload: () => Promise<void>
}

export function useCompetitorLevels(): UseCompetitorLevels {
  const [config, setConfig] = useState<CompetitorLevelsConfig>(
    cached ?? DEFAULT_COMPETITOR_LEVELS,
  )

  useEffect(() => {
    const sub = (next: CompetitorLevelsConfig): void => setConfig(next)
    subscribers.add(sub)
    if (!cached) {
      void getAppConfig()
        .then((cfg) => notify(cfg.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS))
        .catch(() => notify(DEFAULT_COMPETITOR_LEVELS))
    }
    return () => {
      subscribers.delete(sub)
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const cfg = await getAppConfig()
      notify(cfg.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
    } catch {
      notify(DEFAULT_COMPETITOR_LEVELS)
    }
  }, [])

  const levelForCb = useCallback(
    (followers: number | null | undefined) => sharedLevelFor(followers, config),
    [config],
  )

  return { config, levelFor: levelForCb, reload }
}
```

- [ ] **Step 2: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/use-competitor-levels.ts
git commit -m "feat(frontend): useCompetitorLevels hook with module-level cache"
```

---

## Task 6: Badge component `<CompetitorLevelDot>`

**Files:**
- Create: `packages/frontend/src/components/competitor-level-dot.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/components/competitor-level-dot.tsx`:

```tsx
import type { CompetitorLevel, CompetitorLevelsConfig } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, levelFor } from '@anubis/shared'
import { cn } from '@/lib/utils'

const LEVEL_COLOR: Record<CompetitorLevel, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  red: '#B5483E',
  black: '#1B1D22',
  unknown: '#6B6F78',
}

interface Props {
  followers: number | null | undefined
  config?: CompetitorLevelsConfig
  size?: 'sm' | 'md'
  className?: string
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return n.toLocaleString()
}

function tooltipFor(
  level: CompetitorLevel,
  followers: number | null | undefined,
  cfg: CompetitorLevelsConfig,
): string {
  if (level === 'unknown') return 'No follower count yet — capture to see level'
  if (level === 'black') {
    if (followers != null && followers < cfg.minActive) {
      return `Too small — under ${formatK(cfg.minActive)} followers`
    }
    return `Too big — over ${formatK(cfg.maxActive)} followers`
  }
  if (level === 'green') return `Green — ${formatK(cfg.minActive)}–${formatK(cfg.greenMax)} followers`
  if (level === 'yellow') return `Yellow — ${formatK(cfg.greenMax)}–${formatK(cfg.yellowMax)} followers`
  return `Red — ${formatK(cfg.yellowMax)}–${formatK(cfg.maxActive)} followers`
}

export function CompetitorLevelDot({ followers, config, size = 'sm', className }: Props) {
  const cfg = config ?? DEFAULT_COMPETITOR_LEVELS
  const level = levelFor(followers, cfg)
  const dim = size === 'md' ? 10 : 8
  return (
    <span
      aria-label={tooltipFor(level, followers, cfg)}
      title={tooltipFor(level, followers, cfg)}
      data-level={level}
      className={cn('inline-block shrink-0 rounded-full ring-1 ring-black/20', className)}
      style={{
        background: LEVEL_COLOR[level],
        width: dim,
        height: dim,
      }}
    />
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/competitor-level-dot.tsx
git commit -m "feat(frontend): CompetitorLevelDot badge component"
```

---

## Task 7: Filter chip component `<CompetitorLevelFilter>`

**Files:**
- Create: `packages/frontend/src/components/competitor-level-filter.tsx`

- [ ] **Step 1: Create the component**

Create `packages/frontend/src/components/competitor-level-filter.tsx`:

```tsx
import type { CompetitorLevel } from '@anubis/shared'
import { cn } from '@/lib/utils'

export type LevelFilter = CompetitorLevel | 'all'

interface Option {
  value: LevelFilter
  label: string
  dot: string | null
}

const OPTIONS: Option[] = [
  { value: 'all', label: 'All', dot: null },
  { value: 'green', label: 'Green', dot: '#5E8F55' },
  { value: 'yellow', label: 'Yellow', dot: '#C9A645' },
  { value: 'red', label: 'Red', dot: '#B5483E' },
  { value: 'black', label: 'Black', dot: '#1B1D22' },
  { value: 'unknown', label: 'Unknown', dot: '#6B6F78' },
]

interface Props {
  value: LevelFilter
  onChange: (next: LevelFilter) => void
  className?: string
}

export function CompetitorLevelFilter({ value, onChange, className }: Props) {
  return (
    <div
      role='radiogroup'
      aria-label='Filter by level'
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

export function matchesLevelFilter(level: CompetitorLevel, filter: LevelFilter): boolean {
  return filter === 'all' || filter === level
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/competitor-level-filter.tsx
git commit -m "feat(frontend): CompetitorLevelFilter chip group"
```

---

## Task 8: Settings page — competitor levels section

**Files:**
- Modify: `packages/frontend/src/pages/settings.tsx`

- [ ] **Step 1: Wire form state for the four thresholds**

At the top of `SettingsPage()` in `packages/frontend/src/pages/settings.tsx`, just below the existing `const [form, setForm] = useState<AppConfig>({})`, add an effective-levels view and import the hook:

Add to the existing imports:

```tsx
import { DEFAULT_COMPETITOR_LEVELS, isValidCompetitorLevels, type CompetitorLevelsConfig } from '@anubis/shared'
import { setCompetitorLevels } from '@/hooks/use-competitor-levels'
```

Replace the existing `chromePathDirty` / `dirty` block and the `handleSave` body so the form also tracks `competitorLevels`:

```tsx
  const effectiveLevels: CompetitorLevelsConfig =
    form.competitorLevels ?? config?.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS

  const chromePathDirty = config !== null && (form.chromePath ?? '') !== (config.chromePath ?? '')
  const levelsDirty =
    config !== null &&
    JSON.stringify(form.competitorLevels ?? config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS) !==
    JSON.stringify(config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)

  const levelsValid = isValidCompetitorLevels(effectiveLevels)

  const dirty = chromePathDirty || levelsDirty
  const canSave = dirty && levelsValid

  async function handleSave() {
    setBusy(true); setBanner(null)
    try {
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
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      setBusy(false)
    }
  }
```

Replace the Save button's `disabled` predicate with `!canSave || busy`.

- [ ] **Step 2: Render the new section**

Below the existing "Chrome executable path" section (after its closing `</section>`), add:

```tsx
        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Competitor levels</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Follower-count bands that drive the colored dot on each competitor card and post.
            Below <span className='font-mono'>min</span> or above <span className='font-mono'>max</span> is "black" — out of competitive range.
          </p>

          <div className='mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <LevelInput
              label='Min followers'
              value={effectiveLevels.minActive}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, minActive: n },
              }))}
            />
            <LevelInput
              label='Green up to'
              value={effectiveLevels.greenMax}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, greenMax: n },
              }))}
            />
            <LevelInput
              label='Yellow up to'
              value={effectiveLevels.yellowMax}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, yellowMax: n },
              }))}
            />
            <LevelInput
              label='Max followers'
              value={effectiveLevels.maxActive}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, maxActive: n },
              }))}
            />
          </div>

          <div className='mt-3 flex flex-wrap items-center gap-1.5'>
            <RangeChip color='#1B1D22' text={`< ${formatThreshold(effectiveLevels.minActive)}`} />
            <RangeChip color='#5E8F55' text={`${formatThreshold(effectiveLevels.minActive)} – ${formatThreshold(effectiveLevels.greenMax)}`} />
            <RangeChip color='#C9A645' text={`${formatThreshold(effectiveLevels.greenMax)} – ${formatThreshold(effectiveLevels.yellowMax)}`} />
            <RangeChip color='#B5483E' text={`${formatThreshold(effectiveLevels.yellowMax)} – ${formatThreshold(effectiveLevels.maxActive)}`} />
            <RangeChip color='#1B1D22' text={`> ${formatThreshold(effectiveLevels.maxActive)}`} />
          </div>

          {!levelsValid && (
            <p className='mt-3 text-[12px] text-destructive'>
              Each threshold must be greater than the one before it (min &lt; green &lt; yellow &lt; max), and all must be &gt; 0.
            </p>
          )}
        </section>
```

Add these helpers at the bottom of the file (above any existing trailing helper, or at end):

```tsx
function LevelInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-[12.5px] font-medium text-foreground'>{label}</span>
      <input
        type='number'
        min={1}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0)
        }}
        className='h-10 w-full rounded-md border border-border bg-card px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
      />
    </label>
  )
}

function RangeChip({ color, text }: { color: string; text: string }) {
  return (
    <span className='inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11.5px] font-mono text-muted-foreground'>
      <span aria-hidden className='size-2 rounded-full ring-1 ring-black/20' style={{ background: color }} />
      {text}
    </span>
  )
}

function formatThreshold(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return n.toLocaleString()
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/settings.tsx
git commit -m "feat(frontend): competitor levels section in Settings"
```

---

## Task 9: Competitors page — badge on card + filter chip

**Files:**
- Modify: `packages/frontend/src/pages/competitors.tsx`

- [ ] **Step 1: Import the new pieces**

Add to the top-level imports in `packages/frontend/src/pages/competitors.tsx`:

```tsx
import { CompetitorLevelDot } from '@/components/competitor-level-dot'
import { CompetitorLevelFilter, matchesLevelFilter, type LevelFilter } from '@/components/competitor-level-filter'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
```

- [ ] **Step 2: Add filter state and apply it**

Inside `CompetitorsPage()`, near the other `useState` calls (around line 56), add:

```tsx
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const { config: levelsCfg, levelFor } = useCompetitorLevels()

  const visibleItems = items?.filter((c) => matchesLevelFilter(levelFor(c.followers), levelFilter))
```

Then replace the two `items` references inside the JSX render branch (the empty-state check and the `.map`) with `visibleItems`, **but** keep `items` for the bulk-select bar's `total`. Concretely, change:

```tsx
        {items === null ? (
          <LoadingGrid />
        ) : items.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div className='mt-7 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {items.map((c) => (
```

to:

```tsx
        {items === null ? (
          <LoadingGrid />
        ) : items.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : visibleItems && visibleItems.length === 0 ? (
          <div className='mt-10 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center text-[13px] text-muted-foreground'>
            No competitors match this level filter.
          </div>
        ) : (
          <div className='mt-7 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {visibleItems!.map((c) => (
```

- [ ] **Step 3: Render the filter chip group above the grid**

Just below the `{banner && (...)}` block and above the `{selectMode && ...}` block, add:

```tsx
        {items && items.length > 0 && (
          <div className='mt-5'>
            <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
          </div>
        )}
```

- [ ] **Step 4: Add the dot to the card header**

In `CompetitorCard`, find the `<h3>` rendering `{competitor.handle}` (around line 527) and place a `<CompetitorLevelDot>` before the handle:

```tsx
        <div className='min-w-0 flex-1'>
          <h3 className='flex items-center gap-1.5 truncate font-mono text-[13.5px] font-semibold text-foreground'>
            <CompetitorLevelDot followers={competitor.followers} config={levelsCfg} />
            {competitor.handle}
          </h3>
```

Update the `CompetitorCard` props type to accept `levelsCfg` and thread it from the parent: in the `CompetitorCard` props interface add `levelsCfg: CompetitorLevelsConfig`, import the type at the top of the file (`import type { CompetitorLevelsConfig } from '@anubis/shared'`), and in the parent's `.map` pass `levelsCfg={levelsCfg}`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/pages/competitors.tsx
git commit -m "feat(frontend): level badge + filter on Competitors page"
```

---

## Task 10: Content page — badge on post card + filter chip

**Files:**
- Modify: `packages/frontend/src/pages/content.tsx`

- [ ] **Step 1: Import the new pieces**

Add to the imports in `packages/frontend/src/pages/content.tsx`:

```tsx
import { CompetitorLevelDot } from '@/components/competitor-level-dot'
import { CompetitorLevelFilter, matchesLevelFilter, type LevelFilter } from '@/components/competitor-level-filter'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
```

- [ ] **Step 2: Add filter state**

In the `ContentPage()` component body (find the top, near the other `useState`), add:

```tsx
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const { config: levelsCfg, levelFor } = useCompetitorLevels()
```

- [ ] **Step 3: Apply the filter to the rendered list**

The Content page renders posts via a `cards` array derived from the API response. Locate the array used for the grid (search the file for `.map((card)` or similar) and wrap it:

```tsx
  const filteredCards = cards.filter((card) =>
    matchesLevelFilter(levelFor(card.post?.competitorFollowers), levelFilter),
  )
```

Then replace the `.map` source from `cards` to `filteredCards`. (If the Content page uses mock cards before posts load — see `MOCK_CARDS` — leave them alone; the filter only applies once real posts are present. Concretely: only switch to `filteredCards` for the real-data branch.)

- [ ] **Step 4: Render the filter chip group above the grid**

In the page header area, below the existing toolbar row but above the grid, add:

```tsx
      <div className='mt-4'>
        <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
      </div>
```

- [ ] **Step 5: Add the dot to each post card**

Find where each post card renders the `@handle` (the `card.handle` reference). Place the dot before it. The followers value for a real post is `card.post?.competitorFollowers`; for a mock card it's `undefined` (renders grey "unknown"):

```tsx
        <span className='inline-flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground'>
          <CompetitorLevelDot followers={card.post?.competitorFollowers} config={levelsCfg} />
          {card.handle}
        </span>
```

Adapt the surrounding tags to match the existing markup — only the two changes (wrap the handle in an inline-flex, add the dot) are required.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/content.tsx
git commit -m "feat(frontend): level badge + filter on Content page"
```

---

## Task 11: End-to-end verification in the running app

**Files:** none — manual run + screenshots.

- [ ] **Step 1: Start the desktop app**

Run: `pnpm dev`

Wait for the Electron window to open. Watch the terminal for the `{"type":"backend-ready"...}` line; if it does not appear within ~15s, check `apps/desktop/electron/main/backend.ts` logs.

- [ ] **Step 2: Verify Settings**

Navigate to Settings → scroll to "Competitor levels". Confirm:
- Four number inputs prefilled with defaults `10000 / 40000 / 100000 / 1000000`.
- Live preview strip shows five colored chips.
- Editing yellow down to `30000` (below green) makes the Save button disabled and shows the red validation hint.
- Restoring valid values re-enables Save. Click Save → banner shows "Saved.".

- [ ] **Step 3: Verify Competitors page**

Navigate to Competitors. Confirm:
- Each card shows a small dot before the handle, with a tooltip on hover (e.g. "Green — 10K–40K followers").
- Filter chip group is visible above the grid. Clicking "Red" shows only competitors above the yellow threshold; clicking "Black" shows competitors below `minActive` or above `maxActive`; clicking "All" restores the full grid.
- A competitor with no follower count (never captured) shows the grey dot and only appears under the "Unknown" filter.

- [ ] **Step 4: Verify Content page**

Navigate to Content. Confirm:
- Real captured posts (not the mock fallback) show the same dot before the author handle.
- The filter chip group applies to real posts.

- [ ] **Step 5: Verify live re-bucketing**

With Competitors open in one part of the screen, go to Settings, change `greenMax` to a value that moves at least one competitor from yellow to green, and Save. Return to Competitors — the dot for that competitor should now be green without a manual refresh.

- [ ] **Step 6: Run the full automated suite**

Run: `pnpm test`

Expected: all tests green (shared, conversation, backend, ai-agent, frontend).

- [ ] **Step 7: Run typecheck across the workspace**

Run: `pnpm typecheck`

Expected: clean exit.

- [ ] **Step 8: Commit any incidental fixes**

If the manual verification surfaced small issues (a className typo, an off-by-one in formatting), fix them inline and commit with a focused message such as:

```bash
git commit -m "fix(frontend): <one-line description>"
```

If everything passed, no additional commit is needed.
