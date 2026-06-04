# Level Multiplier Settings — Design

**Date:** 2026-06-05
**Status:** Approved (pending implementation plan)

## Summary

Add a configurable `levelMultipliers` setting that rates individual captured posts by
how far their like count exceeds the competitor's `avgLikes` (a "viral multiplier").
Each competitor's follower-based level (green / yellow / red) selects a threshold band;
the post's multiplier is then bucketed into a green / yellow / red rating, or grey
("unrated") when it cannot be computed. The rating surfaces as a per-post badge and a
filter on the Content page, and the thresholds are editable in Settings.

## Background

The existing system (see `packages/shared/src/index.ts`):

- `CompetitorLevel = 'black' | 'green' | 'yellow' | 'red' | 'unknown'`.
- `CompetitorLevelsConfig` defines follower-count bands; `levelFor(followers, cfg)`
  derives a level from follower count; `effectiveLevel(override, followers, cfg)`
  returns a manual override when present, otherwise the derived level.
- Competitors carry `avgLikes` (a dominant-cluster mean, not a plain average).
- `AppConfig` (persisted via `AppConfigService` in
  `packages/conversation/src/config/app-config.ts` to `{dataDir}/config.json`) currently
  holds `chromePath` and `competitorLevels`. `GET /config` / `PATCH /config`
  (`packages/backend/src/config.ts`) read/merge it. The Settings page
  (`packages/frontend/src/pages/settings.tsx`) edits it; `useCompetitorLevels`
  (`packages/frontend/src/hooks/use-competitor-levels.ts`) distributes it live.

There is currently **no** multiplier concept. This design adds one.

## Requirements (resolved)

1. **Multiplier definition:** `post likes ÷ competitor avgLikes`. Rates individual posts.
2. **Tiers:** the three multiplier tiers map onto the existing active competitor levels —
   green, yellow, red. ("ref" in the original request was a typo for red.)
3. **Thresholds (defaults):**

   | Competitor level | red (under min) | yellow (≥ min) | green (good) |
   |---|---|---|---|
   | green  | < 5×  | 5×–10×  | ≥ 10× |
   | yellow | < 10× | 10×–15× | ≥ 15× |
   | red    | < 15× | 15×–20× | ≥ 20× |

4. **Surface:** per-post badge on Content-page cards **and** a Content-page filter.
5. **Edge cases:** unrated/grey when the multiplier can't be computed (missing/zero
   avgLikes, missing post likes) or the competitor is black/unknown. The filter can
   select "unrated".

## Approach

Mirror the existing `competitorLevels` pattern: config lives in `AppConfig` in
`@anubis/shared`, a pure function computes the rating client-side from data the frontend
already has (post likes + competitor avgLikes + competitor effective level), and the
Settings UI / backend Zod schema / `AppConfigService.sanitize()` all extend exactly as
they already do for `competitorLevels`.

Rejected alternatives:

- **Fold thresholds into `CompetitorLevelsConfig`** — mixes follower bands with post
  multiplier thresholds in one type, muddying validation and the Settings form.
- **Compute and persist a rating per post server-side** — overkill; ratings change
  whenever thresholds change (staleness risk), and the needed data is already client-side.

## Design

### 1. Data model & config (`@anubis/shared`)

```ts
type MultiplierBand = { min: number; good: number }; // min = yellow floor, good = green floor

interface LevelMultipliersConfig {
  green:  MultiplierBand; // default { min: 5,  good: 10 }
  yellow: MultiplierBand; // default { min: 10, good: 15 }
  red:    MultiplierBand; // default { min: 15, good: 20 }
}

const DEFAULT_LEVEL_MULTIPLIERS: LevelMultipliersConfig = {
  green:  { min: 5,  good: 10 },
  yellow: { min: 10, good: 15 },
  red:    { min: 15, good: 20 },
};
```

`AppConfig` gains an optional `levelMultipliers?: LevelMultipliersConfig`. Only the three
active levels get bands; black/unknown competitors are always unrated. Invariant: each
band has finite numbers with `0 < min < good`.

### 2. Computation logic (`@anubis/shared`, pure + tested)

```ts
type MultiplierRating = 'green' | 'yellow' | 'red' | 'unrated';

function multiplierRatingFor(
  competitorLevel: CompetitorLevel,        // the EFFECTIVE level
  postLikes: number | null | undefined,
  avgLikes: number | null | undefined,
  cfg: LevelMultipliersConfig,
): { rating: MultiplierRating; multiplier: number | null };
```

Logic:

1. If `competitorLevel` is not green/yellow/red → `{ rating: 'unrated', multiplier: null }`.
2. If `postLikes` or `avgLikes` is missing, or `avgLikes <= 0` →
   `{ rating: 'unrated', multiplier: null }`.
3. Else `multiplier = postLikes / avgLikes`; select the band for the competitor level:
   - `multiplier >= band.good` → green
   - `multiplier >= band.min`  → yellow
   - else → red

The caller passes the **effective** level (`effectiveLevel(override, followers, cfg)`),
so a manual competitor-level override correctly drives which band the post uses. The
numeric `multiplier` is returned so the badge can display "×12.3".

### 3. UI integration (frontend)

- **Badge:** a new `PostMultiplierBadge` component rendered on each Content-page post
  card. Inputs: post likes, joined competitor `avgLikes` + effective level, and the
  `levelMultipliers` config. Shows a colored dot + multiplier value (e.g. `×12.3`); grey
  "unrated" when not computable; tooltip explains the band used.
- **Filter:** a new Content-page filter mirroring `competitor-level-filter`, options
  All / green / yellow / red / unrated. Filters client-side over already-loaded posts and
  composes with the existing competitor-level filter (both must match).
- **Config distribution:** extend `useCompetitorLevels` (or add a sibling
  `useLevelMultipliers` reading the same `AppConfig`) so badges/filter update live when
  thresholds change.
- **Data availability:** `CapturedPostSummary` already carries `competitorLevel`. Confirm
  it also exposes competitor `avgLikes` and `followers` (needed to compute effective
  level). If absent, add the field(s) to the summary shape and the repo query that builds
  the post join.

### 4. Settings UI

Add a "Level Multipliers" section to `packages/frontend/src/pages/settings.tsx` below the
Competitor Levels section. Three rows (green / yellow / red), each with two numeric inputs:
**Minimum (yellow)** and **Good (green)**. Client-side validation mirrors
`isValidCompetitorLevels`: each band requires finite numbers with `0 < min < good`;
invalid input blocks save with an inline message. Save sends `levelMultipliers` via the
existing `updateAppConfig(patch)` → `PATCH /config`. Extend the shared module
cache/subscriber so the Content page updates live.

### 5. Backend & persistence

- `packages/backend/src/config.ts`: add a Zod `LevelMultipliersSchema` (each band
  `{ min, good }`, positive finite, `min < good`) to the `PATCH /config` body; `GET /config`
  returns it.
- `packages/conversation/src/config/app-config.ts`: add `levelMultipliers` to the
  `AppConfig` interface and to `sanitize()` — enforce `0 < min < good`, repair/drop invalid
  bands by falling back to defaults (same spirit as the existing levels logic). Persisted
  in the same `config.json`.
- Defaults: when absent from disk, `DEFAULT_LEVEL_MULTIPLIERS` applies everywhere, so
  existing installs need no migration.

### 6. Testing

- `packages/shared/tests`: unit tests for `multiplierRatingFor` — each band's three
  buckets, boundary equality (`>= good`, `>= min`), unrated cases (black/unknown level,
  missing/zero avgLikes, missing likes), and override-driven band selection.
- `packages/conversation` config tests: `sanitize()` accepts valid input, repairs/rejects
  invalid bands, and applies defaults when missing.

## Out of scope

- Server-side persistence of computed ratings.
- Any change to how `avgLikes` itself is computed.
- Multiplier ratings for black/unknown competitors (always unrated).
