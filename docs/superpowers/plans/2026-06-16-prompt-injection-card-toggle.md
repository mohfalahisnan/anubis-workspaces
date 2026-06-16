# Prompt-injection card: settings toggle + cross-session persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AppConfig.showPromptInjectionCard` flag (default true) with a settings-page toggle that controls whether the conversation prompt-injection card renders, and persist the card's expand/collapse as a single global default across sessions.

**Architecture:** A new boolean config field flows shared → conversation `AppConfigService` (default true) → backend zod → settings UI. The existing `CollapsibleHookCard` in `active-conversation.tsx` is refactored to take `expanded`/`onToggle` props; the page owns one shared `promptCardExpanded` state via a new localStorage-backed hook, and gates the card on the config flag (already-fetched `appConfig`).

**Tech Stack:** TypeScript (ESM), pnpm monorepo, Hono backend, React 19 frontend, Vitest (jsdom for frontend, `@testing-library/react` for hooks).

**Spec:** [docs/superpowers/specs/2026-06-16-prompt-injection-card-toggle-design.md](../specs/2026-06-16-prompt-injection-card-toggle-design.md)

**Build-order notes:** Backend tests import `@anubis/shared` and `@anubis/conversation` from their `dist`. After editing those packages, rebuild before running backend tests:
- `pnpm --filter @anubis/shared build`
- `pnpm --filter @anubis/conversation build`

Frontend tests run under the frontend package's own vitest (jsdom): `pnpm --filter @anubis/frontend exec vitest run <file>`.

---

## Task 1: Add `showPromptInjectionCard` to the shared `AppConfig`

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the field**

In `packages/shared/src/index.ts`, in the `AppConfig` interface, after the `enableContextInjection` / `contextInjectionProfileId` lines (around line 422-424), add:

```ts
  /** Whether the prompt-injection details card is shown in conversations. Defaults to true. */
  showPromptInjectionCard?: boolean
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @anubis/shared build`
Expected: builds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add AppConfig.showPromptInjectionCard"
```

---

## Task 2: Persist + default the flag in `AppConfigService`

**Files:**
- Modify: `packages/conversation/src/config/app-config.ts`
- Test: `packages/conversation/tests/config/app-config.test.ts`

- [ ] **Step 1: Write the failing test**

Append this describe block to `packages/conversation/tests/config/app-config.test.ts`:

```ts
describe('AppConfigService — showPromptInjectionCard', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anubis-cfg-card-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('defaults to true when unset', () => {
    expect(new AppConfigService(dir).get().showPromptInjectionCard).toBe(true)
  })

  it('round-trips false and reloads it', () => {
    new AppConfigService(dir).update({ showPromptInjectionCard: false })
    expect(new AppConfigService(dir).get().showPromptInjectionCard).toBe(false)
  })

  it('round-trips true', () => {
    const next = new AppConfigService(dir).update({ showPromptInjectionCard: true })
    expect(next.showPromptInjectionCard).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/config/app-config.test.ts`
Expected: FAIL — `showPromptInjectionCard` is `undefined` (not defaulted, not persisted).

- [ ] **Step 3: Add the interface field**

In `packages/conversation/src/config/app-config.ts`, in the `AppConfig` interface, after `contextInjectionProfileId?: string` (around line 53), add:

```ts
  /** Whether the prompt-injection details card is shown in conversations. Defaults to true. */
  showPromptInjectionCard?: boolean
```

- [ ] **Step 4: Add sanitize handling (default true)**

In the `sanitize` function, after the `enableContextInjection` block (around line 116-120), add:

```ts
  if (typeof obj.showPromptInjectionCard === 'boolean') {
    out.showPromptInjectionCard = obj.showPromptInjectionCard
  } else if (obj.showPromptInjectionCard === undefined) {
    out.showPromptInjectionCard = true
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/config/app-config.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/config/app-config.ts packages/conversation/tests/config/app-config.test.ts
git commit -m "feat(conversation): default + persist showPromptInjectionCard config"
```

---

## Task 3: Accept the field in the backend `/config` zod schema

**Files:**
- Modify: `packages/backend/src/config.ts`
- Test: `packages/backend/tests/config-route.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('/config route', ...)` block in `packages/backend/tests/config-route.test.ts`:

```ts
  it('PATCH /config round-trips showPromptInjectionCard', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ showPromptInjectionCard: false }),
    })
    expect(patch.status).toBe(200)
    const get = await app.request('/config')
    const body = (await get.json()) as { config: { showPromptInjectionCard?: boolean } }
    expect(body.config.showPromptInjectionCard).toBe(false)
  })
```

- [ ] **Step 2: Build deps and run the test to verify it fails**

Run:
```bash
pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build
pnpm vitest run packages/backend/tests/config-route.test.ts
```
Expected: FAIL — `PatchBody` is `.strict()`, so the unknown `showPromptInjectionCard` key makes the PATCH 400, and the round-trip assertion fails. (If the suite shows mass `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3` first — that's an environmental ABI drift, not this change.)

- [ ] **Step 3: Add the zod field**

In `packages/backend/src/config.ts`, in the `PatchBody` zod object, after `enableContextInjection: z.boolean().optional(),` (around line 58), add:

```ts
  showPromptInjectionCard: z.boolean().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/config-route.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/tests/config-route.test.ts
git commit -m "feat(backend): accept showPromptInjectionCard in /config PATCH"
```

---

## Task 4: localStorage-backed global expand/collapse hook

**Files:**
- Create: `packages/frontend/src/lib/use-prompt-card-expanded.ts`
- Test: `packages/frontend/tests/lib/use-prompt-card-expanded.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/lib/use-prompt-card-expanded.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePromptCardExpanded, STORAGE_KEY } from '@/lib/use-prompt-card-expanded'

beforeEach(() => {
  window.localStorage.clear()
})

describe('usePromptCardExpanded', () => {
  it('defaults to false when nothing is stored', () => {
    const { result } = renderHook(() => usePromptCardExpanded())
    expect(result.current[0]).toBe(false)
  })

  it('reads a stored true value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    const { result } = renderHook(() => usePromptCardExpanded())
    expect(result.current[0]).toBe(true)
  })

  it('setter writes through to localStorage and updates state', () => {
    const { result } = renderHook(() => usePromptCardExpanded())
    act(() => result.current[1](true))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(result.current[0]).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/lib/use-prompt-card-expanded.test.tsx`
Expected: FAIL — module `use-prompt-card-expanded` does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/frontend/src/lib/use-prompt-card-expanded.ts`:

```ts
import { useCallback, useState } from 'react'

export const STORAGE_KEY = 'anubis:prompt-injection-card-expanded'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === 'true'
}

/**
 * Global default expand/collapse state for the prompt-injection card, persisted
 * across sessions. Shared by every card on the page — toggling one updates the
 * single stored preference. Defaults to collapsed.
 */
export function usePromptCardExpanded(): [boolean, (next: boolean) => void] {
  const [expanded, setExpanded] = useState<boolean>(readInitial)

  const set = useCallback((next: boolean) => {
    setExpanded(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    }
  }, [])

  return [expanded, set]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/lib/use-prompt-card-expanded.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/use-prompt-card-expanded.ts packages/frontend/tests/lib/use-prompt-card-expanded.test.tsx
git commit -m "feat(frontend): global persisted expand state hook for prompt card"
```

---

## Task 5: Settings-page visibility toggle

**Files:**
- Modify: `packages/frontend/src/pages/settings.tsx`

- [ ] **Step 1: Add the dirty check**

In `packages/frontend/src/pages/settings.tsx`, after the `notificationsDirty` block (around line 69-71), add:

```ts
  const promptCardDirty =
    config !== null &&
    (form.showPromptInjectionCard ?? true) !== (config.showPromptInjectionCard ?? true)
```

Then include it in the `dirty` expression (line 77):

```ts
  const dirty = chromePathDirty || engineBinaryPathDirty || extractorBinaryPathDirty || levelsDirty || multipliersDirty || notificationsDirty || promptCardDirty || qoderApiKeyDirty
```

- [ ] **Step 2: Send + echo the field in `handleSave`**

In `handleSave`, add to the `updateAppConfig({ ... })` patch (after `enableNotifications: form.enableNotifications ?? true,`, line 89):

```ts
        showPromptInjectionCard: form.showPromptInjectionCard ?? true,
```

And to the `setForm((f) => ({ ... }))` echo (after `enableNotifications: next.enableNotifications ?? true,`, line 100):

```ts
        showPromptInjectionCard: next.showPromptInjectionCard ?? true,
```

- [ ] **Step 3: Add the toggle UI**

In the JSX, immediately after the closing `</section>` of the "Desktop Notifications" section (around line 270), add a new section:

```tsx
        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Conversation display</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Show the collapsible prompt-injection card under user messages, revealing the retrieved context pack and the improved prompt sent to the agent.
          </p>
          <div className='mt-4 flex items-center gap-3'>
            <input
              type='checkbox'
              id='show-prompt-injection-card'
              checked={form.showPromptInjectionCard ?? true}
              onChange={(e) => setForm((f) => ({ ...f, showPromptInjectionCard: e.target.checked }))}
              className='size-4 rounded border-border text-[var(--anubis-gold)] bg-card outline-none focus:ring-0 focus:ring-offset-0 accent-[var(--anubis-gold)] cursor-pointer'
            />
            <label htmlFor='show-prompt-injection-card' className='text-[13px] font-medium text-foreground cursor-pointer select-none'>
              Show prompt-injection card in conversations
            </label>
          </div>
        </section>
```

- [ ] **Step 4: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/settings.tsx
git commit -m "feat(settings): toggle for prompt-injection card visibility"
```

---

## Task 6: Gate + persist the card in the conversation view

**Files:**
- Modify: `packages/frontend/src/pages/active-conversation.tsx`

- [ ] **Step 1: Import the hook**

In `packages/frontend/src/pages/active-conversation.tsx`, add near the other `@/lib` imports:

```ts
import { usePromptCardExpanded } from '@/lib/use-prompt-card-expanded'
```

- [ ] **Step 2: Use the hook + derive the visibility flag in the page component**

Inside `ActiveConversationPage` (the `appConfig` state already exists at line 238), add after the `appConfig` state/effect:

```ts
  const [promptCardExpanded, setPromptCardExpanded] = usePromptCardExpanded()
  const showPromptInjectionCard = appConfig?.showPromptInjectionCard ?? true
  const togglePromptCard = useCallback(
    () => setPromptCardExpanded(!promptCardExpanded),
    [promptCardExpanded, setPromptCardExpanded],
  )
```

(`useCallback` is already imported on line 1.)

- [ ] **Step 3: Pass the props down at the `messages.map` call site**

Replace the `RenderedMessage` render (lines 514-516) with:

```tsx
          {messages.map((m) => (
            <RenderedMessage
              key={m.id}
              message={m}
              conversationId={conversationId ?? ''}
              showCard={showPromptInjectionCard}
              cardExpanded={promptCardExpanded}
              onToggleCard={togglePromptCard}
            />
          ))}
```

- [ ] **Step 4: Thread the props through `RenderedMessage`**

Change the `RenderedMessage` signature (lines 686-692) to:

```tsx
const RenderedMessage = memo(function RenderedMessage({
  message,
  conversationId,
  showCard,
  cardExpanded,
  onToggleCard,
}: {
  message: MessageSummary
  conversationId: string
  showCard: boolean
  cardExpanded: boolean
  onToggleCard: () => void
}) {
```

And in the user branch, replace the card render (lines 707-712):

```tsx
        {showCard && showHookInfo && (
          <CollapsibleHookCard
            contextPack={contextPack ?? ''}
            improvedPrompt={improvedPrompt ?? ''}
            expanded={cardExpanded}
            onToggle={onToggleCard}
          />
        )}
```

- [ ] **Step 5: Refactor `CollapsibleHookCard` to controlled props**

Replace the `CollapsibleHookCard` definition (lines 626-633) so it takes `expanded`/`onToggle` and drops the internal `useState`:

```tsx
function CollapsibleHookCard({
  contextPack,
  improvedPrompt,
  expanded,
  onToggle,
}: {
  contextPack: string
  improvedPrompt: string
  expanded: boolean
  onToggle: () => void
}) {
```

And change the toggle button's handler (line 639) from `onClick={() => setExpanded(!expanded)}` to:

```tsx
        onClick={onToggle}
```

(The rest of the component already reads `expanded` — no other changes.)

- [ ] **Step 6: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: no errors (no remaining `setExpanded` reference in `CollapsibleHookCard`).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/active-conversation.tsx
git commit -m "feat(conversations): gate prompt-injection card on setting, persist expand state"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Build changed backend-side packages**

Run:
```bash
pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build
```
Expected: both build clean.

- [ ] **Step 2: Whole-workspace typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run affected tests**

Run:
```bash
pnpm vitest run --maxWorkers=2 packages/conversation/tests/config/app-config.test.ts packages/backend/tests/config-route.test.ts
pnpm --filter @anubis/frontend exec vitest run tests/lib/use-prompt-card-expanded.test.tsx
```
Expected: all PASS. (If backend shows `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3` and re-run — environmental, not this change.)

---

## Self-review notes

- **Spec coverage:** config field (Tasks 1-3) · settings toggle (Task 5) · global persisted expand state (Task 4) · gate + controlled card (Task 6). All spec sections map to a task.
- **Default true:** `undefined` → `true` is enforced in `AppConfigService.sanitize` (Task 2) and read defensively as `?? true` in settings (Task 5) and the conversation view (Task 6).
- **Global shared state:** one `usePromptCardExpanded` instance at page level (Task 6 Step 2), passed to every card — toggling one updates the single localStorage key (Task 4), satisfying "toggle any card → all update".
- **Type consistency:** `showPromptInjectionCard` added to both the shared `AppConfig` (Task 1) and the conversation `AppConfig` interface (Task 2); `CollapsibleHookCard`/`RenderedMessage` prop names (`expanded`/`onToggle`, `showCard`/`cardExpanded`/`onToggleCard`) are consistent between definition and call sites in Task 6.
- **Out of scope:** card content/appearance, per-message/per-conversation state, live settings propagation into open conversations.
```
