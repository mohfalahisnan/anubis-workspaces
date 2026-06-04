# Competitor bio + manual level override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Instagram `bio` (auto-filled from capture, manually editable) and a manual `level` override to tracked competitors, surfaced on the Competitors and Content pages.

**Architecture:** Two new nullable columns (`bio`, `level`) thread through the existing repo → service → shared-types → backend-zod → frontend stack, exactly mirroring the `notes` field. Level is a manual override that wins over the follower-derived `levelFor()` via a new pure `effectiveLevel()` helper used everywhere a level dot renders.

**Tech Stack:** TypeScript (ESM), better-sqlite3, Hono + Zod (backend), React 19 + Tailwind (frontend), Vitest.

---

## File structure

- **Migration** (create): `packages/conversation/src/db/migrations/005_competitors_bio_level.sql` — adds `bio` and `level` columns.
- **Migration index** (modify): `packages/conversation/src/db/migrations/index.ts` — register version 5.
- **Repo** (modify): `packages/conversation/src/db/repositories/competitors-repo.ts` — persist/read both columns.
- **Service** (modify): `packages/conversation/src/competitors/competitors-service.ts` — accept both on create/update; `level` is clearable.
- **Shared** (modify): `packages/shared/src/index.ts` — `CompetitorLevelOverride`, `effectiveLevel()`, field additions to summaries/inputs.
- **Backend zod** (modify): `packages/backend/src/competitors.ts` — validate both fields.
- **Capture** (modify): `packages/backend/src/captures.ts` — `deriveBio()`, persist bio on capture, join `competitorLevel` into the post feed.
- **Dot component** (modify): `packages/frontend/src/components/competitor-level-dot.tsx` — `levelOverride` prop.
- **Competitors page** (modify): `packages/frontend/src/pages/competitors.tsx` — filter, dot, card bio, Edit dialog bio + level fields.
- **Content page** (modify): `packages/frontend/src/pages/content.tsx` — filter + dot use override.
- **Tests** (modify): `packages/shared/tests/competitor-level.test.ts`, `packages/conversation/tests/competitors/competitors-service.test.ts`.

---

## Task 1: Shared `CompetitorLevelOverride` + `effectiveLevel()` (TDD)

**Files:**
- Modify: `packages/shared/src/index.ts` (after `levelFor`, ~line 223)
- Test: `packages/shared/tests/competitor-level.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/tests/competitor-level.test.ts`:

```ts
import { effectiveLevel } from '../src/index.js'

describe('effectiveLevel', () => {
  const cfg = DEFAULT_COMPETITOR_LEVELS

  it('uses the manual override when set, ignoring followers', () => {
    expect(effectiveLevel('red', 25_000, cfg)).toBe('red')
    expect(effectiveLevel('black', 25_000, cfg)).toBe('black')
  })

  it('falls back to the derived level when override is null/undefined', () => {
    expect(effectiveLevel(null, 25_000, cfg)).toBe('green')
    expect(effectiveLevel(undefined, 25_000, cfg)).toBe('green')
    expect(effectiveLevel(undefined, null, cfg)).toBe('unknown')
  })
})
```

> Note: add the `effectiveLevel` import to the existing import block at the top rather than a second `import` line if you prefer; a separate import line is also valid TypeScript.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/tests/competitor-level.test.ts`
Expected: FAIL — `effectiveLevel` is not exported from `../src/index.js`.

- [ ] **Step 3: Add the type and helper**

In `packages/shared/src/index.ts`, immediately after the `levelFor` function (after line 223, before `isValidCompetitorLevels`):

```ts
/** The manually-selectable levels — `'unknown'` is computed-only. */
export type CompetitorLevelOverride = Exclude<CompetitorLevel, 'unknown'>

/**
 * The level actually shown for a competitor: a manual override wins;
 * otherwise the follower-count-derived level is used.
 */
export function effectiveLevel(
  override: CompetitorLevelOverride | null | undefined,
  followers: number | null | undefined,
  cfg: CompetitorLevelsConfig = DEFAULT_COMPETITOR_LEVELS,
): CompetitorLevel {
  return override ?? levelFor(followers, cfg)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/tests/competitor-level.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/tests/competitor-level.test.ts
git commit -m "feat(shared): add CompetitorLevelOverride + effectiveLevel helper"
```

---

## Task 2: Add `bio` + `level` to shared field types

**Files:**
- Modify: `packages/shared/src/index.ts` (`CompetitorSummary` ~line 121, `CreateCompetitorInput` ~136, `UpdateCompetitorInput` ~146, `CapturedPostSummary` ~281)

- [ ] **Step 1: Extend `CompetitorSummary`**

Add these two lines inside `CompetitorSummary` (after `notes?: string`):

```ts
  bio?: string
  level?: CompetitorLevelOverride
```

- [ ] **Step 2: Extend `CreateCompetitorInput`**

Add inside `CreateCompetitorInput` (after `notes?: string`):

```ts
  bio?: string
  level?: CompetitorLevelOverride
```

- [ ] **Step 3: Extend `UpdateCompetitorInput`**

Add inside `UpdateCompetitorInput` (after the existing fields). `level` is nullable so the UI can clear the override back to "Auto":

```ts
  bio?: string
  level?: CompetitorLevelOverride | null
```

- [ ] **Step 4: Extend `CapturedPostSummary`**

Add after `competitorFollowers?: number` (line 300):

```ts
  /** Owning competitor's manual level override, joined in by the route layer. */
  competitorLevel?: CompetitorLevelOverride
```

- [ ] **Step 5: Typecheck the shared package**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add bio + level fields to competitor types"
```

---

## Task 3: DB migration

**Files:**
- Create: `packages/conversation/src/db/migrations/005_competitors_bio_level.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`

- [ ] **Step 1: Create the migration file**

`packages/conversation/src/db/migrations/005_competitors_bio_level.sql`:

```sql
-- Bio: the Instagram profile bio, auto-filled on capture, manually editable.
ALTER TABLE competitors ADD COLUMN bio TEXT;
-- Level: manual override of the followers-derived competitor level.
-- One of 'black' | 'green' | 'yellow' | 'red'; NULL means derive from followers.
ALTER TABLE competitors ADD COLUMN level TEXT;
```

- [ ] **Step 2: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, add to the `MIGRATIONS` array after the version-4 entry:

```ts
  load(5, '005_competitors_bio_level.sql'),
```

- [ ] **Step 3: Verify migrations apply**

Run: `pnpm vitest run packages/conversation/tests/competitors/competitors-service.test.ts`
Expected: PASS — the in-memory DB runs all migrations including 005 in `beforeEach`; existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/db/migrations/005_competitors_bio_level.sql packages/conversation/src/db/migrations/index.ts
git commit -m "feat(conversation): migration for competitor bio + level columns"
```

---

## Task 4: Repo — persist & read `bio` + `level`

**Files:**
- Modify: `packages/conversation/src/db/repositories/competitors-repo.ts`

- [ ] **Step 1: Extend the `Competitor` interface**

Add after `notes?: string` (line 15):

```ts
  bio?: string
  level?: CompetitorLevelOverride
```

Add the import at the top of the file:

```ts
import type { CompetitorLevelOverride } from '@anubis/shared'
```

- [ ] **Step 2: Extend the `Row` interface**

Add after `notes: string | null` (line 30):

```ts
  bio: string | null
  level: string | null
```

- [ ] **Step 3: Map both in `toCompetitor`**

Add after `notes: r.notes ?? undefined,` inside `toCompetitor`:

```ts
    bio: r.bio ?? undefined,
    level: (r.level as CompetitorLevelOverride | null) ?? undefined,
```

- [ ] **Step 4: Add columns to `insert`**

Update the `INSERT` statement column list and `VALUES` list to include `bio` and `level`, and add to the `.run({...})` object. The full statement becomes:

```ts
    this.db.prepare(`
      INSERT INTO competitors (
        id, handle, display_name, niche, tint, followers, avg_likes,
        post_count, last_refreshed_at, notes, bio, level, added_at, updated_at, deleted_at
      ) VALUES (
        @id, @handle, @displayName, @niche, @tint, @followers, @avgLikes,
        @postCount, @lastRefreshedAt, @notes, @bio, @level, @addedAt, @updatedAt, @deletedAt
      )
    `).run({
      id: c.id,
      handle: c.handle,
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
      addedAt: c.addedAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    })
```

- [ ] **Step 5: Add columns to `update`**

Update the `UPDATE` statement and its positional args. The full statement becomes:

```ts
    this.db
      .prepare(`
        UPDATE competitors SET
          display_name = ?, niche = ?, tint = ?, followers = ?,
          avg_likes = ?, post_count = ?, last_refreshed_at = ?, notes = ?,
          bio = ?, level = ?, updated_at = ?
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
        next.updatedAt,
        id,
      )
```

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @anubis/conversation build`
Expected: builds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/repositories/competitors-repo.ts
git commit -m "feat(conversation): persist competitor bio + level in repo"
```

---

## Task 5: Service — accept `bio` + clearable `level` (TDD)

**Files:**
- Modify: `packages/conversation/src/competitors/competitors-service.ts`
- Test: `packages/conversation/tests/competitors/competitors-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('CompetitorsService', ...)` block in `competitors-service.test.ts`:

```ts
  it('create round-trips bio and level', () => {
    const c = svc.create({ handle: '@figma', bio: 'Design tools', level: 'red' })
    expect(c.bio).toBe('Design tools')
    expect(c.level).toBe('red')
  })

  it('update sets and preserves bio and level', () => {
    const c = svc.create({ handle: '@canva' })
    const next = svc.update(c.id, { bio: 'Make designs', level: 'green' })
    expect(next.bio).toBe('Make designs')
    expect(next.level).toBe('green')
    // omitting them on a later patch preserves the stored values
    const after = svc.update(c.id, { niche: 'Design' })
    expect(after.bio).toBe('Make designs')
    expect(after.level).toBe('green')
  })

  it('update clears the level override when passed null', () => {
    const c = svc.create({ handle: '@webflow', level: 'yellow' })
    const next = svc.update(c.id, { level: null })
    expect(next.level).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/conversation/tests/competitors/competitors-service.test.ts`
Expected: FAIL — `bio`/`level` not accepted by `create`/`update` input types and not persisted.

- [ ] **Step 3: Extend the input interfaces**

In `competitors-service.ts`, add the import at the top:

```ts
import type { CompetitorLevelOverride } from '@anubis/shared'
```

Add to `CreateCompetitorInput` (after `notes?: string`):

```ts
  bio?: string
  level?: CompetitorLevelOverride
```

Add to `UpdateCompetitorInput` (after `notes?: string`):

```ts
  bio?: string
  level?: CompetitorLevelOverride | null
```

- [ ] **Step 4: Handle both in `create`**

In `create()`, add to the `competitor` object literal (after `notes: ...`):

```ts
      bio: input.bio?.trim() || undefined,
      level: input.level ?? undefined,
```

- [ ] **Step 5: Handle both in `update`**

In `update()`, extend the `repo.update(...)` patch object. `bio` mirrors `notes` (kept if omitted). `level` is clearable: a present-but-null patch clears it, an absent key preserves it:

```ts
    const next = this.repo.update(id, {
      displayName: patch.displayName ?? existing.displayName,
      niche: patch.niche ?? existing.niche,
      tint: patch.tint ?? existing.tint,
      followers: patch.followers ?? existing.followers,
      avgLikes: patch.avgLikes ?? existing.avgLikes,
      postCount: patch.postCount ?? existing.postCount,
      notes: patch.notes ?? existing.notes,
      bio: patch.bio ?? existing.bio,
      level: 'level' in patch ? (patch.level ?? undefined) : existing.level,
    })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/conversation/tests/competitors/competitors-service.test.ts`
Expected: PASS — all new and existing tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/competitors/competitors-service.ts packages/conversation/tests/competitors/competitors-service.test.ts
git commit -m "feat(conversation): accept bio + clearable level in competitors service"
```

---

## Task 6: Backend zod validation

**Files:**
- Modify: `packages/backend/src/competitors.ts`

- [ ] **Step 1: Extend `CreateBody`**

Add to the `CreateBody` object (before the closing `}).strict()`):

```ts
  bio: z.string().optional(),
  level: z.enum(['black', 'green', 'yellow', 'red']).optional(),
```

- [ ] **Step 2: Extend `UpdateBody`**

Add to the `UpdateBody` object (before the closing `}).strict()`). `nullable` lets the UI clear the override:

```ts
  bio: z.string().optional(),
  level: z.enum(['black', 'green', 'yellow', 'red']).nullable().optional(),
```

- [ ] **Step 3: Typecheck the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: builds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/competitors.ts
git commit -m "feat(backend): validate competitor bio + level fields"
```

---

## Task 7: Capture pipeline — persist bio, join level into feed

**Files:**
- Modify: `packages/backend/src/captures.ts`

- [ ] **Step 1: Add the `deriveBio` helper**

In `captures.ts`, after the `deriveDisplayName` function (~line 217), add:

```ts
function deriveBio(
  existing: string | undefined,
  profile: ProfileData | undefined,
): string | undefined {
  return profile?.bio?.trim() || existing
}
```

- [ ] **Step 2: Persist bio on capture**

In the capture handler's `stack.competitors.update(...)` call (~line 102), add a `bio` entry:

```ts
  stack.competitors.update(competitor.id, {
    displayName: deriveDisplayName(competitor.displayName, profileEntry),
    bio: deriveBio(competitor.bio, profileEntry),
    followers: profileEntry?.followers,
    avgLikes: avgLikesEntry?.avgLikes ?? profileEntry?.avgLikes,
    postCount: totalPostsInDb,
  })
```

- [ ] **Step 3: Join `competitorLevel` into `GET /posts`**

In the `postRoutes.get('/')` handler, in the `items` map (~line 156), add `competitorLevel`:

```ts
    return {
      ...row,
      competitorHandle: owner?.handle,
      competitorTint: owner?.tint,
      competitorFollowers: owner?.followers,
      competitorLevel: owner?.level,
    }
```

- [ ] **Step 4: Join `competitorLevel` in `enrichPost`**

In the `enrichPost` helper (~line 219), add `competitorLevel`:

```ts
  return {
    ...post,
    competitorHandle: owner?.handle,
    competitorTint: owner?.tint,
    competitorFollowers: owner?.followers,
    competitorLevel: owner?.level,
  }
```

- [ ] **Step 5: Typecheck the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: builds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/captures.ts
git commit -m "feat(backend): persist bio on capture, expose competitorLevel in feed"
```

---

## Task 8: `CompetitorLevelDot` — `levelOverride` prop

**Files:**
- Modify: `packages/frontend/src/components/competitor-level-dot.tsx`

- [ ] **Step 1: Import the override type**

Change the type import on line 1 to add `CompetitorLevelOverride`:

```ts
import type { CompetitorLevel, CompetitorLevelOverride, CompetitorLevelsConfig } from '@anubis/shared'
```

- [ ] **Step 2: Add the prop and use the override**

Add `levelOverride` to `Props`:

```ts
interface Props {
  followers: number | null | undefined
  levelOverride?: CompetitorLevelOverride | null
  config?: CompetitorLevelsConfig
  size?: 'sm' | 'md'
  className?: string
}
```

Update the component to honor the override and adjust the tooltip:

```ts
export function CompetitorLevelDot({ followers, levelOverride, config, size = 'sm', className }: Props) {
  const cfg = config ?? DEFAULT_COMPETITOR_LEVELS
  const level = levelOverride ?? levelFor(followers, cfg)
  const tip = levelOverride
    ? `Manually set — ${levelOverride}`
    : tooltipFor(level, followers, cfg)
  const dim = size === 'md' ? 10 : 8
  return (
    <span
      aria-label={tip}
      title={tip}
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

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend build`
Expected: builds (the existing call sites still compile because `levelOverride` is optional).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/competitor-level-dot.tsx
git commit -m "feat(frontend): CompetitorLevelDot honors a manual level override"
```

---

## Task 9: Competitors page — filter, dot, card bio, Edit dialog fields

**Files:**
- Modify: `packages/frontend/src/pages/competitors.tsx`

- [ ] **Step 1: Update imports**

Change the `@anubis/shared` import (line 15) to add `CompetitorLevelOverride` and `effectiveLevel`:

```ts
import type { CompetitorLevelsConfig, CompetitorLevelOverride, CompetitorSummary } from '@anubis/shared'
import { effectiveLevel } from '@anubis/shared'
```

- [ ] **Step 2: Use `effectiveLevel` in the visible-items filter**

Replace line 65:

```ts
  const visibleItems = items?.filter((c) =>
    matchesLevelFilter(effectiveLevel(c.level, c.followers, levelsCfg), levelFilter),
  )
```

- [ ] **Step 3: Widen the update patch type**

In the `handleUpdate` signature (~line 173) and in `EditCompetitorDialog`'s `onSave` prop type (~line 785), add `bio` and `level` to the patch shape. Both occurrences use this exact patch type — update both:

```ts
    patch: {
      displayName?: string
      niche?: string
      tint?: string
      followers?: number
      avgLikes?: number
      notes?: string
      bio?: string
      level?: CompetitorLevelOverride | null
    },
```

- [ ] **Step 4: Pass the override to the card dot**

Replace line 548:

```ts
            <CompetitorLevelDot followers={competitor.followers} levelOverride={competitor.level} config={levelsCfg} />
```

- [ ] **Step 5: Render bio on the card**

In `CompetitorCard`, inside the `min-w-0 flex-1` div, after the `displayName` paragraph block (after line 556, before the closing `</div>` of that block), add:

```tsx
          {competitor.bio && (
            <p className='mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground'>
              {competitor.bio}
            </p>
          )}
```

- [ ] **Step 6: Add bio + level state to `EditCompetitorDialog`**

In `EditCompetitorDialog`, add state alongside the existing fields (after the `notes` state, ~line 802):

```ts
  const [bio, setBio] = useState('')
  const [level, setLevel] = useState<CompetitorLevelOverride | ''>('')
```

Populate them in the `useEffect` (after `setNotes(...)`, ~line 811):

```ts
    setBio(competitor.bio ?? '')
    setLevel(competitor.level ?? '')
```

- [ ] **Step 7: Include bio + level in the submit patch**

In `EditCompetitorDialog`'s `submit`, extend the `onSave` patch object (after `notes: ...`):

```ts
      bio: bio.trim() || undefined,
      level: level === '' ? null : level,
```

- [ ] **Step 8: Add the Level select and Bio textarea to the dialog**

In `EditCompetitorDialog`'s JSX, add a Level field after the Followers/Avg-likes grid (after line 891) and a Bio textarea before the Notes field (before line 893):

```tsx
            <Field label='Level' htmlFor='edit-c-level' hint='Overrides the followers-based level. Auto = derive from followers.'>
              <select
                id='edit-c-level'
                value={level}
                onChange={(e) => setLevel(e.target.value as CompetitorLevelOverride | '')}
                className={textInput}
              >
                <option value=''>Auto (from followers)</option>
                <option value='black'>Black</option>
                <option value='green'>Green</option>
                <option value='yellow'>Yellow</option>
                <option value='red'>Red</option>
              </select>
            </Field>

            <Field label='Bio' htmlFor='edit-c-bio' hint='Auto-filled from Instagram on capture; edit to override.'>
              <textarea
                id='edit-c-bio'
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className={`${textInput} h-auto resize-none py-2 leading-relaxed`}
              />
            </Field>
```

- [ ] **Step 9: Typecheck and build the frontend**

Run: `pnpm --filter @anubis/frontend build`
Expected: builds with no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/src/pages/competitors.tsx
git commit -m "feat(frontend): bio on card + bio/level editing on Competitors page"
```

---

## Task 10: Content page — filter & dot use the override

**Files:**
- Modify: `packages/frontend/src/pages/content.tsx`

- [ ] **Step 1: Import `effectiveLevel`**

`content.tsx` currently has only a type-only import from `@anubis/shared` (line 25). Add a separate value import immediately after it:

```ts
import type { CapturedPostSummary, CompetitorSummary } from '@anubis/shared'
import { effectiveLevel } from '@anubis/shared'
```

- [ ] **Step 2: Use `effectiveLevel` in the level filter**

Replace line 417:

```ts
    .filter((card) =>
      matchesLevelFilter(
        effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg),
        levelFilter,
      ),
    )
```

- [ ] **Step 3: Pass the override to the dot**

Replace line 845:

```ts
          <CompetitorLevelDot followers={card.post?.competitorFollowers} levelOverride={card.post?.competitorLevel} config={levelsCfg} />
```

- [ ] **Step 4: Typecheck and build the frontend**

Run: `pnpm --filter @anubis/frontend build`
Expected: builds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/content.tsx
git commit -m "feat(frontend): Content page respects manual competitor level override"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS — all unit tests green, including the new shared and service tests.

- [ ] **Step 2: Typecheck every package**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 3: Manual smoke (optional, requires `pnpm dev`)**

- Open Competitors, edit a competitor, set Level = Red and a Bio → save.
- Confirm the card shows the bio (2-line clamp) and a red dot.
- Set Level back to "Auto (from followers)" → save → dot reverts to the follower-derived color.
- Confirm the same competitor's posts on the Content page show the red dot while the override is set.
```
