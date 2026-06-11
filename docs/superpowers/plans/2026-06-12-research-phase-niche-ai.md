# Research Phase — AI Niche Validation Implementation Plan (Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI niche-alignment pass: a button that runs one batched Claude agent call over a session's pending candidates, judging each caption against the workspace knowledge base, and fills `nicheAligned`/`nicheReason` (which finalizes validation). The manual per-row toggle stays as an override.

**Architecture:** A pure, testable niche module in the backend builds the prompt and parses the agent's JSON verdicts; an orchestrator takes an injected `ask(prompt)` function so it's unit-testable without spawning Claude. A new `POST /research/sessions/:id/validate-niche` route wires the real `stack.aiAgent.runAgent` (read-only, in the project workdir), optionally pre-injecting niche context via `contextPack`, then applies verdicts through `ResearchService.updateCandidate`. The frontend adds a "Validate niche" button.

**Tech Stack:** TypeScript (ESM), Hono, Zod, Vitest; the in-process `AiAgentService` (`claude`).

**Spec:** `docs/superpowers/specs/2026-06-12-research-phase-page-design.md` (§7 AI niche validation).
**Depends on:** Phase A backend + frontend (merged).

**Resolved decision:** Niche validation is triggered by an **explicit button** on the Research page, run over the session's `pending` candidates only — NOT auto-run on every research run. (The spec's §11 mentioned auto-run; this supersedes it to control latency/token cost.)

## Testing notes

- Backend tests: `pnpm vitest run <path> --maxWorkers=2` from the repo root. Rebuild `@anubis/shared` / `@anubis/conversation` before backend tests if they changed (they don't in this plan). `ERR_DLOPEN_FAILED` → `pnpm rebuild better-sqlite3`.
- Frontend tests: `pnpm --filter @anubis/frontend exec vitest run <path>`.
- The full agent call is **not** integration-tested (it would spawn Claude). Coverage comes from (a) unit tests of the pure prompt/parse/orchestrator with a fake `ask`, and (b) a route test of the no-workdir error path (no agent spawned).

## File structure

**Create:**
- `packages/backend/src/research-niche.ts` — pure: `buildNichePrompt`, `parseNicheVerdicts`, `validateSessionNiche(ask)`.
- `packages/backend/tests/research-niche.test.ts` — unit tests.
- `packages/backend/tests/research-niche-route.test.ts` — route no-workdir path.

**Modify:**
- `packages/backend/src/research.ts` — add `POST /research/sessions/:id/validate-niche`.
- `packages/frontend/src/api.ts` — `validateSessionNiche` helper.
- `packages/frontend/src/pages/research.tsx` — "Validate niche" button + handler.
- `packages/frontend/tests/pages/research.test.tsx` — niche-button test.

---

## Task 1: Pure niche module

**Files:**
- Create: `packages/backend/src/research-niche.ts`
- Test: `packages/backend/tests/research-niche.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/research-niche.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildNichePrompt, parseNicheVerdicts, validateSessionNiche, type NicheItem } from '../src/research-niche.js'

const items: NicheItem[] = [
  { id: 'r1', caption: 'Full body dumbbell workout at home', competitorHandle: '@fitcoach', competitorNiche: 'Fitness' },
  { id: 'r2', caption: 'My favorite pasta recipe', competitorHandle: '@chef', competitorNiche: 'Food' },
]

describe('buildNichePrompt', () => {
  it('includes each id, caption, and the niche context', () => {
    const p = buildNichePrompt(items, 'We coach home fitness for busy parents.')
    expect(p).toContain('r1')
    expect(p).toContain('dumbbell workout')
    expect(p).toContain('home fitness for busy parents')
    expect(p).toMatch(/JSON array/i)
  })
  it('falls back to a workspace-infer note when no context', () => {
    expect(buildNichePrompt(items)).toMatch(/infer/i)
  })
})

describe('parseNicheVerdicts', () => {
  const ids = new Set(['r1', 'r2'])

  it('parses a plain JSON array', () => {
    const out = parseNicheVerdicts('[{"id":"r1","aligned":true,"reason":"fitness"},{"id":"r2","aligned":false,"reason":"food"}]', ids)
    expect(out).toEqual([
      { id: 'r1', aligned: true, reason: 'fitness' },
      { id: 'r2', aligned: false, reason: 'food' },
    ])
  })
  it('tolerates markdown fences and surrounding prose', () => {
    const text = 'Here are the verdicts:\n```json\n[{"id":"r1","aligned":true,"reason":"ok"}]\n```\nDone.'
    expect(parseNicheVerdicts(text, ids)).toEqual([{ id: 'r1', aligned: true, reason: 'ok' }])
  })
  it('tolerates an object wrapper around the array', () => {
    const text = '{"verdicts":[{"id":"r2","aligned":true,"reason":"x"}]}'
    expect(parseNicheVerdicts(text, ids)).toEqual([{ id: 'r2', aligned: true, reason: 'x' }])
  })
  it('drops unknown ids, coerces aligned (true/"true" only), and defaults a non-string reason', () => {
    const out = parseNicheVerdicts('[{"id":"nope","aligned":true,"reason":"x"},{"id":"r1","aligned":"true","reason":7}]', ids)
    expect(out).toEqual([{ id: 'r1', aligned: true, reason: '' }])
  })
  it('treats ambiguous aligned values as off-niche', () => {
    expect(parseNicheVerdicts('[{"id":"r1","aligned":"maybe","reason":"unsure"}]', ids)).toEqual([
      { id: 'r1', aligned: false, reason: 'unsure' },
    ])
  })
  it('throws when there is no JSON array', () => {
    expect(() => parseNicheVerdicts('the agent refused', ids)).toThrow()
  })
})

describe('validateSessionNiche', () => {
  it('asks once and returns parsed verdicts', async () => {
    let asked = ''
    const verdicts = await validateSessionNiche({
      items,
      nicheContext: 'home fitness',
      ask: async (prompt) => { asked = prompt; return '[{"id":"r1","aligned":true,"reason":"fitness fit"}]' },
    })
    expect(asked).toContain('r1')
    expect(verdicts).toEqual([{ id: 'r1', aligned: true, reason: 'fitness fit' }])
  })
  it('returns [] without asking when there are no items', async () => {
    let called = false
    const out = await validateSessionNiche({ items: [], ask: async () => { called = true; return '[]' } })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/research-niche.test.ts --maxWorkers=2`
Expected: FAIL — `../src/research-niche.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/backend/src/research-niche.ts`:

```ts
export interface NicheItem {
  id: string
  caption: string
  competitorHandle: string
  competitorNiche?: string
}

export interface NicheVerdict {
  id: string
  aligned: boolean
  reason: string
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function buildNichePrompt(items: NicheItem[], nicheContext?: string): string {
  const lines = items.map(
    (it, i) =>
      `${i + 1}. id: ${it.id} | competitor: ${it.competitorHandle}${it.competitorNiche ? ` (${it.competitorNiche})` : ''}\n   caption: ${truncate(it.caption, 400)}`,
  )
  return [
    'Classify each competitor Instagram post below for alignment with OUR content niche.',
    '',
    'OUR NICHE (from our workspace knowledge base):',
    nicheContext && nicheContext.length > 0
      ? nicheContext
      : '(No explicit niche notes found — infer our niche from the workspace files you can read.)',
    '',
    'For EACH post, decide if its topic/content fits OUR niche, audience, and positioning.',
    'Return ONLY a JSON array of objects {"id": string, "aligned": boolean, "reason": string}.',
    'Keep reason <= 160 chars. No markdown, no extra text.',
    '',
    'POSTS:',
    ...lines,
  ].join('\n')
}

/** Pull the first JSON array out of arbitrary agent text (handles fences / prose / object wrappers). */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON array found in agent output.')
  }
  return JSON.parse(text.slice(start, end + 1))
}

export function parseNicheVerdicts(text: string, validIds: Set<string>): NicheVerdict[] {
  const arr = extractJsonArray(text)
  if (!Array.isArray(arr)) throw new Error('Niche verdict output was not a JSON array.')
  const out: NicheVerdict[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' || !validIds.has(id)) continue
    const rawAligned = (item as { aligned?: unknown }).aligned
    const aligned = rawAligned === true || rawAligned === 'true'
    const rawReason = (item as { reason?: unknown }).reason
    const reason = typeof rawReason === 'string' ? rawReason : ''
    out.push({ id, aligned, reason })
  }
  return out
}

export async function validateSessionNiche(args: {
  items: NicheItem[]
  nicheContext?: string
  ask: (prompt: string) => Promise<string>
}): Promise<NicheVerdict[]> {
  if (args.items.length === 0) return []
  const prompt = buildNichePrompt(args.items, args.nicheContext)
  const text = await args.ask(prompt)
  return parseNicheVerdicts(text, new Set(args.items.map((it) => it.id)))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/research-niche.test.ts --maxWorkers=2`
Expected: PASS. (Only `true`/`"true"` count as aligned — any other value is treated as off-niche, the safe default.)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/research-niche.ts packages/backend/tests/research-niche.test.ts
git commit -m "feat(backend): pure niche-classification module (prompt/parse/orchestrate)"
```

---

## Task 2: The validate-niche route

**Files:**
- Modify: `packages/backend/src/research.ts`
- Test: `packages/backend/tests/research-niche-route.test.ts`

- [ ] **Step 1: Add the route**

In `packages/backend/src/research.ts`, add the import at the top (after the existing imports):

```ts
import { validateSessionNiche, type NicheItem } from './research-niche.js'
```

Then add this route immediately after the `researchRoutes.post('/sessions', ...)` handler:

```ts
researchRoutes.post('/sessions/:id/validate-niche', async (c) => {
  const sessionId = c.req.param('id')
  const stack = getStack()
  const session = stack.research.getSession(sessionId)
  if (!session) return c.json({ ok: false, error: 'not_found' }, 404)

  const projectId = session.projectId ?? 'default'
  const project = stack.projects.findById(projectId)
  if (!project?.workdir) {
    return c.json(
      { ok: false, error: 'no_workdir', message: 'This project has no workspace directory; set one to use AI niche validation.' },
      400,
    )
  }

  const pending = stack.research
    .listCandidates({ sessionId })
    .filter((x) => x.validationStatus === 'pending')
  if (pending.length === 0) {
    return c.json({ ok: true, updated: 0, candidates: [] })
  }

  const items: NicheItem[] = pending.map((cand) => {
    const competitor = stack.competitors.get(cand.competitorId)
    return {
      id: cand.id,
      caption: cand.caption ?? '',
      competitorHandle: competitor?.handle ?? cand.competitorId,
      competitorNiche: competitor?.niche,
    }
  })

  // Best-effort niche context from the workspace knowledge base.
  let nicheContext: string | undefined
  try {
    const { contextPack } = await import('./knowledge-base.js')
    const res = await contextPack({ projectId, query: 'our niche, brand, target audience, content positioning', budget: 1500 })
    nicheContext = res.text?.trim() || undefined
  } catch {
    nicheContext = undefined
  }

  const workdir = project.workdir
  const ask = (prompt: string) =>
    stack.aiAgent
      .runAgent({
        agent: 'claude',
        cwd: workdir,
        prompt,
        appendSystemPrompt: 'You output ONLY valid JSON (a single array). No markdown fences, no prose.',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      })
      .then((r) => r.text)

  let verdicts
  try {
    verdicts = await validateSessionNiche({ items, nicheContext, ask })
  } catch (e) {
    return c.json({ ok: false, error: 'agent_failed', message: e instanceof Error ? e.message : 'Niche validation failed.' }, 502)
  }

  const updated = []
  for (const v of verdicts) {
    const u = stack.research.updateCandidate(v.id, { nicheAligned: v.aligned, nicheReason: v.reason })
    if (u) updated.push(u)
  }
  return c.json({ ok: true, updated: updated.length, candidates: updated })
})
```

- [ ] **Step 2: Write the route test (no-workdir path)**

Create `packages/backend/tests/research-niche-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-niche-'))
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
  return (await import('../src/app.js')).default
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('POST /research/sessions/:id/validate-niche', () => {
  it('404s for an unknown session', async () => {
    const app = await loadApp()
    const res = await app.request('/research/sessions/nope/validate-niche', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(404)
  })

  it('400s when the project has no workspace directory (default project)', async () => {
    const app = await loadApp()
    const comp = await app.request('/competitors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@nichetest', projectId: 'default', followers: 25_000 }),
    }).then((r) => r.json()) as { competitor: { id: string } }

    await app.request('/posts/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posts: [
        { id: 'np1', competitorId: comp.competitor.id, username: 'nichetest', postUrl: 'https://www.instagram.com/p/np1/', likes: 50, postedAt: isoDaysAgo(1) },
        { id: 'np2', competitorId: comp.competitor.id, username: 'nichetest', postUrl: 'https://www.instagram.com/p/np2/', likes: 1000, postedAt: isoDaysAgo(1) },
      ] }),
    })

    const created = await app.request('/research/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'default', controls: {} }),
    }).then((r) => r.json()) as { session: { id: string } }

    const res = await app.request(`/research/sessions/${created.session.id}/validate-niche`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('no_workdir')
  })
})
```

- [ ] **Step 3: Build deps and run the route test**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build && pnpm vitest run packages/backend/tests/research-niche-route.test.ts --maxWorkers=2`
Expected: PASS (2 tests). (`pnpm rebuild better-sqlite3` first if `ERR_DLOPEN_FAILED`.)

- [ ] **Step 4: Typecheck the backend**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/research.ts packages/backend/tests/research-niche-route.test.ts
git commit -m "feat(backend): POST /research/sessions/:id/validate-niche (AI niche pass)"
```

---

## Task 3: Frontend API helper

**Files:**
- Modify: `packages/frontend/src/api.ts` (after `updateResearchCandidate`)

- [ ] **Step 1: Add the helper**

In `packages/frontend/src/api.ts`, add after the `updateResearchCandidate` function:

```ts
export async function validateSessionNiche(
  sessionId: string,
): Promise<{ updated: number; candidates: ResearchCandidateSummary[] }> {
  const r = await api<{ ok: true; updated: number; candidates: ResearchCandidateSummary[] }>(
    `/research/sessions/${encodeURIComponent(sessionId)}/validate-niche`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  return { updated: r.updated, candidates: r.candidates }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): validateSessionNiche API helper"
```

---

## Task 4: "Validate niche" button on the page

**Files:**
- Modify: `packages/frontend/src/pages/research.tsx`

- [ ] **Step 1: Import the helper**

In `packages/frontend/src/pages/research.tsx`, add `validateSessionNiche` to the `@/api` import:

```ts
import {
  captureCompetitorsBatch,
  createResearchSession,
  listCompetitors,
  updateCompetitor,
  updateResearchCandidate,
  validateSessionNiche,
} from '@/api'
```

- [ ] **Step 2: Add state + handler**

After the `const [running, setRunning] = useState(false)` line, add:

```ts
  const [validatingNiche, setValidatingNiche] = useState(false)
```

After the `runResearch` function, add:

```ts
  async function runNicheValidation() {
    if (!session) return
    setValidatingNiche(true)
    setBanner(null)
    try {
      const { updated, candidates: changed } = await validateSessionNiche(session.id)
      const byId = new Map(changed.map((c) => [c.id, c] as const))
      setCandidates((prev) => prev.map((c) => byId.get(c.id) ?? c))
      setBanner({ kind: 'success', message: `Validated ${updated} candidate(s) against your niche.` })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Niche validation failed.' })
    } finally {
      setValidatingNiche(false)
    }
  }
```

- [ ] **Step 3: Add the button to the candidates section**

In the "Content candidates" `<Section>`, replace the filters `<div className='mb-3 flex flex-wrap gap-2'>` opening so the row also holds the button. Change:

```tsx
          <div className='mb-3 flex flex-wrap gap-2'>
            <SegmentedFilter
```

to:

```tsx
          <div className='mb-3 flex flex-wrap items-center gap-2'>
            <button
              type='button'
              onClick={() => void runNicheValidation()}
              disabled={!session || validatingNiche}
              className='inline-flex h-8 items-center gap-1.5 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
            >
              <SparklesIcon className='size-[14px]' strokeWidth={2} />
              {validatingNiche ? 'Validating…' : 'Validate niche (AI)'}
            </button>
            <SegmentedFilter
```

- [ ] **Step 4: Import the icon**

Add `SparklesIcon` to the `lucide-react` import at the top of the file:

```ts
import {
  DownloadCloudIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshCwIcon,
  SparklesIcon,
  StarIcon,
} from 'lucide-react'
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/pages/research.tsx
git commit -m "feat(frontend): Validate niche (AI) button on the Research page"
```

---

## Task 5: Frontend niche-button test

**Files:**
- Modify: `packages/frontend/tests/pages/research.test.tsx`

- [ ] **Step 1: Add the helper to the mock**

In `packages/frontend/tests/pages/research.test.tsx`, add `validateSessionNiche` to both the `vi.hoisted` mocks object and the `vi.mock('@/api', ...)` factory:

```ts
const mocks = vi.hoisted(() => ({
  listCompetitors: vi.fn(),
  createResearchSession: vi.fn(),
  updateResearchCandidate: vi.fn(),
  updateCompetitor: vi.fn(),
  captureCompetitorsBatch: vi.fn(),
  validateSessionNiche: vi.fn(),
}))

vi.mock('@/api', () => ({
  listCompetitors: mocks.listCompetitors,
  createResearchSession: mocks.createResearchSession,
  updateResearchCandidate: mocks.updateResearchCandidate,
  updateCompetitor: mocks.updateCompetitor,
  captureCompetitorsBatch: mocks.captureCompetitorsBatch,
  validateSessionNiche: mocks.validateSessionNiche,
}))
```

- [ ] **Step 2: Add the test**

Add this `it` inside the `describe('<ResearchPage>', ...)` block:

```tsx
  it('runs the AI niche pass and merges the updated verdicts', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [candidate({})] })
    mocks.validateSessionNiche.mockResolvedValue({
      updated: 1,
      candidates: [candidate({ nicheAligned: true, validationStatus: 'valid' })],
    })

    render(<ResearchPage />)
    await userEvent.click(screen.getByRole('button', { name: /run research/i }))
    await screen.findByText('20.0×')

    await userEvent.click(screen.getByRole('button', { name: /validate niche/i }))

    await waitFor(() => expect(mocks.validateSessionNiche).toHaveBeenCalledWith('s1'))
    expect(await screen.findByText(/validated 1 candidate/i)).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the page tests**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/research.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/tests/pages/research.test.tsx
git commit -m "test(frontend): AI niche-validation button"
```

---

## Final verification

- [ ] **Step 1: Backend niche tests + typecheck**

Run:
```bash
pnpm vitest run packages/backend/tests/research-niche.test.ts packages/backend/tests/research-niche-route.test.ts packages/backend/tests/research-routes.test.ts --maxWorkers=2
pnpm --filter @anubis/backend typecheck
```
Expected: all PASS / clean.

- [ ] **Step 2: Frontend tests + typecheck + build**

Run:
```bash
pnpm --filter @anubis/frontend exec vitest run tests/pages/research.test.tsx tests/lib/research.test.ts tests/components/candidate-level-badge.test.tsx
pnpm --filter @anubis/frontend typecheck
pnpm --filter @anubis/frontend build
```
Expected: all PASS / clean / build succeeds.

- [ ] **Step 3 (manual, optional): real agent smoke test**

In a project that has a workspace `workdir` with niche notes under `knowledge/`, run research, then click **Validate niche (AI)**. Confirm pending candidates flip to Valid/Invalid with a reason in the detail drawer. (Requires the `claude` agent to be installed/authenticated.)

---

## Spec coverage (self-review)

- §7 AI niche validation (batched agent call against the workspace knowledge base, fills `nicheAligned`/`nicheReason`, finalizes validation) → Tasks 1–2.
- Manual override retained → unchanged Phase-A toggle in the detail drawer.
- Trigger = explicit button → Task 4 (supersedes spec §11 "auto-run", per the resolved decision).

**Deferred / not in scope:** chunking very large candidate sets into multiple agent calls (single call for now — bounded by `maxPostsPerProfile × competitors`); model selection (defaults to `claude`).

---

## Done

This completes the Research Phase (Phase A + Phase B). The Generating Content Phase remains out of scope, with `research_candidates` (decision `saved`, `validationStatus = valid`) as the hand-off set.
```
