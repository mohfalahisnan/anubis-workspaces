# Competitor `bio` + manual `level` override — design

**Date:** 2026-06-05
**Status:** Approved (pending spec review)

## Goal

Add two new optional fields to a tracked competitor:

1. **`bio`** — the Instagram profile bio. Auto-filled from captures (the
   research-crawler already returns `ProfileData.bio`), manually editable, and
   shown on the competitor card and the Edit dialog.
2. **`level`** — a manual override of the follower-count-derived competitor
   level. When set, it overrides `levelFor(followers)`; when blank, the derived
   level is used. Editable in the Edit dialog and reflected wherever the level
   dot appears (Competitors page **and** Content page).

Both fields are threaded through the stack following the exact pattern the
existing `notes` field uses.

## Background — current state

- `Competitor` (`packages/conversation/src/db/repositories/competitors-repo.ts`)
  has `displayName`, `niche`, `tint`, `followers`, `avgLikes`, `postCount`,
  `notes` — **no `bio`, no `level`**.
- The crawler returns `bio` (`packages/research-crawler/src/core/standard-output.ts:28`)
  and it flows through `captures.ts` (the capture handler), where today only
  `displayName`/`followers`/`avgLikes`/`postCount` get persisted — **bio is dropped**.
- "Level" today is **purely derived**: `levelFor(followers, cfg)`
  (`packages/shared/src/index.ts:214`) maps a follower count to
  `'black' | 'green' | 'yellow' | 'red' | 'unknown'` using thresholds from app
  config. It surfaces only as `<CompetitorLevelDot>` (a colored dot next to the
  handle) and the level filter. Nothing about level is stored on the competitor.

## Decisions

- **Bio source:** auto-fill from capture **and** allow manual edit.
- **Bio overwrite behavior:** capture-wins, falling back to existing — mirrors
  the existing `deriveDisplayName` helper. A capture refreshes the bio from
  Instagram; if IG returns no bio, the existing (possibly hand-edited) value is
  kept.
- **Bio display:** on the card face (clamped to ~2 lines) and in the Edit dialog.
- **Level field:** a manual override. When set it wins over the derived level;
  when blank the derived level is used. Capture never touches `level`.
- **Level override values:** the four real colors only (`black`/`green`/`yellow`/`red`).
  `'unknown'` stays a computed-only sentinel — the user cannot pick it manually.
- **Content page consistency:** the override propagates to the Content page so a
  competitor shows the same dot color everywhere.

## Changes by layer

### 1. DB migration

`packages/conversation/src/db/migrations/005_competitors_bio_level.sql`:

```sql
ALTER TABLE competitors ADD COLUMN bio TEXT;
ALTER TABLE competitors ADD COLUMN level TEXT;   -- 'black'|'green'|'yellow'|'red'; null = derive from followers
```

Register in `packages/conversation/src/db/migrations/index.ts` as `load(5, '005_competitors_bio_level.sql')`.

### 2. Repo — `competitors-repo.ts`

- Add `bio?: string` and `level?: CompetitorLevelOverride` to `Competitor` and
  `bio: string | null`, `level: string | null` to `Row`.
- Map both in `toCompetitor`.
- Include both columns in the `INSERT` and `UPDATE` statements.

### 3. Service — `competitors-service.ts`

- Add `bio?` and `level?` to `CreateCompetitorInput` and `UpdateCompetitorInput`.
- In `create()`: `bio: input.bio?.trim() || undefined`, `level: input.level`.
- In `update()`: merge both like the existing fields (patch value, falling back
  to existing). Setting `level` to `null`/`undefined` in a patch clears the
  override.

### 4. Shared types — `packages/shared/src/index.ts`

- Add `export type CompetitorLevelOverride = 'black' | 'green' | 'yellow' | 'red'`
  (= `Exclude<CompetitorLevel, 'unknown'>`).
- Add `export function effectiveLevel(override: CompetitorLevelOverride | null | undefined, followers: number | null | undefined, cfg?: CompetitorLevelsConfig): CompetitorLevel`
  returning `override ?? levelFor(followers, cfg)`.
- Add `bio?: string` and `level?: CompetitorLevelOverride` to `CompetitorSummary`,
  `CreateCompetitorInput`, `UpdateCompetitorInput`.
- Add `competitorLevel?: CompetitorLevelOverride` to `CapturedPostSummary` (joined
  in by the route layer, alongside `competitorFollowers`).

### 5. Backend zod — `packages/backend/src/competitors.ts`

On both `CreateBody` and `UpdateBody`:

```ts
bio: z.string().optional(),
level: z.enum(['black', 'green', 'yellow', 'red']).optional(),
```

### 6. Capture pipeline — `packages/backend/src/captures.ts`

- Add `deriveBio(existing, profileEntry)` mirroring `deriveDisplayName`
  (capture-wins, falls back to existing).
- Pass `bio: deriveBio(...)` into the post-capture `competitors.update()` call.
  Do **not** touch `level` here.
- In `GET /posts` enrichment and `enrichPost`, join `competitorLevel: owner?.level`
  alongside the existing `competitorHandle/Tint/Followers`.

### 7. Frontend — `CompetitorLevelDot` (`competitor-level-dot.tsx`)

- Add optional prop `levelOverride?: CompetitorLevelOverride | null`.
- Compute `const level = levelOverride ?? levelFor(followers, cfg)`.
- Tooltip: when overridden, read `"Manually set — {level}"`; otherwise the
  existing follower-range tooltip.

### 8. Frontend — Competitors page (`competitors.tsx`)

- Filter (line 65): `matchesLevelFilter(effectiveLevel(c.level, c.followers, levelsCfg), levelFilter)`.
- Card dot (line 548): pass `levelOverride={competitor.level}`.
- Card: render `competitor.bio` under the display name, muted, `line-clamp-2`,
  only when present.
- Edit dialog: add a **Bio** textarea (wired into the existing `handleUpdate`
  patch) and a **Level** select with options *Auto (from followers)* +
  black/green/yellow/red, where *Auto* maps to `level: undefined`/null (clears
  the override).
- Add dialog: unchanged (handle/name/niche only).

### 9. Frontend — Content page (`content.tsx`)

- Filter (line 417): use `effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg)`.
- Dot (line 845): pass `levelOverride={card.post?.competitorLevel}`.

### 10. API client — `packages/frontend/src/api.ts`

No code change needed beyond the shared-type updates: `create`/`updateCompetitor`
pass typed inputs straight through.

## Testing

- `packages/shared/tests/competitor-level.test.ts`: add `effectiveLevel` cases —
  override wins over derived; `null`/`undefined` override falls back to `levelFor`.
- `packages/conversation/tests/competitors/competitors-service.test.ts`:
  - `create` round-trips `bio` and `level`.
  - `update` round-trips both and preserves existing values when the patch omits
    them.
  - clearing `level` via patch removes the override.

## Out of scope (YAGNI)

- No bio/level fields in the Add dialog.
- No bio/level backfill into the "Find competitors" discovery → create flow
  (discovery candidates already expose `bio`; can be added later).
- No server-side sort/filter by `level` or search by `bio`.
