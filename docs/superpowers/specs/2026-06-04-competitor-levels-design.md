# Competitor levels — design

Date: 2026-06-04

## Problem

The Competitors page tracks Instagram profiles with a `followers` count but offers no
visual sense of how each profile compares in reach. Users want to scan their list (and
the Content feed that hangs off it) and immediately see who is realistically catchable,
who is a giant, and who is outside the competitive range entirely.

## Solution overview

Introduce a configurable level — **Black / Green / Yellow / Red / Unknown** — derived
live from `competitor.followers` and four user-tunable thresholds stored in the existing
`config.json`. Render the level as a colored dot on competitor cards and on content posts
(which inherit from their author). Add a filter chip on both pages to slice by level.

**Derived, not stored.** No `level` column on the `competitors` table. No bulk recompute
job. Editing thresholds in Settings instantly re-buckets every card and every post in
the UI because the level is computed from current followers + current config on every
render.

## Level model

Five user-visible levels plus one absent state:

| Level | Range | Meaning |
|---|---|---|
| ⚫ Black (too small) | `followers < minActive` | Below the floor — not counted as a competitor |
| 🟢 Green | `minActive ≤ followers ≤ greenMax` | Catchable |
| 🟡 Yellow | `greenMax < followers ≤ yellowMax` | Mid |
| 🔴 Red | `yellowMax < followers ≤ maxActive` | Giant — still in range but hard to catch |
| ⚫ Black (too big) | `followers > maxActive` | Above the ceiling — out of league |
| ⚪ Unknown | `followers == null` | No follower count captured yet |

The two black cases collapse to a single `'black'` value in code; the UI distinguishes
them only in the tooltip ("Too small — < 10K followers" vs "Too big — > 1M followers").

### Default thresholds

```
minActive  = 10_000
greenMax   = 40_000
yellowMax  = 100_000
maxActive  = 1_000_000
```

These ship in the sanitizer fallback; users override in Settings.

## Architecture

### 1. Config storage — `@anubis/conversation`

Extend `AppConfig` in [packages/conversation/src/config/app-config.ts](packages/conversation/src/config/app-config.ts):

```ts
export interface AppConfig {
  chromePath?: string
  crawlerProfileRoot?: string
  competitorLevels?: CompetitorLevelsConfig
}

export interface CompetitorLevelsConfig {
  minActive: number
  greenMax: number
  yellowMax: number
  maxActive: number
}
```

`sanitize()` accepts a `competitorLevels` block when present and:

- Coerces each field to a positive integer.
- Drops the block entirely if the invariant `0 < minActive < greenMax < yellowMax < maxActive`
  does not hold (silent fallback to defaults, matching how `chromePath` handles junk).

Defaults are exposed as an exported `DEFAULT_COMPETITOR_LEVELS` constant so the
derivation function and the Settings UI can both reuse them when the user has not yet
saved a custom set.

### 2. Derivation — `@anubis/shared`

A single pure function lives in `packages/shared/src/index.ts` so frontend, backend, and
tests share one source of truth:

```ts
export type CompetitorLevel = 'black' | 'green' | 'yellow' | 'red' | 'unknown'

export interface CompetitorLevelsConfig {
  minActive: number
  greenMax: number
  yellowMax: number
  maxActive: number
}

export const DEFAULT_COMPETITOR_LEVELS: CompetitorLevelsConfig = {
  minActive: 10_000,
  greenMax:  40_000,
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
```

**Type duplication note.** The existing codebase declares `AppConfig` in both
`@anubis/shared` ([packages/shared/src/index.ts:181](packages/shared/src/index.ts:181)) and
`@anubis/conversation` ([packages/conversation/src/config/app-config.ts](packages/conversation/src/config/app-config.ts)) as
parallel definitions (the conversation package does not depend on shared). This spec
follows the same pattern: `CompetitorLevelsConfig` is declared in both places with
identical shape. The pure `levelFor()` function and `DEFAULT_COMPETITOR_LEVELS` constant
live only in `@anubis/shared` because only the frontend needs to derive levels — the
backend just round-trips the config block.

### 3. Backend — `@anubis/backend`

No new routes. The existing `GET /app-config` and `PATCH /app-config` in the app-config
router already round-trip the full `AppConfig`, so adding `competitorLevels` to the
interface is enough. The PATCH handler delegates to `AppConfigService.update()`, which
already merges + sanitizes — no handler changes needed.

### 4. Frontend — `@anubis/frontend`

**Hook — `useCompetitorLevels()`**

New hook in `packages/frontend/src/hooks/use-competitor-levels.ts`:

- Fetches `AppConfig` once on mount via the existing `getAppConfig()` API call.
- Caches the result module-locally so multiple consumers (Competitors page, Content page,
  Settings page) do not refetch.
- Exposes `{ config, levelFor: (followers) => CompetitorLevel, reload }`.
- Falls back to `DEFAULT_COMPETITOR_LEVELS` while loading and when the user has no
  saved overrides.
- Invalidates the cache when Settings saves, so other pages pick up the new thresholds
  on their next render.

**Settings page** — new section in [packages/frontend/src/pages/settings.tsx](packages/frontend/src/pages/settings.tsx):

- Heading: "Competitor levels".
- Four labeled number inputs in a responsive grid: *Min followers*, *Green up to*,
  *Yellow up to*, *Max followers*.
- Live preview strip below the inputs — five colored chips showing the resulting ranges
  ("< 10K", "10K – 40K", "40K – 100K", "100K – 1M", "> 1M"), updating as the user types.
- Inline validation message when the invariant breaks; Save button stays disabled until
  valid and dirty.
- Save reuses the existing `updateAppConfig()` PATCH plus the existing save banner.
- After a successful save, calls `useCompetitorLevels().reload()` so open Competitors /
  Content tabs re-render with the new thresholds.

**Badge component** — new `packages/frontend/src/components/competitor-level-dot.tsx`:

- Props: `{ followers: number | null | undefined, config?: CompetitorLevelsConfig, size?: 'sm' | 'md' }`.
- Renders a small filled circle with the level color plus a `title` tooltip:
  - Green / Yellow / Red: `"<Level> — <range>K–<range>K followers"`.
  - Black low: `"Too small — < <minActive> followers"`.
  - Black high: `"Too big — > <maxActive> followers"`.
  - Unknown: `"No follower count yet — capture to see level"`.
- Color tokens match the existing palette (`var(--anubis-gold)` etc. for warm tones;
  use `--destructive` for red, a green shade from the brand, a gray shade for unknown,
  and `#1B1D22`/near-black for black).

**Competitor card** — modify [packages/frontend/src/pages/competitors.tsx](packages/frontend/src/pages/competitors.tsx):

- Render `<CompetitorLevelDot>` immediately before the `@handle` in the card header.
- Reuses the same followers value already on the card; no additional API calls.

**Content posts** — modify [packages/frontend/src/pages/content.tsx](packages/frontend/src/pages/content.tsx):

- Each post already carries its author competitor (joined in `captured-posts-repo`).
- Render the same `<CompetitorLevelDot>` next to the author handle on each post card.

**Filter chip** — added to both Competitors and Content pages:

- Single-select chip group: `All • 🟢 Green • 🟡 Yellow • 🔴 Red • ⚫ Black • ⚪ Unknown`.
- Plain client-side filter over the already-loaded list.
- The Black chip matches both ends (too-small + too-big) — users who want to triage the
  bottom vs the top can read the dot tooltips on the resulting cards.
- Default selection: `All`. Selection lives in component state — not persisted.

## Edge cases and behavior

- **Unknown followers**: rendered as a grey dot, kept in its own filter bucket so users
  can quickly find competitors that still need a capture run.
- **Hand-edited corrupt `config.json`**: `sanitize()` drops the bad `competitorLevels`
  block and we fall back to `DEFAULT_COMPETITOR_LEVELS` — no crash, no warning popup, same
  pattern as `chromePath` today.
- **Mid-filter threshold change**: if a user has the Green filter active and edits
  thresholds in another tab so a previously-green competitor leaves the bucket, that
  competitor disappears from view on next render. Correct behavior — no special handling.
- **Followers value of `0`**: treated as black (too small), because `0 < minActive`.
- **Followers equal to a boundary** (e.g. exactly `40_000`): falls in the lower bucket
  (`≤` comparisons). Documented in the function and reflected in the preview chips.

## Testing

- **Pure function** — `packages/shared/tests/competitor-level.test.ts`:
  table-driven cases covering `null`/`undefined`, below `minActive`, at each boundary
  (exactly `minActive`, `greenMax`, `yellowMax`, `maxActive`), inside each bucket, above
  `maxActive`, and a custom non-default config.
- **Config sanitizer** — extend the existing `app-config` tests (or add one if absent):
  accepts a valid block, drops a block where `greenMax >= yellowMax`, drops a block with
  a negative `minActive`, leaves other fields intact.
- **Settings page** — add a Vitest case asserting the Save button stays disabled when
  the invariant is broken, and enables when valid + dirty.
- No E2E coverage needed for the badges — they are pure presentation over already-tested
  data.

## What we are explicitly not doing

- No `level` column on `competitors`. No bulk recompute job. No per-competitor override.
- No multi-machine sync of the threshold config — it stays in per-machine `config.json`
  alongside `chromePath`.
- No history of past levels. The level is always derived from current followers and
  current config.
- No automatic re-capture of competitors when thresholds change. If a user wants to
  reclassify based on fresher follower counts, that is what the existing Refresh button
  on each card is for.
