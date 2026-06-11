# Research Phase — Frontend Page Implementation Plan (Phase A, Part 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dedicated Research Phase page — competitor library summary, baseline performance, research controls, the scored/validated content-candidate table, validation filtering, and a candidate detail drawer — on top of the Plan 1 backend.

**Architecture:** A new `pages/research.tsx` (following the single-file page convention of `competitors.tsx`) composes six sections. Pure view-model logic lives in a tested `lib/research.ts`. API helpers extend the existing `api.ts`. A dedicated `CandidateLevelBadge` renders the green/yellow/neutral candidate level. Niche alignment is a **manual** per-row toggle (Phase B wires the AI step).

**Tech Stack:** React 19, Vite, Tailwind v4, shadcn/ui, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-12-research-phase-page-design.md`
**Depends on:** `docs/superpowers/plans/2026-06-12-research-phase-backend.md` (merged — provides `/research/*` routes and the shared scoring/DTO types).

---

## Deviations from spec (intentional)

1. **API helpers live in `api.ts`**, not a new `api/research.ts` — the private `api<T>()` fetch wrapper lives in `api.ts`, and competitor/posts helpers already sit there. Same convention.
2. **A dedicated `CandidateLevelBadge`** is added rather than re-pointing the existing `PostMultiplierBadge` (spec §11). The existing badge rates posts by `avgLikes` multiplier and is used on the Content page; the Research candidate level is a distinct concept (`baselineLikes` + `getCandidateLevel`, green/yellow/**neutral**). Keeping them separate avoids a behavior change to Content. (If you'd rather unify, that's a follow-up.)
3. **Capture is a separate action.** "Run research" scores from already-captured posts; a "Capture posts" button reuses the existing async `captureCompetitorsBatch` job (progress shows in the global job bar). No job-chaining.

## Testing notes (read first)

- **Frontend tests run via the frontend package's own Vitest** (the root config excludes them): `pnpm --filter @anubis/frontend exec vitest run <path>`.
- Vitest resolves `@anubis/shared` to its `dist/`. Plan 1 already built it; if in doubt run `pnpm --filter @anubis/shared build` first.
- Tests use jsdom + Testing Library and mock `@/api`, `@/lib/use-project`, `@/lib/navigation` (see the existing `tests/pages/discover-competitors.test.tsx` pattern).
- Run all commands from the repo root.

## File structure

**Create:**
- `packages/frontend/src/lib/research.ts` — pure view-model helpers (library summary, score/label formatting, validation reason).
- `packages/frontend/tests/lib/research.test.ts` — unit tests for the above.
- `packages/frontend/src/components/research/candidate-level-badge.tsx` — green/yellow/neutral badge.
- `packages/frontend/src/pages/research.tsx` — the page + its section subcomponents.
- `packages/frontend/tests/pages/research.test.tsx` — page component test.

**Modify:**
- `packages/frontend/src/api.ts` — research API helpers + shared-type imports.
- `packages/frontend/src/lib/navigation.tsx` — add `{ page: 'research' }` to `Route`.
- `packages/frontend/src/components/dashboard/index.tsx` — import + `CurrentPage` case + `BREADCRUMBS`.
- `packages/frontend/src/components/dashboard/data.ts` — sidebar nav item.

---

## Task 1: Pure view-model helpers (`lib/research.ts`)

**Files:**
- Create: `packages/frontend/src/lib/research.ts`
- Test: `packages/frontend/tests/lib/research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/lib/research.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { CompetitorSummary, ResearchCandidateSummary } from '@anubis/shared'
import { summarizeLibrary, formatScore, candidateValidationReason } from '@/lib/research'

function competitor(partial: Partial<CompetitorSummary>): CompetitorSummary {
  return {
    id: partial.id ?? 'c1',
    handle: partial.handle ?? '@c1',
    postCount: 0,
    addedAt: 0,
    updatedAt: 0,
    platform: partial.platform ?? 'instagram',
    status: partial.status ?? 'active',
    favorite: partial.favorite ?? false,
    niche: partial.niche,
    ...partial,
  }
}

function candidate(partial: Partial<ResearchCandidateSummary>): ResearchCandidateSummary {
  return {
    id: 'r1',
    sessionId: 's1',
    competitorId: 'c1',
    competitorLevel: 'green',
    postId: 'p1',
    candidateLevel: 'green',
    validationStatus: 'valid',
    validationFailures: [],
    decision: 'none',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('summarizeLibrary', () => {
  it('counts totals, favorites, and groups by platform/niche/status', () => {
    const s = summarizeLibrary([
      competitor({ id: 'a', favorite: true, platform: 'instagram', niche: 'Fitness', status: 'active' }),
      competitor({ id: 'b', platform: 'instagram', niche: 'Fitness', status: 'paused' }),
      competitor({ id: 'c', platform: 'tiktok', niche: 'Food', status: 'active' }),
    ])
    expect(s.total).toBe(3)
    expect(s.favorites).toBe(1)
    expect(s.byPlatform).toEqual({ instagram: 2, tiktok: 1 })
    expect(s.byNiche).toEqual({ Fitness: 2, Food: 1 })
    expect(s.byStatus).toEqual({ active: 2, paused: 1 })
  })

  it('buckets a missing niche under "Uncategorized"', () => {
    const s = summarizeLibrary([competitor({ niche: undefined })])
    expect(s.byNiche).toEqual({ Uncategorized: 1 })
  })
})

describe('formatScore', () => {
  it('formats a finite score as a multiplier', () => {
    expect(formatScore(20)).toBe('20.0×')
  })
  it('shows an em dash for missing/non-finite', () => {
    expect(formatScore(undefined)).toBe('—')
    expect(formatScore(null)).toBe('—')
  })
})

describe('candidateValidationReason', () => {
  it('explains a valid candidate', () => {
    expect(candidateValidationReason(candidate({ validationStatus: 'valid' }))).toMatch(/passes/i)
  })
  it('explains a pending candidate', () => {
    expect(candidateValidationReason(candidate({ validationStatus: 'pending' }))).toMatch(/niche/i)
  })
  it('lists failed rules for an invalid candidate', () => {
    const reason = candidateValidationReason(candidate({ validationStatus: 'invalid', validationFailures: ['recency', 'score'] }))
    expect(reason).toMatch(/old/i)
    expect(reason).toMatch(/score/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/lib/research.test.ts`
Expected: FAIL — `@/lib/research` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `packages/frontend/src/lib/research.ts`:

```ts
import type {
  CandidateLevel,
  CandidateValidationRule,
  CandidateValidationStatus,
  CompetitorSummary,
  ResearchCandidateSummary,
} from '@anubis/shared'

/** Tier colors for the candidate level (distinct from competitor level). */
export const CANDIDATE_LEVEL_COLOR: Record<CandidateLevel, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  neutral: '#6B6F78',
}

export const CANDIDATE_LEVEL_LABEL: Record<CandidateLevel, string> = {
  green: 'High priority',
  yellow: 'Good signal',
  neutral: 'Weak signal',
}

export const VALIDATION_LABEL: Record<CandidateValidationStatus, string> = {
  valid: 'Valid',
  invalid: 'Invalid',
  pending: 'Pending',
}

const VALIDATION_RULE_LABEL: Record<CandidateValidationRule, string> = {
  recency: 'Too old (beyond max content age)',
  niche: 'Off-niche',
  score: 'No valid score / baseline',
  source: 'Invalid competitor source',
}

export interface LibrarySummary {
  total: number
  favorites: number
  byPlatform: Record<string, number>
  byNiche: Record<string, number>
  byStatus: Record<string, number>
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export function summarizeLibrary(competitors: CompetitorSummary[]): LibrarySummary {
  const summary: LibrarySummary = { total: 0, favorites: 0, byPlatform: {}, byNiche: {}, byStatus: {} }
  for (const c of competitors) {
    summary.total += 1
    if (c.favorite) summary.favorites += 1
    bump(summary.byPlatform, c.platform ?? 'instagram')
    bump(summary.byNiche, c.niche?.trim() || 'Uncategorized')
    bump(summary.byStatus, c.status ?? 'active')
  }
  return summary
}

/** A multiplier score as "20.0×", or an em dash when missing/non-finite. */
export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—'
  return `${score.toFixed(1)}×`
}

/** Human-readable explanation of a candidate's validation outcome. */
export function candidateValidationReason(candidate: ResearchCandidateSummary): string {
  if (candidate.validationStatus === 'valid') {
    return 'Passes recency, score, source, and niche alignment.'
  }
  if (candidate.validationStatus === 'pending') {
    return 'Awaiting a niche-alignment decision.'
  }
  if (candidate.validationFailures.length === 0) return 'Invalid.'
  return candidate.validationFailures.map((f) => VALIDATION_RULE_LABEL[f] ?? f).join('; ')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/lib/research.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/research.ts packages/frontend/tests/lib/research.test.ts
git commit -m "feat(frontend): research view-model helpers"
```

---

## Task 2: Research API helpers (`api.ts`)

**Files:**
- Modify: `packages/frontend/src/api.ts` (shared-type imports near line 63; helpers after the competitor block ~line 478)

- [ ] **Step 1: Add the shared-type imports**

In `packages/frontend/src/api.ts`, add to the big `@anubis/shared` import block (after `type ImportSnapshotResult,` near line 65):

```ts
  type CreateResearchSessionInput,
  type ResearchControls,
  type ResearchSessionSummary,
  type ResearchSessionListResponse,
  type ResearchCandidateSummary,
  type ResearchCandidateListResponse,
  type UpdateResearchCandidateInput,
  type CandidateDecision,
  type CandidateLevel,
  type CandidateValidationStatus,
```

> `ResearchControls` is imported for the helper signatures even though `CreateResearchSessionInput` wraps it; keep it — the page passes a `ResearchControls` object.

- [ ] **Step 2: Add the helpers**

In `packages/frontend/src/api.ts`, after `updateCompetitor` (ends ~line 479), add:

```ts
/* ---------- Research Phase ---------- */

export async function createResearchSession(
  input: CreateResearchSessionInput,
): Promise<{ session: ResearchSessionSummary; candidates: ResearchCandidateSummary[] }> {
  const r = await api<{ ok: true; session: ResearchSessionSummary; candidates: ResearchCandidateSummary[] }>(
    '/research/sessions',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { session: r.session, candidates: r.candidates }
}

export async function listResearchSessions(projectId?: string): Promise<ResearchSessionSummary[]> {
  const path = projectId
    ? `/research/sessions?projectId=${encodeURIComponent(projectId)}`
    : '/research/sessions'
  const r = await api<ResearchSessionListResponse>(path)
  return r.items
}

export async function listSessionCandidates(sessionId: string): Promise<ResearchCandidateSummary[]> {
  const r = await api<ResearchCandidateListResponse>(
    `/research/sessions/${encodeURIComponent(sessionId)}/candidates`,
  )
  return r.items
}

export async function listResearchCandidates(
  opts: { projectId?: string; validation?: CandidateValidationStatus; level?: CandidateLevel; decision?: CandidateDecision } = {},
): Promise<ResearchCandidateSummary[]> {
  const params = new URLSearchParams()
  if (opts.projectId) params.set('projectId', opts.projectId)
  if (opts.validation) params.set('validation', opts.validation)
  if (opts.level) params.set('level', opts.level)
  if (opts.decision) params.set('decision', opts.decision)
  const qs = params.toString()
  const r = await api<ResearchCandidateListResponse>(`/research/candidates${qs ? `?${qs}` : ''}`)
  return r.items
}

export async function updateResearchCandidate(
  id: string,
  patch: UpdateResearchCandidateInput,
): Promise<ResearchCandidateSummary> {
  const r = await api<{ ok: true; candidate: ResearchCandidateSummary }>(
    `/research/candidates/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.candidate
}

// Re-exported so pages can build a controls object without importing from @anubis/shared directly.
export type { ResearchControls }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/frontend typecheck`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): research API helpers"
```

---

## Task 3: Candidate level badge

**Files:**
- Create: `packages/frontend/src/components/research/candidate-level-badge.tsx`
- Test: `packages/frontend/tests/components/candidate-level-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/candidate-level-badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CandidateLevelBadge } from '@/components/research/candidate-level-badge'

describe('<CandidateLevelBadge>', () => {
  it('renders the level label and exposes the level via data attribute', () => {
    render(<CandidateLevelBadge level='green' score={20} />)
    const badge = screen.getByText(/high priority/i)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[data-level]')?.getAttribute('data-level')).toBe('green')
  })

  it('shows the score multiplier when provided', () => {
    render(<CandidateLevelBadge level='neutral' score={1} />)
    expect(screen.getByText('1.0×')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/candidate-level-badge.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `packages/frontend/src/components/research/candidate-level-badge.tsx`:

```tsx
import type { CandidateLevel } from '@anubis/shared'
import { cn } from '@/lib/utils'
import { CANDIDATE_LEVEL_COLOR, CANDIDATE_LEVEL_LABEL, formatScore } from '@/lib/research'

export function CandidateLevelBadge({
  level,
  score,
  className,
}: {
  level: CandidateLevel
  score?: number | null
  className?: string
}) {
  const color = CANDIDATE_LEVEL_COLOR[level]
  const label = CANDIDATE_LEVEL_LABEL[level]
  return (
    <span
      data-level={level}
      title={`${label}${score != null ? ` — ${formatScore(score)} baseline` : ''}`}
      className={cn(
        'inline-flex h-[20px] shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px]',
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${color} 50%, transparent)`,
        color,
      }}
    >
      <span aria-hidden className='size-1.5 rounded-full' style={{ background: color }} />
      {label}
      {score != null && <span className='tabular-nums opacity-80'>{formatScore(score)}</span>}
    </span>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/candidate-level-badge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/research/candidate-level-badge.tsx packages/frontend/tests/components/candidate-level-badge.test.tsx
git commit -m "feat(frontend): candidate level badge"
```

---

## Task 4: Register the Research route

**Files:**
- Modify: `packages/frontend/src/lib/navigation.tsx:20` (Route union)
- Modify: `packages/frontend/src/components/dashboard/index.tsx` (import, `BREADCRUMBS`, `CurrentPage`)
- Modify: `packages/frontend/src/components/dashboard/data.ts` (nav item)

- [ ] **Step 1: Add the route to the union**

In `packages/frontend/src/lib/navigation.tsx`, add after `| { page: 'competitors' }`:

```ts
  | { page: 'research' }
```

- [ ] **Step 2: Wire the dashboard**

In `packages/frontend/src/components/dashboard/index.tsx`:

Add the import after the `CompetitorsPage` import (line 22):

```ts
import { ResearchPage } from '@/pages/research'
```

Add to `BREADCRUMBS` (after the `competitors:` line):

```ts
  research: 'Research',
```

Add to the `CurrentPage` switch (after the `competitors` case):

```ts
    case 'research':
      return <ResearchPage />
```

- [ ] **Step 3: Add the sidebar nav item**

In `packages/frontend/src/components/dashboard/data.ts`, add `FlaskConicalIcon` to the `lucide-react` import list, and add a nav item right after the Competitors entry:

```ts
  { label: 'Research', icon: FlaskConicalIcon, page: 'research' },
```

- [ ] **Step 4: Create a placeholder page so it compiles**

Create `packages/frontend/src/pages/research.tsx` with a stub (replaced in Task 5):

```tsx
export function ResearchPage() {
  return <div className='p-8 text-muted-foreground'>Research Phase</div>
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/navigation.tsx packages/frontend/src/components/dashboard/index.tsx packages/frontend/src/components/dashboard/data.ts packages/frontend/src/pages/research.tsx
git commit -m "feat(frontend): register Research page route + sidebar entry"
```

---

## Task 5: The Research page

Replaces the Task 4 stub with the full page: six sections, run handler, niche/decision actions, filters, and the candidate detail drawer.

**Files:**
- Modify (replace): `packages/frontend/src/pages/research.tsx`

- [ ] **Step 1: Write the full page**

Replace the entire contents of `packages/frontend/src/pages/research.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  DownloadCloudIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshCwIcon,
  StarIcon,
} from 'lucide-react'

import type {
  CandidateLevel,
  CandidateValidationStatus,
  CompetitorSummary,
  ResearchCandidateSummary,
  ResearchControls,
  ResearchSessionSummary,
} from '@anubis/shared'
import { useProject } from '@/lib/use-project'
import {
  captureCompetitorsBatch,
  createResearchSession,
  listCompetitors,
  updateCompetitor,
  updateResearchCandidate,
} from '@/api'
import { CandidateLevelBadge } from '@/components/research/candidate-level-badge'
import {
  CANDIDATE_LEVEL_LABEL,
  VALIDATION_LABEL,
  candidateValidationReason,
  formatScore,
  summarizeLibrary,
} from '@/lib/research'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type Banner = { kind: 'error' | 'success'; message: string }
type ValidationFilter = 'all' | CandidateValidationStatus
type LevelFilter = 'all' | CandidateLevel

const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

function formatBigNumber(n: number | undefined | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ResearchPage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id || undefined

  const [competitors, setCompetitors] = useState<CompetitorSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [running, setRunning] = useState(false)
  const [session, setSession] = useState<ResearchSessionSummary | null>(null)
  const [candidates, setCandidates] = useState<ResearchCandidateSummary[]>([])
  const [detail, setDetail] = useState<ResearchCandidateSummary | null>(null)
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')

  // Controls
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [platform, setPlatform] = useState('')
  const [niche, setNiche] = useState('')
  const [maxPostsPerProfile, setMaxPostsPerProfile] = useState(20)
  const [maxContentAgeDays, setMaxContentAgeDays] = useState(7)

  async function refreshCompetitors() {
    try {
      setCompetitors(await listCompetitors(projectId))
    } catch (e) {
      setCompetitors([])
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load competitors.' })
    }
  }

  useEffect(() => {
    void refreshCompetitors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const summary = useMemo(() => summarizeLibrary(competitors ?? []), [competitors])

  function buildControls(): ResearchControls {
    return {
      favoriteOnly,
      platform: platform.trim() || undefined,
      niche: niche.trim() || undefined,
      maxPostsPerProfile,
      maxContentAgeDays,
    }
  }

  async function runResearch() {
    setRunning(true)
    setBanner(null)
    try {
      const { session: s, candidates: c } = await createResearchSession({
        projectId,
        controls: buildControls(),
      })
      setSession(s)
      setCandidates(c)
      await refreshCompetitors() // baselines were recomputed
      setBanner({
        kind: 'success',
        message: `Found ${s.counts.candidates} candidate(s): ${s.counts.green} high, ${s.counts.yellow} good, ${s.counts.neutral} weak.`,
      })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Research run failed.' })
    } finally {
      setRunning(false)
    }
  }

  async function captureFresh() {
    const ids = (competitors ?? [])
      .filter((c) => (favoriteOnly ? c.favorite : true))
      .filter((c) => (platform.trim() ? c.platform === platform.trim() : true))
      .filter((c) => (niche.trim() ? c.niche === niche.trim() : true))
      .map((c) => c.id)
    if (ids.length === 0) {
      setBanner({ kind: 'error', message: 'No competitors match the current filters to capture.' })
      return
    }
    try {
      await captureCompetitorsBatch(ids, { targetPosts: maxPostsPerProfile })
      setBanner({ kind: 'success', message: `Capturing ${ids.length} competitor(s) — watch the top progress bar, then Run research.` })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Capture failed to start.' })
    }
  }

  async function setNicheVerdict(candidate: ResearchCandidateSummary, aligned: boolean | null) {
    try {
      const updated = await updateResearchCandidate(candidate.id, { nicheAligned: aligned })
      patchCandidate(updated)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update niche.' })
    }
  }

  async function setDecision(candidate: ResearchCandidateSummary, decision: ResearchCandidateSummary['decision']) {
    try {
      const updated = await updateResearchCandidate(candidate.id, { decision })
      patchCandidate(updated)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update candidate.' })
    }
  }

  function patchCandidate(updated: ResearchCandidateSummary) {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    setDetail((prev) => (prev && prev.id === updated.id ? updated : prev))
  }

  async function toggleFavorite(competitor: CompetitorSummary) {
    try {
      await updateCompetitor(competitor.id, { favorite: !competitor.favorite })
      await refreshCompetitors()
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update competitor.' })
    }
  }

  const visibleCandidates = useMemo(
    () =>
      candidates
        .filter((c) => validationFilter === 'all' || c.validationStatus === validationFilter)
        .filter((c) => levelFilter === 'all' || c.candidateLevel === levelFilter)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [candidates, validationFilter, levelFilter],
  )

  const competitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c] as const)),
    [competitors],
  )

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-2 pt-7'>
          <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>Research</h1>
          <p className='max-w-2xl text-[14px] leading-relaxed text-muted-foreground'>
            Turn competitor posts into a clean list of validated content candidates, scored against each
            competitor's own baseline performance.
          </p>
        </div>

        {banner && (
          <div
            role='status'
            className={cn(
              'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
              banner.kind === 'error'
                ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
                : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
            )}
          >
            {banner.message}
          </div>
        )}

        {/* 1. Competitor library summary */}
        <Section title='Competitor library' subtitle={`${summary.total} tracked · ${summary.favorites} favorite`}>
          <div className='flex flex-wrap gap-2'>
            <Chip label='Total' value={summary.total} />
            <Chip label='Favorites' value={summary.favorites} />
            {Object.entries(summary.byPlatform).map(([k, v]) => (
              <Chip key={`p-${k}`} label={k} value={v} />
            ))}
            {Object.entries(summary.byStatus).map(([k, v]) => (
              <Chip key={`s-${k}`} label={k} value={v} />
            ))}
          </div>
        </Section>

        {/* 2. Baseline performance */}
        <Section title='Baseline performance' subtitle='Median likes per competitor (recomputed on each run)'>
          <BaselineTable
            competitors={competitors ?? []}
            favoriteOnly={favoriteOnly}
            onToggleFavorite={(c) => void toggleFavorite(c)}
          />
        </Section>

        {/* 3. Research controls */}
        <Section title='Research controls' subtitle='Pick scope, then run the scorer'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            <Field label='Platform' hint='Blank = any'>
              <input className={textInput} value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder='instagram' />
            </Field>
            <Field label='Niche' hint='Exact match; blank = any'>
              <input className={textInput} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder='Fitness' />
            </Field>
            <Field label='Max posts / profile'>
              <input className={textInput} type='number' min={1} max={200} value={maxPostsPerProfile} onChange={(e) => setMaxPostsPerProfile(Math.max(1, Number(e.target.value) || 20))} />
            </Field>
            <Field label='Max content age (days)'>
              <input className={textInput} type='number' min={1} max={365} value={maxContentAgeDays} onChange={(e) => setMaxContentAgeDays(Math.max(1, Number(e.target.value) || 7))} />
            </Field>
            <label className='flex items-center gap-2 self-end pb-2 text-[13px] font-medium text-foreground'>
              <input type='checkbox' checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} className='size-4 accent-[var(--anubis-gold)]' />
              Favorite competitors only
            </label>
          </div>
          <div className='mt-4 flex flex-wrap gap-2.5'>
            <button
              type='button'
              onClick={() => void runResearch()}
              disabled={running}
              className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              <PlayIcon className='size-[15px]' strokeWidth={2.4} />
              {running ? 'Running…' : 'Run research'}
            </button>
            <button
              type='button'
              onClick={() => void captureFresh()}
              disabled={running}
              className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
            >
              <DownloadCloudIcon className='size-[15px]' strokeWidth={2} />
              Capture posts first
            </button>
            <button
              type='button'
              onClick={() => void refreshCompetitors()}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
          </div>
        </Section>

        {/* 4 + 5. Candidate table with validation filter */}
        <Section
          title='Content candidates'
          subtitle={session ? `${visibleCandidates.length} shown of ${candidates.length}` : 'Run research to populate'}
        >
          <div className='mb-3 flex flex-wrap gap-2'>
            <SegmentedFilter
              options={[
                { value: 'all', label: 'All' },
                { value: 'valid', label: 'Valid' },
                { value: 'pending', label: 'Pending' },
                { value: 'invalid', label: 'Invalid' },
              ]}
              value={validationFilter}
              onChange={(v) => setValidationFilter(v as ValidationFilter)}
            />
            <SegmentedFilter
              options={[
                { value: 'all', label: 'Any level' },
                { value: 'green', label: 'High' },
                { value: 'yellow', label: 'Good' },
                { value: 'neutral', label: 'Weak' },
              ]}
              value={levelFilter}
              onChange={(v) => setLevelFilter(v as LevelFilter)}
            />
          </div>
          <CandidateTable
            candidates={visibleCandidates}
            competitorById={competitorById}
            onOpen={(c) => setDetail(c)}
            onDecision={(c, d) => void setDecision(c, d)}
          />
        </Section>
      </div>

      {/* 6. Candidate detail drawer */}
      <CandidateDetailSheet
        candidate={detail}
        competitor={detail ? competitorById.get(detail.competitorId) : undefined}
        onClose={() => setDetail(null)}
        onNiche={(c, aligned) => void setNicheVerdict(c, aligned)}
        onDecision={(c, d) => void setDecision(c, d)}
      />
    </div>
  )
}

/* ---------- Layout helpers ---------- */

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className='mt-8'>
      <div className='mb-3'>
        <h2 className='text-[16px] font-semibold tracking-[-0.01em]'>{title}</h2>
        {subtitle && <p className='text-[12.5px] text-muted-foreground'>{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className='inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground tabular-nums'>
      <span className='font-medium text-foreground'>{value}</span>
      {label}
    </span>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label className='text-[12.5px] font-medium text-foreground'>{label}</label>
      {children}
      {hint && <p className='text-[11.5px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function SegmentedFilter({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className='inline-flex rounded-md border border-border bg-card p-0.5'>
      {options.map((opt) => (
        <button
          key={opt.value}
          type='button'
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
            value === opt.value ? 'bg-[var(--anubis-gold)] text-[#0B0C0F]' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Baseline table ---------- */

function BaselineTable({
  competitors,
  favoriteOnly,
  onToggleFavorite,
}: {
  competitors: CompetitorSummary[]
  favoriteOnly: boolean
  onToggleFavorite: (c: CompetitorSummary) => void
}) {
  const rows = competitors.filter((c) => (favoriteOnly ? c.favorite : true))
  if (rows.length === 0) {
    return <p className='rounded-md border border-dashed border-border bg-card/50 px-4 py-6 text-center text-[13px] text-muted-foreground'>No competitors yet.</p>
  }
  return (
    <div className='overflow-hidden rounded-md border border-border bg-card'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[640px] border-collapse text-left text-[13px]'>
          <thead className='border-b border-border bg-background/50 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
            <tr>
              <th className='px-3 py-2.5 font-medium'>Competitor</th>
              <th className='px-3 py-2.5 text-right font-medium'>Followers</th>
              <th className='px-3 py-2.5 text-right font-medium'>Baseline likes</th>
              <th className='px-3 py-2.5 text-right font-medium'>Posts</th>
              <th className='px-3 py-2.5 text-right font-medium'>Favorite</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className='border-b border-border/70 last:border-0'>
                <td className='px-3 py-3'>
                  <div className='font-mono text-[12px] font-semibold text-foreground'>{c.handle}</div>
                  {c.niche && <div className='text-[11px] text-muted-foreground'>{c.niche}</div>}
                </td>
                <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.followers)}</td>
                <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.baselineLikes)}</td>
                <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{c.postCount.toLocaleString()}</td>
                <td className='px-3 py-3 text-right'>
                  <button
                    type='button'
                    onClick={() => onToggleFavorite(c)}
                    aria-label={c.favorite ? `Unfavorite ${c.handle}` : `Favorite ${c.handle}`}
                    className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted'
                  >
                    <StarIcon className={cn('size-4', c.favorite && 'fill-[var(--anubis-gold)] text-[var(--anubis-gold)]')} strokeWidth={2} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- Candidate table ---------- */

function CandidateTable({
  candidates,
  competitorById,
  onOpen,
  onDecision,
}: {
  candidates: ResearchCandidateSummary[]
  competitorById: Map<string, CompetitorSummary>
  onOpen: (c: ResearchCandidateSummary) => void
  onDecision: (c: ResearchCandidateSummary, decision: ResearchCandidateSummary['decision']) => void
}) {
  if (candidates.length === 0) {
    return <p className='rounded-md border border-dashed border-border bg-card/50 px-4 py-8 text-center text-[13px] text-muted-foreground'>No candidates to show.</p>
  }
  return (
    <div className='overflow-hidden rounded-md border border-border bg-card'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[900px] border-collapse text-left text-[13px]'>
          <thead className='border-b border-border bg-background/50 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
            <tr>
              <th className='px-3 py-2.5 font-medium'>Status</th>
              <th className='px-3 py-2.5 font-medium'>Competitor</th>
              <th className='px-3 py-2.5 font-medium'>Date</th>
              <th className='px-3 py-2.5 text-right font-medium'>Likes</th>
              <th className='px-3 py-2.5 text-right font-medium'>Baseline</th>
              <th className='px-3 py-2.5 text-right font-medium'>Score</th>
              <th className='px-3 py-2.5 font-medium'>Level</th>
              <th className='px-3 py-2.5 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const competitor = competitorById.get(c.competitorId)
              return (
                <tr key={c.id} className='border-b border-border/70 last:border-0 hover:bg-muted/40'>
                  <td className='px-3 py-3'><ValidationPill status={c.validationStatus} decision={c.decision} /></td>
                  <td className='px-3 py-3'>
                    <div className='font-mono text-[12px] font-semibold text-foreground'>{competitor?.handle ?? c.competitorId}</div>
                    <div className='text-[11px] text-muted-foreground'>{c.platform ?? 'instagram'}</div>
                  </td>
                  <td className='px-3 py-3 font-mono text-[11.5px] text-muted-foreground'>{formatDate(c.postedAt)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.likes)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.baselineLikes)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatScore(c.score)}</td>
                  <td className='px-3 py-3'><CandidateLevelBadge level={c.candidateLevel} /></td>
                  <td className='px-3 py-3'>
                    <div className='flex justify-end gap-1'>
                      {c.postUrl && (
                        <a
                          href={c.postUrl}
                          target='_blank'
                          rel='noreferrer'
                          aria-label='View post'
                          className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                        >
                          <ExternalLinkIcon className='size-3.5' strokeWidth={2} />
                        </a>
                      )}
                      <button type='button' onClick={() => onOpen(c)} className='inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'>
                        Details
                      </button>
                      <button type='button' onClick={() => onDecision(c, 'saved')} className='inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] hover:text-[var(--anubis-gold)]'>
                        Save
                      </button>
                      <button type='button' onClick={() => onDecision(c, 'rejected')} className='inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive'>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ValidationPill({ status, decision }: { status: CandidateValidationStatus; decision: ResearchCandidateSummary['decision'] }) {
  const color = status === 'valid' ? '#5E8F55' : status === 'invalid' ? '#B5483E' : '#C9A645'
  return (
    <div className='flex flex-col items-start gap-1'>
      <span className='inline-flex items-center gap-1.5 text-[11.5px] font-medium' style={{ color }}>
        <span aria-hidden className='size-1.5 rounded-full' style={{ background: color }} />
        {VALIDATION_LABEL[status]}
      </span>
      {decision !== 'none' && (
        <span className='rounded border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground'>{decision}</span>
      )}
    </div>
  )
}

/* ---------- Detail drawer ---------- */

function CandidateDetailSheet({
  candidate,
  competitor,
  onClose,
  onNiche,
  onDecision,
}: {
  candidate: ResearchCandidateSummary | null
  competitor: CompetitorSummary | undefined
  onClose: () => void
  onNiche: (c: ResearchCandidateSummary, aligned: boolean | null) => void
  onDecision: (c: ResearchCandidateSummary, decision: ResearchCandidateSummary['decision']) => void
}) {
  return (
    <Sheet open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className='flex flex-col gap-4 overflow-y-auto'>
        {candidate && (
          <>
            <SheetHeader>
              <SheetTitle>{competitor?.handle ?? candidate.competitorId}</SheetTitle>
              <SheetDescription>{formatDate(candidate.postedAt)} · {candidate.platform ?? 'instagram'}</SheetDescription>
            </SheetHeader>

            <div className='flex items-center gap-2'>
              <CandidateLevelBadge level={candidate.candidateLevel} score={candidate.score} />
              <span className='text-[12px] text-muted-foreground'>{CANDIDATE_LEVEL_LABEL[candidate.candidateLevel]}</span>
            </div>

            {candidate.postUrl && (
              <a href={candidate.postUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1.5 text-[12.5px] text-[var(--anubis-gold)] hover:underline'>
                <ExternalLinkIcon className='size-3.5' /> Open original post
              </a>
            )}

            {candidate.caption && (
              <p className='whitespace-pre-wrap rounded-md border border-border bg-background/40 p-3 text-[12.5px] leading-relaxed text-foreground'>
                {candidate.caption}
              </p>
            )}

            <dl className='grid grid-cols-2 gap-3 text-[12.5px]'>
              <Detail label='Likes' value={formatBigNumber(candidate.likes)} />
              <Detail label='Baseline likes' value={formatBigNumber(candidate.baselineLikes)} />
              <Detail label='Score' value={formatScore(candidate.score)} />
              <Detail label='Competitor level' value={candidate.competitorLevel} />
            </dl>

            <div className='rounded-md border border-border bg-background/40 p-3'>
              <div className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>Validation</div>
              <div className='mt-1 text-[13px] font-medium'>{VALIDATION_LABEL[candidate.validationStatus]}</div>
              <p className='mt-1 text-[12px] text-muted-foreground'>{candidateValidationReason(candidate)}</p>
            </div>

            <div>
              <div className='mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>Niche alignment</div>
              <div className='flex gap-2'>
                <button type='button' onClick={() => onNiche(candidate, true)} className={cn('h-8 rounded-md border px-3 text-[12.5px] font-medium', candidate.nicheAligned === true ? 'border-[#5E8F55] text-[#5E8F55]' : 'border-border text-muted-foreground hover:text-foreground')}>Aligned</button>
                <button type='button' onClick={() => onNiche(candidate, false)} className={cn('h-8 rounded-md border px-3 text-[12.5px] font-medium', candidate.nicheAligned === false ? 'border-[#B5483E] text-[#B5483E]' : 'border-border text-muted-foreground hover:text-foreground')}>Off-niche</button>
                <button type='button' onClick={() => onNiche(candidate, null)} className='h-8 rounded-md border border-border px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground'>Clear</button>
              </div>
            </div>

            <div className='mt-auto flex gap-2 pt-2'>
              <button type='button' onClick={() => onDecision(candidate, 'saved')} className='inline-flex h-9 flex-1 items-center justify-center rounded-md bg-[var(--anubis-gold)] px-3 text-[13px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]'>Save to library</button>
              <button type='button' onClick={() => onDecision(candidate, 'rejected')} className='inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground hover:text-destructive'>Reject</button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</dt>
      <dd className='font-mono text-[13px] tabular-nums text-foreground'>{value}</dd>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: succeeds.

> If `captureCompetitorsBatch`'s options type rejects `targetPosts`, check its `CaptureOptions` type in `api.ts` and pass the supported field (it accepts `targetPosts` per the helper signature at `api.ts:556`).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/research.tsx
git commit -m "feat(frontend): Research Phase page (sections, candidate table, detail drawer)"
```

---

## Task 6: Page component test

**Files:**
- Create: `packages/frontend/tests/pages/research.test.tsx`

- [ ] **Step 1: Write the test**

Create `packages/frontend/tests/pages/research.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CompetitorSummary, ResearchCandidateSummary, ResearchSessionSummary } from '@anubis/shared'

const mocks = vi.hoisted(() => ({
  listCompetitors: vi.fn(),
  createResearchSession: vi.fn(),
  updateResearchCandidate: vi.fn(),
  updateCompetitor: vi.fn(),
  captureCompetitorsBatch: vi.fn(),
}))

vi.mock('@/api', () => ({
  listCompetitors: mocks.listCompetitors,
  createResearchSession: mocks.createResearchSession,
  updateResearchCandidate: mocks.updateResearchCandidate,
  updateCompetitor: mocks.updateCompetitor,
  captureCompetitorsBatch: mocks.captureCompetitorsBatch,
}))

vi.mock('@/lib/use-project', () => ({
  useProject: () => ({ activeProject: { id: 'default', name: 'Default Project' } }),
}))

import { ResearchPage } from '@/pages/research'

function competitor(p: Partial<CompetitorSummary>): CompetitorSummary {
  return { id: 'c1', handle: '@creator', postCount: 5, addedAt: 0, updatedAt: 0, platform: 'instagram', status: 'active', favorite: false, baselineLikes: 50, followers: 25_000, ...p }
}
function candidate(p: Partial<ResearchCandidateSummary>): ResearchCandidateSummary {
  return { id: 'r1', sessionId: 's1', competitorId: 'c1', competitorLevel: 'green', postId: 'p1', candidateLevel: 'green', validationStatus: 'pending', validationFailures: [], decision: 'none', createdAt: 0, updatedAt: 0, likes: 1000, baselineLikes: 50, score: 20, postUrl: 'https://www.instagram.com/p/x/', postedAt: new Date().toISOString(), ...p }
}
const session: ResearchSessionSummary = {
  id: 's1', controls: {}, status: 'done',
  counts: { candidates: 1, valid: 0, green: 1, yellow: 0, neutral: 0 },
  createdAt: 0, updatedAt: 0,
}

describe('<ResearchPage>', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset())
    mocks.listCompetitors.mockResolvedValue([competitor({})])
  })

  it('runs research and renders scored candidates', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [candidate({})] })

    render(<ResearchPage />)
    await waitFor(() => expect(mocks.listCompetitors).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /run research/i }))

    await waitFor(() => expect(mocks.createResearchSession).toHaveBeenCalledTimes(1))
    // The viral candidate shows its 20× score and high-priority level.
    expect(await screen.findByText('20.0×')).toBeInTheDocument()
    expect(screen.getByText(/high priority/i)).toBeInTheDocument()
  })

  it('marks niche aligned from the detail drawer and reflects the new validation', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [candidate({})] })
    mocks.updateResearchCandidate.mockResolvedValue(candidate({ nicheAligned: true, validationStatus: 'valid' }))

    render(<ResearchPage />)
    await userEvent.click(screen.getByRole('button', { name: /run research/i }))
    await screen.findByText('20.0×')

    await userEvent.click(screen.getByRole('button', { name: /details/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^aligned$/i }))

    await waitFor(() => expect(mocks.updateResearchCandidate).toHaveBeenCalledWith('r1', { nicheAligned: true }))
  })

  it('passes the favorite-only and age controls through to the run', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [] })

    render(<ResearchPage />)
    await waitFor(() => expect(mocks.listCompetitors).toHaveBeenCalled())

    await userEvent.click(screen.getByLabelText(/favorite competitors only/i))
    await userEvent.click(screen.getByRole('button', { name: /run research/i }))

    await waitFor(() => expect(mocks.createResearchSession).toHaveBeenCalledTimes(1))
    const arg = mocks.createResearchSession.mock.calls[0][0]
    expect(arg.projectId).toBe('default')
    expect(arg.controls).toMatchObject({ favoriteOnly: true, maxPostsPerProfile: 20, maxContentAgeDays: 7 })
  })
})
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/research.test.tsx`
Expected: PASS (3 tests).

> If the niche test can't find a unique "Aligned" button, scope the query with `within(screen.getByRole('dialog'))` — the Sheet renders as a Radix dialog.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/tests/pages/research.test.tsx
git commit -m "test(frontend): Research page component test"
```

---

## Final verification

- [ ] **Step 1: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: passes.

- [ ] **Step 2: Run all new frontend tests together**

Run:
```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/research.test.ts tests/components/candidate-level-badge.test.tsx tests/pages/research.test.tsx
```
Expected: all PASS.

- [ ] **Step 3: Build the frontend to confirm the production bundle compiles**

Run: `pnpm --filter @anubis/frontend build`
Expected: succeeds (Vite build with the new page in the bundle).

- [ ] **Step 4 (manual, optional): Smoke-test in the running app**

Use the `run` skill (or `pnpm dev`) to launch the desktop app, open the **Research** sidebar entry, click **Run research** with some captured competitors, and confirm candidates render with scores/levels and the detail drawer opens. Capture is a long-running CDP job — verify the "Capture posts first" button kicks off the global progress bar.

---

## Spec coverage (self-review)

- §7.1 Competitor library section → Task 5 (library summary + favorite toggle in baseline table).
- §7.2 Baseline performance → Task 5 `BaselineTable`.
- §7.3 Research controls (platform, niche, favoriteOnly, maxPosts=20, maxAge=7, run) → Task 5 controls + `runResearch`.
- §7.4 Content candidate table (status, competitor, platform, date, likes, baseline, score, level, validation, actions) → Task 5 `CandidateTable`; actions view-post/details/save/reject.
- §7.5 Candidate detail preview (post link, caption, competitor info, score, level, validation reason, save) → Task 5 `CandidateDetailSheet`.
- §8 Expected output `validatedContentCandidates` → validation filter = Valid + decision Save.
- Scoring/level rendering → Task 3 `CandidateLevelBadge` + Plan 1 shared functions.

**Deferred:** §7 niche AI step (Phase B); search/pagination on the candidate table (not required by spec; add if the set grows large).

---

## Next

**Phase B** (separate plan): batched AI niche-alignment route (`POST /research/sessions/:id/validate-niche`) against the workspace knowledge base, auto-run as step 5 of the research flow, with the manual toggle retained as override.
