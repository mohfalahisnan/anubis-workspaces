# Real Chat Features + Profile Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active-conversation chat actually work end-to-end: profile picker + reasoning-effort picker in the composer drive both new-conversation creation and live PATCH switches, Send button morphs into Stop while streaming, and the backend defaults `workspacePath` when omitted.

**Architecture:** A small backend change makes `workspacePath` optional and auto-fills `<dataDir>/workspaces/<id>`. Frontend gains an `updateConversation` API plus four hooks (`useCatalog`, `useDefaultProfile`, `useEnsureConversation`, plus existing `useConversationMessages`) and two composer components (`ProfilePicker`, `ReasoningPicker`). The active-conversation page is rewired to: on Send, create-if-needed + send + navigate; on profile/effort change, PATCH; while streaming, morph Send into Stop wired to `cancelConversation`.

**Tech Stack:** React 19, TypeScript, Hono+Zod (backend), Streamdown (markdown), Radix Popover (pickers), Vitest + @testing-library/react.

**Spec:** [docs/superpowers/specs/2026-06-03-chat-profile-selection-design.md](../specs/2026-06-03-chat-profile-selection-design.md)

---

## Pre-flight

- [ ] **Step 0a: Confirm cwd is the repo root** — `pwd` prints `C:\Projects\anubis-workspaces` (or your local equivalent).
- [ ] **Step 0b: Confirm test infra is healthy** — `pnpm test` should pass at HEAD (95 root + 38 frontend). If not, stop and report.
- [ ] **Step 0c: Confirm a clean tree** — `git status --short`. If anything is staged or modified, ask before continuing.

---

## Task 1: Backend — make `workspacePath` optional

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/backend/src/conversation.ts`
- Modify: `packages/conversation/src/conversations/conversation-service.ts`
- Modify: `packages/conversation/src/index.ts`
- Modify: `packages/conversation/tests/conversations/conversation-service.test.ts`

### Step 1.1: Update the shared type — `workspacePath` becomes optional

Open `packages/shared/src/index.ts`. Find the `CreateConversationInput` interface (around line 196) and change:

```ts
export interface CreateConversationInput {
  title: string
  profileId?: string
  workspacePath: string
  agent?: AgentKind
  override?: Record<string, unknown>
}
```

to:

```ts
export interface CreateConversationInput {
  title: string
  profileId?: string
  workspacePath?: string
  agent?: AgentKind
  override?: Record<string, unknown>
}
```

- [ ] **Step 1.1 done**

### Step 1.2: Relax the backend Zod schema

In `packages/backend/src/conversation.ts`, change the `CreateBody` schema:

```ts
const CreateBody = z.object({
  title: z.string().min(1),
  profileId: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  agent: z.enum(['claude', 'codex']).optional(),
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()
```

(Only `workspacePath` changes — add `.optional()`.)

- [ ] **Step 1.2 done**

### Step 1.3: Add `workspacesRoot` to ConversationService deps

In `packages/conversation/src/conversations/conversation-service.ts`, find `ConversationServiceDeps` (around line 46) and add a new field after `agentHomeRoot`:

```ts
export interface ConversationServiceDeps {
  db: Db
  profiles: ProfileService
  skills: SkillLoader
  sse: SseBroadcaster
  cron: CronService
  tm: TaskManager
  aiAgent: Pick<AiAgentService, 'streamAgent'>
  conversations: ConversationsRepo
  messages: MessagesRepo
  artifacts: ArtifactsRepo
  sessions: AgentSessionsRepo
  agentHomeRoot: string
  /**
   * Root directory under which auto-generated workspace folders live
   * (`{workspacesRoot}/{conversationId}`). Composition root sets this
   * to `{ANUBIS_DATA_DIR}/workspaces` and ensures it exists.
   */
  workspacesRoot: string
}
```

At the top of the file, add imports for `path` and `fs`:

```ts
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
```

Then change the `create(...)` method body (around line 69) to default `workspacePath`:

```ts
create(input: CreateConversationInput): Conversation {
  const resolved = this.resolveOrThrow(input.profileId ?? null, input.override, input.agent)
  const skills = computeInitialSkills(this.deps.skills.discoverAll(), resolved)
  const now = nowMs()
  const id = newId()
  const workspacePath = input.workspacePath ?? join(this.deps.workspacesRoot, id)
  if (!input.workspacePath) {
    mkdirSync(workspacePath, { recursive: true })
  }
  const conv: Conversation = {
    id,
    title: input.title,
    agent: resolved.agent,
    status: 'pending',
    profileId: input.profileId,
    workspacePath,
    extra: { skills, overrides: input.override },
    createdAt: now,
    updatedAt: now,
  }
  this.deps.conversations.insert(conv)
  if (input.profileId) this.deps.profiles.touchLastUsed(input.profileId)
  return conv
}
```

(Key changes: hoist `newId()` to compute `workspacePath`, default when absent, mkdir only when defaulting.)

- [ ] **Step 1.3 done**

### Step 1.4: Wire `workspacesRoot` in the factory

In `packages/conversation/src/index.ts`, after the `agentHomeRoot` setup (around line 48), add:

```ts
const workspacesRoot = join(opts.dataDir, 'workspaces')
mkdirSync(workspacesRoot, { recursive: true })
```

Then in the `new ConversationService({ ... })` call (around line 80), add the new dep:

```ts
const conversation = new ConversationService({
  db, profiles, skills, sse, cron, tm, aiAgent,
  conversations: conversationsRepo,
  messages: messagesRepo,
  artifacts: artifactsRepo,
  sessions: sessionsRepo,
  agentHomeRoot,
  workspacesRoot,
})
```

- [ ] **Step 1.4 done**

### Step 1.5: Extend the conversation-service tests

Open `packages/conversation/tests/conversations/conversation-service.test.ts`. Read it first — note how `ctx.svc` is constructed (likely via a `mkCtx()` helper that sets up temp dirs).

Find the helper that builds the service (search for `new ConversationService` or `mkCtx`). It currently passes `agentHomeRoot`; add `workspacesRoot: <tmp>/workspaces` and `mkdirSync` it.

Add a new test alongside the existing `create stores skills snapshot` test (around line 67):

```ts
it('create auto-fills workspacePath when omitted', () => {
  const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding' })
  expect(c.workspacePath).toMatch(/workspaces[\\/]/)
  // Directory should exist on disk
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  expect(existsSync(c.workspacePath)).toBe(true)
})

it('create honors an explicit workspacePath', () => {
  const c = ctx.svc.create({ title: 'T', profileId: 'claude-coding', workspacePath: '/tmp/custom' })
  expect(c.workspacePath).toBe('/tmp/custom')
})
```

Run them — they should pass since we already implemented the service change:

```bash
pnpm vitest run packages/conversation/tests/conversations/conversation-service.test.ts
```

Expected: All existing tests + the two new ones pass.

- [ ] **Step 1.5 done**

### Step 1.6: Build affected packages and re-run repo tests

```bash
pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build
```

Expected: All three builds succeed.

Then:

```bash
pnpm test
```

Expected: All suites pass (95 + new ones + 38 frontend).

- [ ] **Step 1.6 done**

### Step 1.7: Commit

```bash
git status --short
git add packages/shared/src/index.ts packages/backend/src/conversation.ts packages/conversation/src/conversations/conversation-service.ts packages/conversation/src/index.ts packages/conversation/tests/conversations/conversation-service.test.ts
git diff --cached --name-only
git commit -m "feat(conversation): default workspacePath to <dataDir>/workspaces/<id>

When CreateConversationInput.workspacePath is omitted, the conversation
service generates a per-conversation directory under workspacesRoot and
mkdirs it before the row is inserted. Existing callers that supply
workspacePath continue to work unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 1.7 done**

---

## Task 2: Frontend API — `updateConversation` + `ReasoningEffort` type

**Files:**
- Modify: `packages/frontend/src/api.ts`

### Step 2.1: Add a shared `ReasoningEffort` type and `updateConversation`

In `packages/frontend/src/api.ts`, at the top of the file (after the imports), add:

```ts
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'
```

Then find `AgentCatalog` (around line 163) and reuse the alias:

```ts
export interface AgentCatalog {
  agents: readonly ('claude' | 'codex')[]
  models: Record<'claude' | 'codex', ModelInfo[]>
  defaultModel: Record<'claude' | 'codex', string>
  reasoningEfforts: readonly ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort
}
```

Then add `updateConversation` at the end of the conversations block (after `getConversation`, before `listMessages`):

```ts
export interface UpdateConversationInput {
  title?: string
  archived?: boolean
  override?: Record<string, unknown>
  profileId?: string | null
}

export async function updateConversation(
  id: string,
  patch: UpdateConversationInput,
): Promise<ConversationSummary> {
  const r = await api<{ ok: true; conversation: ConversationSummary }>(
    `/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.conversation
}
```

- [ ] **Step 2.1 done**

### Step 2.2: Typecheck

```bash
pnpm --filter @anubis/frontend typecheck
```

Expected: No errors.

- [ ] **Step 2.2 done**

### Step 2.3: Commit

```bash
git status --short
git add packages/frontend/src/api.ts
git diff --cached --name-only
git commit -m "feat(frontend/api): add ReasoningEffort + updateConversation

Exposes a typed ReasoningEffort alias and a PATCH wrapper for
/conversations/:id, used by the upcoming profile and effort pickers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 2.3 done**

---

## Task 3: `useCatalog` hook (TDD)

**Files:**
- Create: `packages/frontend/src/lib/use-catalog.ts`
- Create: `packages/frontend/tests/lib/use-catalog.test.tsx`

### Step 3.1: Write the failing test

Create `packages/frontend/tests/lib/use-catalog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/api', () => ({
  getCatalog: vi.fn(),
}))

import { getCatalog } from '@/api'
import { useCatalog, __resetCatalogCacheForTests } from '@/lib/use-catalog'

const CATALOG = {
  agents: ['claude', 'codex'] as const,
  models: { claude: [], codex: [] },
  defaultModel: { claude: 'claude-sonnet-4-6', codex: 'gpt-5.4' },
  reasoningEfforts: ['minimal', 'low', 'medium', 'high'] as const,
  defaultReasoningEffort: 'medium' as const,
}

beforeEach(() => {
  vi.mocked(getCatalog).mockReset()
  __resetCatalogCacheForTests()
})

describe('useCatalog', () => {
  it('fetches once and returns the catalog', async () => {
    vi.mocked(getCatalog).mockResolvedValueOnce(CATALOG)
    const { result } = renderHook(() => useCatalog())
    await waitFor(() => {
      expect(result.current.catalog).toEqual(CATALOG)
    })
    expect(getCatalog).toHaveBeenCalledTimes(1)
  })

  it('shares the cached value across hook calls', async () => {
    vi.mocked(getCatalog).mockResolvedValueOnce(CATALOG)
    const a = renderHook(() => useCatalog())
    await waitFor(() => expect(a.result.current.catalog).toEqual(CATALOG))
    const b = renderHook(() => useCatalog())
    await waitFor(() => expect(b.result.current.catalog).toEqual(CATALOG))
    expect(getCatalog).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error string when fetch fails', async () => {
    vi.mocked(getCatalog).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useCatalog())
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.catalog).toBeNull()
  })
})
```

- [ ] **Step 3.1 done**

### Step 3.2: Run, confirm failure

```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-catalog.test.tsx
```

Expected: Fails with `Failed to resolve import "@/lib/use-catalog"`.

- [ ] **Step 3.2 done**

### Step 3.3: Implement the hook

Create `packages/frontend/src/lib/use-catalog.ts`:

```ts
import { useEffect, useState } from 'react'
import { getCatalog, type AgentCatalog } from '@/api'

interface CatalogState {
  catalog: AgentCatalog | null
  error: string | null
}

let cache: AgentCatalog | null = null
let inflight: Promise<AgentCatalog> | null = null

export function __resetCatalogCacheForTests(): void {
  cache = null
  inflight = null
}

export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({
    catalog: cache,
    error: null,
  })

  useEffect(() => {
    if (cache) return
    let cancelled = false
    const p = inflight ?? (inflight = getCatalog())
    p.then(
      (c) => {
        cache = c
        if (!cancelled) setState({ catalog: c, error: null })
      },
      (e: unknown) => {
        inflight = null
        if (!cancelled) {
          setState({
            catalog: null,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
```

- [ ] **Step 3.3 done**

### Step 3.4: Run tests, confirm green

```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-catalog.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 3.4 done**

### Step 3.5: Commit

```bash
git status --short
git add packages/frontend/src/lib/use-catalog.ts packages/frontend/tests/lib/use-catalog.test.tsx
git diff --cached --name-only
git commit -m "feat(frontend): useCatalog hook with module-cached fetch

Single fetch per app session of the agent catalog. Surfaces errors
without retrying so callers can render a degraded UI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3.5 done**

---

## Task 4: `useDefaultProfile` hook (TDD)

**Files:**
- Create: `packages/frontend/src/lib/use-default-profile.ts`
- Create: `packages/frontend/tests/lib/use-default-profile.test.tsx`

### Step 4.1: Write the failing test

Create `packages/frontend/tests/lib/use-default-profile.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ProfileSummary } from '@anubis/shared'
import { useDefaultProfile, STORAGE_KEY } from '@/lib/use-default-profile'

function p(id: string, lastUsedAt?: number): ProfileSummary {
  return {
    id,
    name: id,
    source: 'builtin',
    config: { agent: 'claude' },
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
  } as ProfileSummary
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useDefaultProfile', () => {
  it('returns null when the list is empty', () => {
    const { result } = renderHook(() => useDefaultProfile([]))
    expect(result.current[0]).toBeNull()
  })

  it('returns the localStorage id when it exists in the list', () => {
    window.localStorage.setItem(STORAGE_KEY, 'b')
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b'), p('c')]))
    expect(result.current[0]?.id).toBe('b')
  })

  it('falls back to most-recently-used when storage is empty', () => {
    const { result } = renderHook(() =>
      useDefaultProfile([p('a', 100), p('b', 500), p('c', 300)]),
    )
    expect(result.current[0]?.id).toBe('b')
  })

  it('falls back to first item when nobody has been used', () => {
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b')]))
    expect(result.current[0]?.id).toBe('a')
  })

  it('falls back when the stored id no longer exists', () => {
    window.localStorage.setItem(STORAGE_KEY, 'stale')
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b', 999)]))
    expect(result.current[0]?.id).toBe('b')
  })

  it('setter writes through to localStorage', () => {
    const { result } = renderHook(() => useDefaultProfile([p('a'), p('b')]))
    act(() => result.current[1](p('b')))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('b')
    expect(result.current[0]?.id).toBe('b')
  })
})
```

- [ ] **Step 4.1 done**

### Step 4.2: Run, confirm failure

```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-default-profile.test.tsx
```

Expected: Import error.

- [ ] **Step 4.2 done**

### Step 4.3: Implement the hook

Create `packages/frontend/src/lib/use-default-profile.ts`:

```ts
import { useCallback, useMemo, useState } from 'react'
import type { ProfileSummary } from '@anubis/shared'

export const STORAGE_KEY = 'anubis:last-profile'

function pickInitial(profiles: ProfileSummary[]): ProfileSummary | null {
  if (profiles.length === 0) return null
  const stored = typeof window !== 'undefined'
    ? window.localStorage.getItem(STORAGE_KEY)
    : null
  if (stored) {
    const hit = profiles.find((p) => p.id === stored)
    if (hit) return hit
  }
  const mru = [...profiles].sort(
    (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  )
  if ((mru[0]?.lastUsedAt ?? 0) > 0) return mru[0] ?? null
  return profiles[0] ?? null
}

export function useDefaultProfile(
  profiles: ProfileSummary[],
): [ProfileSummary | null, (next: ProfileSummary) => void] {
  // Recompute when the list reference changes (typically only on initial load).
  const initial = useMemo(() => pickInitial(profiles), [profiles])
  const [current, setCurrent] = useState<ProfileSummary | null>(initial)

  // Keep state in sync if `initial` updates (e.g., profiles arrive after mount).
  // Avoid clobbering an explicit pick.
  const effective = current ?? initial

  const set = useCallback((next: ProfileSummary) => {
    setCurrent(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next.id)
    }
  }, [])

  return [effective, set]
}
```

- [ ] **Step 4.3 done**

### Step 4.4: Run tests, confirm green

```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-default-profile.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 4.4 done**

### Step 4.5: Commit

```bash
git status --short
git add packages/frontend/src/lib/use-default-profile.ts packages/frontend/tests/lib/use-default-profile.test.tsx
git diff --cached --name-only
git commit -m "feat(frontend): useDefaultProfile with localStorage persistence

Picks a default profile from a stored last-used id, falling back to
the most-recently-used, falling back to the first profile in the list.
The setter writes the chosen id back to localStorage.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4.5 done**

---

## Task 5: `useEnsureConversation` hook (TDD)

**Files:**
- Create: `packages/frontend/src/lib/use-ensure-conversation.ts`
- Create: `packages/frontend/tests/lib/use-ensure-conversation.test.tsx`

### Step 5.1: Write the failing test

Create `packages/frontend/tests/lib/use-ensure-conversation.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ProfileSummary, ConversationSummary } from '@anubis/shared'
import { useEnsureConversation } from '@/lib/use-ensure-conversation'

vi.mock('@/api', () => ({
  createConversation: vi.fn(),
}))

import { createConversation } from '@/api'

const PROFILE: ProfileSummary = {
  id: 'p1',
  name: 'Coding',
  source: 'builtin',
  config: { agent: 'claude' },
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
} as ProfileSummary

const NEW_CONV: ConversationSummary = {
  id: 'conv-new',
  title: 't',
  agent: 'claude',
  status: 'pending',
  workspacePath: '/auto',
  extra: { skills: [] },
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  vi.mocked(createConversation).mockReset()
})

describe('useEnsureConversation', () => {
  it('returns the existing id when conversationId is set', async () => {
    const { result } = renderHook(() =>
      useEnsureConversation('existing-id', PROFILE, 'medium', 'medium'),
    )
    let returned: string | null = null
    await act(async () => {
      returned = await result.current.ensure('hello')
    })
    expect(returned).toBe('existing-id')
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('creates a conversation when conversationId is undefined', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    let returned: string | null = null
    await act(async () => {
      returned = await result.current.ensure('say hi to the world')
    })
    expect(returned).toBe('conv-new')
    expect(createConversation).toHaveBeenCalledWith({
      title: 'say hi to the world',
      profileId: 'p1',
      agent: 'claude',
    })
  })

  it('truncates a long first message to 60 chars for the title', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const long = 'a'.repeat(120)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    await act(async () => {
      await result.current.ensure(long)
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.title).toHaveLength(60)
  })

  it('falls back to "New conversation" for an empty first message', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    await act(async () => {
      await result.current.ensure('   ')
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.title).toBe('New conversation')
  })

  it('includes override only when effort differs from profile default', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'high', 'medium'),
    )
    await act(async () => {
      await result.current.ensure('go')
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.override).toEqual({ reasoningEffort: 'high' })
  })

  it('omits override when effort matches profile default', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(NEW_CONV)
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    await act(async () => {
      await result.current.ensure('go')
    })
    const call = vi.mocked(createConversation).mock.calls[0]![0]
    expect(call.override).toBeUndefined()
  })

  it('reports error when create fails and rejects with the error', async () => {
    vi.mocked(createConversation).mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, PROFILE, 'medium', 'medium'),
    )
    let caught: unknown = null
    await act(async () => {
      try { await result.current.ensure('hi') } catch (e) { caught = e }
    })
    expect((caught as Error).message).toBe('nope')
    expect(result.current.error).toBe('nope')
  })

  it('rejects when no profile is selected', async () => {
    const { result } = renderHook(() =>
      useEnsureConversation(undefined, null, 'medium', 'medium'),
    )
    let caught: unknown = null
    await act(async () => {
      try { await result.current.ensure('hi') } catch (e) { caught = e }
    })
    expect((caught as Error).message).toMatch(/no profile/i)
  })
})
```

- [ ] **Step 5.1 done**

### Step 5.2: Run, confirm failure

```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-ensure-conversation.test.tsx
```

Expected: Import error.

- [ ] **Step 5.2 done**

### Step 5.3: Implement the hook

Create `packages/frontend/src/lib/use-ensure-conversation.ts`:

```ts
import { useCallback, useState } from 'react'
import type { ProfileSummary } from '@anubis/shared'
import { createConversation, type ReasoningEffort } from '@/api'

interface EnsureState {
  ensure: (firstContent: string) => Promise<string>
  creating: boolean
  error: string | null
}

const TITLE_LIMIT = 60

function deriveTitle(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return 'New conversation'
  return trimmed.slice(0, TITLE_LIMIT)
}

export function useEnsureConversation(
  conversationId: string | undefined,
  selectedProfile: ProfileSummary | null,
  effort: ReasoningEffort,
  profileDefaultEffort: ReasoningEffort,
): EnsureState {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensure = useCallback(
    async (firstContent: string): Promise<string> => {
      if (conversationId) return conversationId
      if (!selectedProfile) {
        const err = new Error('No profile selected — cannot start a conversation.')
        setError(err.message)
        throw err
      }
      setCreating(true)
      setError(null)
      try {
        const override =
          effort !== profileDefaultEffort ? { reasoningEffort: effort } : undefined
        const created = await createConversation({
          title: deriveTitle(firstContent),
          profileId: selectedProfile.id,
          agent: selectedProfile.config.agent,
          ...(override ? { override } : {}),
        })
        return created.id
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        throw e
      } finally {
        setCreating(false)
      }
    },
    [conversationId, selectedProfile, effort, profileDefaultEffort],
  )

  return { ensure, creating, error }
}
```

- [ ] **Step 5.3 done**

### Step 5.4: Run tests, confirm green

```bash
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-ensure-conversation.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 5.4 done**

### Step 5.5: Commit

```bash
git status --short
git add packages/frontend/src/lib/use-ensure-conversation.ts packages/frontend/tests/lib/use-ensure-conversation.test.tsx
git diff --cached --name-only
git commit -m "feat(frontend): useEnsureConversation hook

Returns ensure(firstContent) that no-ops when conversationId exists
and otherwise calls createConversation with a derived title, the
selected profile, and an override for reasoningEffort only when it
differs from the profile's default.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5.5 done**

---

## Task 6: `ProfilePicker` component (TDD)

**Files:**
- Create: `packages/frontend/src/components/composer/profile-picker.tsx`
- Create: `packages/frontend/tests/components/profile-picker.test.tsx`

### Step 6.1: Write the failing test

Create `packages/frontend/tests/components/profile-picker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProfileSummary } from '@anubis/shared'
import { ProfilePicker } from '@/components/composer/profile-picker'

function p(id: string, name: string, source: 'builtin' | 'user'): ProfileSummary {
  return {
    id,
    name,
    source,
    config: { agent: 'claude', model: 'claude-sonnet-4-6' },
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  } as ProfileSummary
}

const PROFILES = [
  p('claude-coding', 'Claude · Coding', 'builtin'),
  p('claude-research', 'Claude · Research', 'builtin'),
  p('my-fast', 'My Fast', 'user'),
]

describe('<ProfilePicker>', () => {
  it('renders the selected profile name in the trigger', () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[2]!}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveTextContent('My Fast')
  })

  it('shows "Loading…" when the profile list is empty', () => {
    render(
      <ProfilePicker profiles={[]} value={null} onChange={() => {}} />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveTextContent(/loading/i)
    expect(trigger).toBeDisabled()
  })

  it('opens a menu listing user profiles then builtin profiles', async () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('My profiles')).toBeInTheDocument()
    expect(screen.getByText('Built-in')).toBeInTheDocument()
    expect(screen.getByText('My Fast')).toBeInTheDocument()
    expect(screen.getByText('Claude · Research')).toBeInTheDocument()
  })

  it('fires onChange with the picked profile and closes', async () => {
    const onChange = vi.fn()
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(await screen.findByText('My Fast'))
    expect(onChange).toHaveBeenCalledWith(PROFILES[2])
  })

  it('does not open when disabled', async () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={() => {}}
        disabled
      />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDisabled()
    await userEvent.click(trigger)
    expect(screen.queryByText('My profiles')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 6.1 done**

### Step 6.2: Run, confirm failure

```bash
pnpm --filter @anubis/frontend exec vitest run tests/components/profile-picker.test.tsx
```

Expected: Import error.

- [ ] **Step 6.2 done**

### Step 6.3: Implement the component

Create `packages/frontend/src/components/composer/profile-picker.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { ProfileSummary } from '@anubis/shared'
import { cn } from '@/lib/utils'

interface ProfilePickerProps {
  profiles: ProfileSummary[]
  value: ProfileSummary | null
  onChange: (next: ProfileSummary) => void
  disabled?: boolean
}

export function ProfilePicker({ profiles, value, onChange, disabled }: ProfilePickerProps) {
  const [open, setOpen] = useState(false)
  const empty = profiles.length === 0
  const isDisabled = disabled || empty

  const grouped = useMemo(() => {
    const user: ProfileSummary[] = []
    const builtin: ProfileSummary[] = []
    for (const p of profiles) {
      ;(p.source === 'user' ? user : builtin).push(p)
    }
    return { user, builtin }
  }, [profiles])

  const label = empty ? 'Loading…' : value?.name ?? 'Pick a profile'

  return (
    <Popover.Root open={open && !isDisabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={isDisabled}
          className={cn(
            'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 pl-2.5 font-mono text-[12px] text-foreground',
            isDisabled && 'cursor-not-allowed opacity-60',
            !isDisabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
          aria-haspopup='listbox'
          aria-expanded={open}
        >
          <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
          <span className='truncate'>{label}</span>
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[280px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          {grouped.user.length > 0 && (
            <Group title='My profiles' profiles={grouped.user} valueId={value?.id} onPick={(p) => { onChange(p); setOpen(false) }} />
          )}
          {grouped.builtin.length > 0 && (
            <Group title='Built-in' profiles={grouped.builtin} valueId={value?.id} onPick={(p) => { onChange(p); setOpen(false) }} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Group({
  title,
  profiles,
  valueId,
  onPick,
}: {
  title: string
  profiles: ProfileSummary[]
  valueId: string | undefined
  onPick: (p: ProfileSummary) => void
}) {
  return (
    <div className='py-1'>
      <div className='px-2 pb-1 pt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/70'>
        {title}
      </div>
      {profiles.map((p) => {
        const model = typeof p.config.model === 'string' ? p.config.model : ''
        const selected = p.id === valueId
        return (
          <button
            key={p.id}
            type='button'
            onClick={() => onPick(p)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
              selected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
            )}
          >
            <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
            <span className='min-w-0 flex-1 truncate'>{p.name}</span>
            {model && (
              <span className='font-mono text-[10.5px] text-muted-foreground'>{model}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6.3 done**

### Step 6.4: Run tests, confirm green

```bash
pnpm --filter @anubis/frontend exec vitest run tests/components/profile-picker.test.tsx
```

Expected: 5 tests pass.

If the "opens a menu" test fails because Radix's portal renders outside `container`, switch the assertions to use `screen.findByText` (already used in the test) — it queries the whole document and works with portals.

- [ ] **Step 6.4 done**

### Step 6.5: Commit

```bash
git status --short
git add packages/frontend/src/components/composer/profile-picker.tsx packages/frontend/tests/components/profile-picker.test.tsx
git diff --cached --name-only
git commit -m "feat(frontend/composer): ProfilePicker component

Radix popover with two groups (My profiles / Built-in). Click picks a
profile and closes; disabled when no profiles are loaded or when the
parent passes disabled=true (used during streaming).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6.5 done**

---

## Task 7: `ReasoningPicker` component (TDD)

**Files:**
- Create: `packages/frontend/src/components/composer/reasoning-picker.tsx`
- Create: `packages/frontend/tests/components/reasoning-picker.test.tsx`

### Step 7.1: Write the failing test

Create `packages/frontend/tests/components/reasoning-picker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasoningPicker } from '@/components/composer/reasoning-picker'
import type { ReasoningEffort } from '@/api'

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

describe('<ReasoningPicker>', () => {
  it('renders the current effort in the trigger', () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveTextContent('medium')
  })

  it('marks the trigger as overridden when isOverride is true', () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='high'
        isOverride
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveAttribute('data-modified', 'true')
  })

  it('does not mark the trigger when at profile default', () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveAttribute('data-modified', 'false')
  })

  it('opens a menu and fires onChange on pick', async () => {
    const onChange = vi.fn()
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(await screen.findByText('high'))
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('is disabled when the disabled prop is set', async () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={() => {}}
        disabled
      />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDisabled()
    await userEvent.click(trigger)
    expect(screen.queryByText('high')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 7.1 done**

### Step 7.2: Run, confirm failure

```bash
pnpm --filter @anubis/frontend exec vitest run tests/components/reasoning-picker.test.tsx
```

Expected: Import error.

- [ ] **Step 7.2 done**

### Step 7.3: Implement the component

Create `packages/frontend/src/components/composer/reasoning-picker.tsx`:

```tsx
import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { ReasoningEffort } from '@/api'
import { cn } from '@/lib/utils'

interface ReasoningPickerProps {
  efforts: readonly ReasoningEffort[]
  value: ReasoningEffort
  isOverride: boolean
  onChange: (next: ReasoningEffort) => void
  disabled?: boolean
}

export function ReasoningPicker({
  efforts,
  value,
  isOverride,
  onChange,
  disabled,
}: ReasoningPickerProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          data-modified={isOverride}
          aria-haspopup='listbox'
          aria-expanded={open}
          title={isOverride ? 'Overrides profile default' : undefined}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 font-mono text-[12px] text-foreground',
            disabled && 'cursor-not-allowed opacity-60',
            !disabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
        >
          <span className='text-muted-foreground'>effort:</span>
          <span>{value}</span>
          {isOverride && (
            <span
              aria-label='Overridden'
              className='ml-0.5 inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]'
            />
          )}
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[160px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          {efforts.map((e) => (
            <button
              key={e}
              type='button'
              onClick={() => { onChange(e); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors',
                e === value ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
              )}
            >
              {e}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
```

- [ ] **Step 7.3 done**

### Step 7.4: Run tests, confirm green

```bash
pnpm --filter @anubis/frontend exec vitest run tests/components/reasoning-picker.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 7.4 done**

### Step 7.5: Commit

```bash
git status --short
git add packages/frontend/src/components/composer/reasoning-picker.tsx packages/frontend/tests/components/reasoning-picker.test.tsx
git diff --cached --name-only
git commit -m "feat(frontend/composer): ReasoningPicker component

Compact pill showing the resolved effort with a gold dot when
overridden. Click opens a tiny popover of all four catalog values.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 7.5 done**

---

## Task 8: Wire `active-conversation.tsx` — pickers, create flow, Send↔Stop

**Files:**
- Modify: `packages/frontend/src/pages/active-conversation.tsx`

This is the largest task. No new unit tests for the wiring — verified manually in Task 9. The constituent hooks and components are already covered by Tasks 3–7.

### Step 8.1: Add a lightweight `useProfiles` hook used only by this page

In `packages/frontend/src/pages/active-conversation.tsx`, add an inline hook at the top of the file (after imports, before the page component):

```tsx
function useProfiles(): ProfileSummary[] {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  useEffect(() => {
    let cancelled = false
    listProfiles()
      .then((items) => { if (!cancelled) setProfiles(items) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return profiles
}
```

(Add `listProfiles` to the existing `@/api` import.)

- [ ] **Step 8.1 done**

### Step 8.2: Rewrite the file's top-level imports + component shell

Replace the existing imports block at the top of `active-conversation.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ChevronDownIcon, GlobeIcon, PaperclipIcon, SendIcon, BrainIcon, SquareIcon, Loader2Icon,
} from 'lucide-react'

import type { ConversationSummary, MessageSummary, ProfileSummary } from '@anubis/shared'

import {
  cancelConversation,
  getConversation,
  listProfiles,
  sendMessage as apiSendMessage,
  updateConversation,
  type ReasoningEffort,
} from '@/api'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'
import { MdxContent } from '@/components/mdx'
import {
  useConversationMessages,
  type Fragment as LiveFragment,
  type ToolEvent,
} from '@/lib/conversation-stream'
import { useCatalog } from '@/lib/use-catalog'
import { useDefaultProfile } from '@/lib/use-default-profile'
import { useEnsureConversation } from '@/lib/use-ensure-conversation'
import { ProfilePicker } from '@/components/composer/profile-picker'
import { ReasoningPicker } from '@/components/composer/reasoning-picker'
```

- [ ] **Step 8.2 done**

### Step 8.3: Rewrite the page component body

Replace the existing `ActiveConversationPage` function (everything from `export function ActiveConversationPage` through the end of that function's closing brace) with:

```tsx
export function ActiveConversationPage({ conversationId }: { conversationId?: string }) {
  const { navigate } = useNavigation()
  const profiles = useProfiles()
  const { catalog } = useCatalog()
  const { messages, streaming, error: streamError, chunks, partialChars } =
    useConversationMessages(conversationId)

  const [conv, setConv] = useState<ConversationSummary | null>(null)
  const [defaultProfile, setDefaultProfile] = useDefaultProfile(profiles)
  const [pickedProfile, setPickedProfile] = useState<ProfileSummary | null>(null)
  const [pickedEffort, setPickedEffort] = useState<ReasoningEffort | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [forceStopped, setForceStopped] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Load the conversation row when an id is present.
  useEffect(() => {
    if (!conversationId) { setConv(null); return }
    let cancelled = false
    getConversation(conversationId)
      .then((c) => { if (!cancelled) setConv(c) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [conversationId])

  // Resolve effective profile + effort.
  const convProfile = useMemo(
    () => profiles.find((p) => p.id === conv?.profileId) ?? null,
    [profiles, conv?.profileId],
  )
  const selectedProfile: ProfileSummary | null =
    pickedProfile ?? convProfile ?? defaultProfile

  const profileDefaultEffort: ReasoningEffort =
    (selectedProfile?.config.reasoningEffort as ReasoningEffort | undefined)
    ?? catalog?.defaultReasoningEffort ?? 'medium'

  const convOverrideEffort =
    conv?.extra.overrides?.reasoningEffort as ReasoningEffort | undefined

  const effectiveEffort: ReasoningEffort =
    pickedEffort ?? convOverrideEffort ?? profileDefaultEffort
  const effortIsOverride = effectiveEffort !== profileDefaultEffort

  // Elapsed-since-stream-start ticker.
  useEffect(() => {
    if (!streaming) { setElapsed(0); return }
    const start = streaming.startedAt
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 250)
    return () => clearInterval(tick)
  }, [streaming])

  // Reset forceStopped whenever the SSE flag flips back to false on its own.
  useEffect(() => {
    if (!streaming) setForceStopped(false)
  }, [streaming])

  const tokens = Math.round(partialChars / 4)
  const isLive = !!streaming && !forceStopped

  const { ensure } = useEnsureConversation(
    conversationId, selectedProfile, effectiveEffort, profileDefaultEffort,
  )

  async function onProfileChange(next: ProfileSummary) {
    setPickedProfile(next)
    setDefaultProfile(next)
    setSendError(null)
    if (!conversationId) return
    try {
      const updated = await updateConversation(conversationId, { profileId: next.id })
      setConv(updated)
    } catch (e) {
      setPickedProfile(null)
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onEffortChange(next: ReasoningEffort) {
    setPickedEffort(next)
    setSendError(null)
    if (!conversationId) return
    const patch = next === profileDefaultEffort ? {} : { reasoningEffort: next }
    try {
      const updated = await updateConversation(conversationId, { override: patch })
      setConv(updated)
    } catch (e) {
      setPickedEffort(null)
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onStop() {
    if (!conversationId || stopping) return
    setStopping(true)
    setSendError(null)
    try {
      await cancelConversation(conversationId)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
    // Safety fallback: if the SSE `done` event doesn't arrive within 3s, treat
    // the run as stopped locally so the user isn't stuck staring at "Stop".
    // The SSE hook keeps running, so transcripts remain correct.
    setTimeout(() => setForceStopped(true), 3000)
  }

  async function onSend(content: string) {
    setSendError(null)
    try {
      const id = await ensure(content)
      await apiSendMessage(id, content)
      if (id !== conversationId) navigate({ page: 'active-conversation', conversationId: id })
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
      <div className='flex flex-shrink-0 items-start justify-between gap-5 border-b border-border px-7 pb-4 pt-[18px]'>
        <div>
          <h1 className='m-0 text-[25px] font-semibold leading-[1.15] tracking-[-0.022em]'>
            {conv?.title ?? (conversationId ? 'Active conversation' : 'New conversation')}
          </h1>
          {conversationId && (
            <div className='mt-2.5 flex flex-wrap items-center gap-3'>
              <span className='font-mono text-[12px] text-muted-foreground/65'>
                session: {conversationId.slice(0, 13)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-7 pb-[30px] pt-[34px]'>
        <div className='mx-auto flex max-w-[720px] flex-col gap-6'>
          {messages.map((m) => (
            <RenderedMessage key={m.id} message={m} conversationId={conversationId ?? ''} />
          ))}
          {streaming && (
            <StreamingMessage live={streaming} conversationId={conversationId ?? ''} />
          )}
          {(streamError ?? sendError) && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 font-mono text-[12px] text-destructive'>
              {streamError ?? sendError}
            </div>
          )}
        </div>
      </div>

      <Composer
        onSend={onSend}
        onStop={onStop}
        streaming={isLive}
        stopping={stopping}
        profile={selectedProfile}
        profiles={profiles}
        onProfileChange={(p) => void onProfileChange(p)}
        effort={effectiveEffort}
        effortIsOverride={effortIsOverride}
        efforts={catalog?.reasoningEfforts ?? (['minimal','low','medium','high'] as const)}
        onEffortChange={(e) => void onEffortChange(e)}
      />

      <div className='flex flex-shrink-0 items-center justify-center gap-2 px-7 pb-3 pt-[7px] font-mono text-[11px] text-muted-foreground'>
        {isLive ? (
          <>
            <span className='inline-block size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
            <span>
              Streaming · <span>{chunks}</span> chunks · <span>{(tokens / 1000).toFixed(1)}k</span> tokens · <span>{elapsed}</span>s elapsed
            </span>
          </>
        ) : (
          <span>Idle</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 8.3 done**

### Step 8.4: Rewrite the Composer subcomponent

Replace the existing `Composer` function in the same file with:

```tsx
function Composer({
  onSend,
  onStop,
  streaming,
  stopping,
  profile,
  profiles,
  onProfileChange,
  effort,
  effortIsOverride,
  efforts,
  onEffortChange,
}: {
  onSend: (content: string) => void
  onStop: () => void
  streaming: boolean
  stopping: boolean
  profile: ProfileSummary | null
  profiles: ProfileSummary[]
  onProfileChange: (next: ProfileSummary) => void
  effort: ReasoningEffort
  effortIsOverride: boolean
  efforts: readonly ReasoningEffort[]
  onEffortChange: (next: ReasoningEffort) => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  function autoGrow() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (streaming) { onStop(); return }
    if (!value.trim()) return
    onSend(value)
    setValue('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  const sendDisabled = !streaming && !value.trim()

  return (
    <form
      onSubmit={submit}
      className='flex-shrink-0 border-t border-border px-7 pb-2.5 pt-3.5'
    >
      <div className='mx-auto flex max-w-[768px] items-center gap-2.5 rounded-[13px] border border-border bg-card py-[7px] pl-2.5 pr-2 focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'>
        <button
          type='button'
          aria-label='Attach'
          disabled={streaming}
          className='flex size-[30px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
        >
          <PaperclipIcon className='size-[17px]' strokeWidth={2} />
        </button>

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => { setValue(e.target.value); autoGrow() }}
          rows={1}
          placeholder='Reply to Anubis…'
          disabled={streaming}
          className='max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60'
        />

        <ProfilePicker
          profiles={profiles}
          value={profile}
          onChange={onProfileChange}
          disabled={streaming}
        />
        <ReasoningPicker
          efforts={efforts}
          value={effort}
          isOverride={effortIsOverride}
          onChange={onEffortChange}
          disabled={streaming}
        />

        {streaming ? (
          <button
            type='submit'
            disabled={stopping}
            className='inline-flex h-[34px] items-center gap-1.5 rounded-md bg-destructive/15 px-4 text-[14px] font-semibold tracking-[-0.01em] text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50'
          >
            {stopping ? (
              <Loader2Icon className='size-[14px] animate-spin' strokeWidth={2} />
            ) : (
              <SquareIcon className='size-[14px]' strokeWidth={2.4} fill='currentColor' />
            )}
            Stop
          </button>
        ) : (
          <button
            type='submit'
            disabled={sendDisabled}
            className={cn(
              'inline-flex h-[34px] items-center gap-1.5 rounded-md px-4 text-[14px] font-semibold tracking-[-0.01em] transition-colors',
              sendDisabled
                ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-[0.42]'
                : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
            )}
          >
            <SendIcon className='size-[14px]' strokeWidth={2} />
            Send
          </button>
        )}
      </div>
    </form>
  )
}
```

- [ ] **Step 8.4 done**

### Step 8.5: Keep the existing `RenderedMessage`, `StreamingMessage`, `ToolCardSuccess`, `ToolCardRunning` helpers unchanged

The streaming tool-card UI in `active-conversation.tsx` is unchanged. Just verify those subcomponents are still present below the Composer. If you accidentally removed them while editing, restore from the previous commit:

```bash
git show HEAD:packages/frontend/src/pages/active-conversation.tsx > /tmp/old.tsx
# Then copy back the four helpers if missing.
```

- [ ] **Step 8.5 done**

### Step 8.6: Typecheck

```bash
pnpm --filter @anubis/frontend typecheck
```

Expected: No errors. If there are unused imports flagged, remove them. If `radix-ui`'s `Popover` import fails, double-check it's `import { Popover } from 'radix-ui'` (the project uses the umbrella `radix-ui` package, not `@radix-ui/react-popover`).

- [ ] **Step 8.6 done**

### Step 8.7: Run all frontend tests

```bash
pnpm --filter @anubis/frontend test
```

Expected: All MDX tests still pass (38) and the new component + hook tests we added (5 + 5 + 3 + 6 + 8 = 27). Total > 65 tests.

- [ ] **Step 8.7 done**

### Step 8.8: Commit

```bash
git status --short
git add packages/frontend/src/pages/active-conversation.tsx
git diff --cached --name-only
git commit -m "feat(frontend): wire profile + effort pickers, create flow, Send↔Stop

Composer gets ProfilePicker + ReasoningPicker. On Send, the new
useEnsureConversation hook creates the conversation if needed before
posting the message and navigating to it. Profile and effort changes
PATCH the conversation. While streaming, the Send button morphs into
a destructive Stop button wired to cancelConversation; the existing
header Cancel link is removed in favor of the composer control.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 8.8 done**

---

## Task 9: Final verification

- [ ] **Step 9.1: Repo-wide typecheck**

```bash
pnpm typecheck
```

Expected: No errors in any package.

- [ ] **Step 9.2: Repo-wide tests**

```bash
pnpm test
```

Expected: All Vitest suites pass — root (95+), conversation (existing + 2 new from Task 1.5), frontend (38 MDX + 5 ProfilePicker + 5 ReasoningPicker + 3 useCatalog + 6 useDefaultProfile + 8 useEnsureConversation = 65 frontend total).

- [ ] **Step 9.3: Frontend build**

```bash
pnpm --filter @anubis/frontend build
```

Expected: Build succeeds.

- [ ] **Step 9.4: Manual verification (live app)**

```bash
pnpm dev
```

In the Electron app:

1. **Default profile:** Open the active-conversation page from a fresh conversation. The composer's profile pill shows a real profile name (most-recently-used or first).
2. **Profile picker:** Click the pill, see "My profiles" + "Built-in" groups, pick a different profile. Pill updates.
3. **Effort picker:** Click the effort pill. Pick a non-default value; gold dot appears. Pick the profile's default back; gold dot disappears.
4. **localStorage persistence:** Reload the app. Last picked profile is still selected.
5. **New conversation flow:** From the conversations page, click "New conversation". On the empty page, type "Hello world" and Send. Confirm:
   - You land on a real conversation id (URL/state).
   - A row appears in `listConversations` with title "Hello world" and the picked profile id.
   - The transcript shows your user message.
6. **Workspace path:** Inspect the new conversation's row via the browser devtools console:
   ```js
   const id = (await fetch('http://127.0.0.1:<port>/conversations').then(r => r.json())).items[0].id
   await fetch(`http://127.0.0.1:<port>/conversations/${id}`).then(r => r.json())
   ```
   (Use the URL from `window.anubis.backend.getBaseUrl()`.) `workspacePath` should be `<ANUBIS_DATA_DIR>/workspaces/<id>` and the directory should exist on disk.
7. **Mid-conversation profile switch:** In an existing conversation, change the profile picker. Refresh — the conversation's `profileId` shows the new value.
8. **Mid-conversation effort switch:** Change the effort to a non-default value. `extra.overrides.reasoningEffort` reflects it on the row. Change it back to the profile default. `extra.overrides` should be empty.
9. **Stop button:** Trigger an agent that streams for a few seconds. Confirm the Send button morphs into a red Stop button. Click Stop — the stream ends, the status bar reads "Idle" (or "Streaming" briefly until `done`), and the button returns to Send within ~3s.
10. **Pickers disabled while streaming:** During the stream, confirm both the profile pill and effort pill are visually disabled and don't open.

- [ ] **Step 9.5: Summarize**

Report which tasks landed, any deviations, and any follow-ups discovered.

---

## Acceptance criteria (from spec, reaffirmed)

1. New-conversation flow: type → Send → create + send + navigate, no errors on happy path.
2. New row has `title = first ~60 chars`, `profileId = picked`, `workspacePath = <dataDir>/workspaces/<id>`.
3. Existing conversation: picking a different profile PATCHes `profileId`.
4. Effort change PATCHes `extra.overrides.reasoningEffort`; picking profile default clears overrides.
5. Both pickers disabled while streaming.
6. Default profile persists across reloads via localStorage.
7. Send ↔ Stop morph works; Stop calls `cancelConversation`; button returns to Send via SSE `done` or 3s fallback.
8. `pnpm typecheck` + `pnpm test` green.
