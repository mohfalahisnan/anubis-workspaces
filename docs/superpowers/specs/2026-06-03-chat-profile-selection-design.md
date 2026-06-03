# Real Chat Features + Profile Selection — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `packages/frontend` (most of it), small touch on `packages/backend`, `packages/conversation`, `packages/shared`
**Builds on:** MDX chat rendering (commits 80dea9a..f4fc505).

## Problem

The active-conversation page now renders messages with MDX and streams via SSE,
but the chat flow itself isn't real:

- The "Claude · Coding" pill in the composer is static text — no profile picker.
- The "New conversation" button drops you on an empty page; clicking Send just
  bounces back to the list (no `createConversation` call).
- There's no way to override the agent's reasoning effort per conversation —
  the only knob is the profile's default.

We need to make new-conversation creation, profile selection, and per-conversation
reasoning-effort override work end-to-end against the existing backend.

## Goals

1. A **composer profile picker** that drives both new-conversation creation
   *and* mid-conversation profile switching via `PATCH /conversations/:id`.
2. A **composer reasoning-effort picker** that overrides the profile's default
   at the conversation level, cleared back to inheriting on match.
3. A working **new-conversation create flow**: type → Send →
   `createConversation` + `sendMessage` + navigate to the new id.
4. **Auto workspacePath**: backend defaults to
   `<dataDir>/workspaces/<conversation-id>` when the frontend omits it.
5. **Default profile persistence** via `localStorage` (`anubis:last-profile`).
6. A **composer Stop button** that morphs out of the Send button while a run
   is streaming, calls the existing `POST /conversations/:id/cancel` endpoint,
   and optimistically ends the stream UX.

## Non-goals

- Folder-picker UI for a custom `workspacePath` (deferred).
- Model override at the conversation level — model stays a profile setting.
- Per-turn override surface in the composer (the backend's `sendMessage`
  override is left untouched and unused by the UI for now).
- A separate "Choose your profile" empty-state splash; composer picker only.
- Persisting `reasoningEffort` choices across conversations in localStorage —
  effort cascades from profile default, conversation-scoped only.
- Reconstructing tool-event cards on reload (already deferred from MDX work).
- Cancelling an in-flight run when the user switches profile — picker stays
  disabled during a stream instead.

## Architecture

The active-conversation page becomes the single mount point for both the
new-conversation flow and the existing-conversation flow:

```
ActiveConversationPage
├── useConversationMessages(id?)               // existing — seed + SSE
├── useCatalog()                               // NEW — fetches reasoningEfforts once
├── useDefaultProfile(profiles)                // NEW — localStorage-backed pick
├── useEnsureConversation(id?, profile)        // NEW — wraps createConversation
├── <ProfilePicker>                            // NEW — composer pill #1
└── <ReasoningPicker>                          // NEW — composer pill #2
```

Two new pickers replace the static "Claude · Coding" pill in the composer.
The page reconciles selection state with the conversation row: PATCH on
change for existing conversations, defer to `createConversation` for new ones.

## State model

```ts
interface ChatState {
  // Source of truth for the conversation row, refreshed on `done` SSE event.
  conversation: ConversationSummary | null
  // The selected profile object resolved from `profiles` + selection id.
  selectedProfile: ProfileSummary | null
  // Effective reasoning effort = override ?? profile default ?? catalog default.
  effort: ReasoningEffort
  // Whether `effort` differs from the profile's default.
  effortIsOverride: boolean
  // True while createConversation or any PATCH is in flight.
  busy: boolean
  // True while the SSE stream is active.
  streaming: boolean
}
```

`selectedProfile` and `effort` are *desired* state. They become *applied* state
the moment we land a PATCH (or, for a new chat, the moment `createConversation`
succeeds). On error: revert to the applied state and surface an inline error.

## Profile picker

`packages/frontend/src/components/composer/profile-picker.tsx`

```ts
interface Props {
  profiles: ProfileSummary[]
  value: ProfileSummary | null
  onChange: (next: ProfileSummary) => void
  disabled?: boolean
}
```

A pill (gold dot, "Agent · ProfileName" — matching today's static styling)
plus a chevron. Radix `Popover` opens a two-section menu:

```
My profiles
  ● Coding scratch       claude-sonnet-4-6   2h ago
  ● Marketing research   claude-opus-4-8     yesterday

Built-in
  ● Claude · Coding      claude-sonnet-4-6
  ● Claude · Research    claude-sonnet-4-6
  ● Codex · Coding       gpt-5-codex
```

- Renders ARIA listbox semantics; arrow keys navigate; Esc closes; Enter selects.
- Selecting an item closes the popover, calls `onChange`, focuses the composer
  textarea so the user can keep typing.
- `disabled` greys the pill and prevents open.
- Empty `profiles` → a disabled grey pill labeled "Loading…".
- On error from a parent PATCH, a small inline `<span>` appears under the
  composer (not in the pill) with the error message and a Dismiss button.

## Reasoning-effort picker

`packages/frontend/src/components/composer/reasoning-picker.tsx`

```ts
interface Props {
  efforts: readonly ReasoningEffort[]   // from catalog.reasoningEfforts
  value: ReasoningEffort                // resolved effective effort
  isOverride: boolean                   // true ⇒ ≠ profile default
  onChange: (next: ReasoningEffort) => void
  disabled?: boolean
}
```

A compact pill: `"effort: <value>"` with an optional gold dot to its right when
`isOverride` is true (tooltip: "Overrides profile default '<profileEffort>'").
Click opens a single-column Radix popover listing the four values from the catalog.

Behavior:

- Picking a value calls `onChange(next)`.
- The parent decides whether the PATCH carries an override or clears it:
  - If `next !== profileDefault` → `PATCH { override: { reasoningEffort: next } }`.
  - If `next === profileDefault` → `PATCH { override: {} }` (clears all
    conversation-level overrides — see "Clear semantics" below).

### Clear semantics

The backend's `update()` does `overrides: patch.override ?? cur.extra.overrides`
— there is no field-level merge. Passing `{ override: {} }` replaces overrides
with an empty object, clearing every conversation-level override at once. That
is fine for now: `reasoningEffort` is the only conversation-level override the
UI exposes. If future UI adds more, switch to a `mergeOverride` shape in the
backend at that time. Documented as a known limitation.

## New-conversation create flow

`packages/frontend/src/lib/use-ensure-conversation.ts`

```ts
function useEnsureConversation(
  conversationId: string | undefined,
  selectedProfile: ProfileSummary | null,
  effort: ReasoningEffort,
  profileDefaultEffort: ReasoningEffort,
): {
  ensure(firstContent: string): Promise<string>
  creating: boolean
  error: string | null
}
```

`ensure(firstContent)`:

1. If `conversationId` is defined → return it (no-op).
2. Else: derive `title = firstContent.trim().slice(0, 60) || 'New conversation'`.
3. Build `override = effort !== profileDefaultEffort ? { reasoningEffort: effort } : undefined`.
4. Call `createConversation({ title, profileId: selectedProfile.id, agent: selectedProfile.config.agent, override })` — **no `workspacePath`**.
5. Return the new id.

Composer's `submit`:

```ts
async function submit(content: string) {
  try {
    const id = await ensure(content)
    await apiSendMessage(id, content)
    if (id !== conversationId) {
      navigate({ page: 'active-conversation', conversationId: id })
    }
  } catch (e) {
    setSendError(e instanceof Error ? e.message : String(e))
  }
}
```

Optimistic UX: while `ensure` + `sendMessage` are in flight, render a
locally-constructed `MessageSummary` for the user's message at the bottom of
the transcript. After navigation, the SSE hook seeds from `listMessages` and
overwrites local state with the canonical row.

## Stop button — Send ↔ Stop morph

The composer's submit control is a single button that morphs between two
states:

| State | Visual | Action on click |
|---|---|---|
| Streaming idle | Gold "Send" with paper-plane icon | Submit message (existing path) |
| Streaming active | Destructive red "Stop" with square icon | Call `cancelConversation(id)`, optimistically end stream |

State is driven entirely by the `streaming` flag from
`useConversationMessages` (already exists). No new local state on the page —
the SSE hook is the single source of truth for "a run is in flight."

`packages/frontend/src/api.ts` already exports `cancelConversation(id)`;
the wiring lives in the composer's button.

**Stop click handler:**

```ts
async function onStop() {
  if (!conversationId) return
  setStopping(true)
  try {
    await cancelConversation(conversationId)
  } catch (e) {
    setSendError(e instanceof Error ? e.message : String(e))
  } finally {
    setStopping(false)
  }
}
```

The button shows a small spinner while `stopping` is true so a slow
cancellation roundtrip doesn't look like a no-op. The SSE hook flips
`streaming` to `false` when it receives the `done` event the backend emits
after a successful cancel; that re-renders the button back to "Send".

If the backend's `done` event doesn't arrive within ~3s, the optimistic UI
nonetheless flips to Send (the user's intent was clearly "stop") and a small
inline notice reads "Cancel may still be in progress." Implementation: a
3-second timeout after `cancelConversation` resolves; if `streaming` is
still true, the page locally treats it as cancelled. The SSE hook keeps
running until `done` arrives so transcripts stay correct.

The existing header "Cancel" button is **removed** in this work — the
composer is the single entry point. The status bar's "Cancelled · Ns elapsed"
strip is preserved and triggered by the same logic.

The Stop button is the only composer control still active while streaming —
the profile picker, reasoning picker, attach button, and textarea are all
disabled (existing behavior for the textarea via the `disabled` prop;
pickers per "Profile switching mid-conversation" below).

## Profile switching mid-conversation

`packages/frontend/src/api.ts` — new export `updateConversation`:

```ts
export async function updateConversation(
  id: string,
  patch: {
    title?: string
    archived?: boolean
    override?: Record<string, unknown>
    profileId?: string | null
  },
): Promise<ConversationSummary> {
  const r = await api<{ ok: true; conversation: ConversationSummary }>(
    `/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return r.conversation
}
```

On `ProfilePicker.onChange(next)` for an existing conversation:

1. Optimistically set `selectedProfile = next` and `busy = true`.
2. Fire `updateConversation(id, { profileId: next.id })`.
3. On success: store the returned `conversation` row; `busy = false`.
4. On failure: revert `selectedProfile`, surface error, `busy = false`.

Both pickers are `disabled` while `streaming` is true. Switching mid-stream
isn't meaningful (the agent is already running on the current profile/effort).

## Default profile + localStorage

`packages/frontend/src/lib/use-default-profile.ts`

```ts
function useDefaultProfile(profiles: ProfileSummary[]):
  [ProfileSummary | null, (next: ProfileSummary) => void]
```

- Reads `localStorage.getItem('anubis:last-profile')` once.
- If that id exists in `profiles`, returns it.
- Else picks the most recently used (`profiles.sort by lastUsedAt desc`).
- Else returns the first profile, or `null` if the list is empty.
- The setter writes through to localStorage.

## Backend tweak: optional workspacePath

Three small changes, none breaking. Lives in the same PR per scope decision.

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | `CreateConversationInput.workspacePath` becomes optional. |
| `packages/backend/src/conversation.ts` | Zod schema: `workspacePath: z.string().min(1).optional()`. |
| `packages/conversation/src/conversations/conversation-service.ts` | If `input.workspacePath` is absent, compute `path.join(opts.dataDir, 'workspaces', conversationId)`, `mkdirSync(..., { recursive: true })`, persist that on the row. |

The service already receives `dataDir` via `createConversationService({ dataDir, ... })`,
so the change is local to that file. `getStack()` in `services.ts` already
supplies a `dataDir` (env or `tmpdir()` fallback).

Existing callers that already provide `workspacePath` continue to work
unchanged (the existing test on `conversation-service.test.ts` covers that
path).

## Catalog hook

`packages/frontend/src/lib/use-catalog.ts`

A trivial module-singleton-cached fetch of `getCatalog()`. Returns
`{ catalog: AgentCatalog | null, error: string | null }`. One fetch per app
session, shared by the reasoning picker (and any future consumer).

Cache lives at module scope. Errors are not retried automatically; user can
hard-refresh.

## Wiring on the page

Pseudocode for `active-conversation.tsx` changes:

```tsx
const { catalog } = useCatalog()
const [profiles] = useProfiles()
const [defaultProfile, setDefaultProfile] = useDefaultProfile(profiles)
const [pickedProfile, setPickedProfile] = useState<ProfileSummary | null>(null)
const selectedProfile = pickedProfile ?? convProfile ?? defaultProfile

const profileDefaultEffort =
  (selectedProfile?.config.reasoningEffort as ReasoningEffort | undefined)
  ?? catalog?.defaultReasoningEffort ?? 'medium'
const convOverrideEffort = conv?.extra.overrides?.reasoningEffort as ReasoningEffort | undefined
const effectiveEffort = pickedEffort ?? convOverrideEffort ?? profileDefaultEffort
const effortIsOverride = effectiveEffort !== profileDefaultEffort

const { ensure } = useEnsureConversation(
  conversationId, selectedProfile, effectiveEffort, profileDefaultEffort,
)

// On profile change:
async function onProfileChange(next: ProfileSummary) {
  setPickedProfile(next)
  setDefaultProfile(next)
  if (conversationId) {
    try {
      await updateConversation(conversationId, { profileId: next.id })
    } catch (e) { /* revert + show error */ }
  }
}

// On effort change:
async function onEffortChange(next: ReasoningEffort) {
  setPickedEffort(next)
  if (conversationId) {
    const patch = next === profileDefaultEffort ? {} : { reasoningEffort: next }
    try {
      await updateConversation(conversationId, { override: patch })
    } catch (e) { /* revert + show error */ }
  }
}
```

`useProfiles` is a thin existing-pattern fetch (same shape as
`useConversationMessages`'s seed). May reuse a small `usePromise`-style hook
if one exists; otherwise local to this page.

## Testing

Vitest under `packages/frontend/tests/`:

- `components/profile-picker.test.tsx`
  - Renders profiles grouped (My profiles / Built-in).
  - Click → `onChange(profile)` with the right item.
  - `disabled` prop greys pill and prevents popover open.
  - Empty profiles → disabled "Loading…" pill.

- `components/reasoning-picker.test.tsx`
  - Renders four options from `efforts` prop.
  - Click → `onChange(next)` fires.
  - Modified dot shows when `isOverride` is true.
  - `disabled` blocks open.

- `lib/use-default-profile.test.tsx`
  - Returns localStorage id when present in list.
  - Falls back to most-recently-used when storage is empty or stale.
  - Setter writes through to localStorage (verified via `window.localStorage` spy).

- `lib/use-ensure-conversation.test.tsx`
  - With `conversationId` set: `ensure` is a no-op returning that id.
  - Without: calls `createConversation` with derived title + profile + effort
    override only when effort differs from profile default.
  - Reports `creating` and `error` correctly.

- `conversation/tests/conversations/conversation-service.test.ts` — extend
  the existing suite:
  - Without `workspacePath`: row gets `<dataDir>/workspaces/<id>` and the
    directory exists on disk afterward.

No integration test for the SSE-+-create-+-navigate flow this round; verified
manually in `pnpm dev`.

## YAGNI / explicitly deferred

- Cancelling a streaming run when the user switches profile (pickers stay
  disabled during streams instead).
- Per-turn `override` surface in the composer (the backend supports it but
  the UI does not expose it).
- Showing the cascaded source of the effort ("from profile" vs "overridden")
  beyond the binary "modified dot".
- A "reset to profile defaults" button — picking the default value already
  clears the override.
- Folder-pick dialog for `workspacePath`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Two roundtrips on first Send (create + send) feel slow. | Optimistic-render the user message immediately; backend creation is sub-100ms for an in-process SQLite write; SSE catches up after navigation. |
| Profile vanishes from the list between localStorage write and next mount (rare — user deleted it). | `useDefaultProfile` checks membership; if missing, falls back to most-recently-used. |
| Switching profile while a stream is "almost done" disables the picker briefly. | Acceptable. The flag flips back to enabled on the `done` event. |
| Clearing overrides drops other override knobs the UI doesn't yet expose. | Documented limitation. Today the only conversation-level override the UI touches is `reasoningEffort`; nothing else to drop. |
| Workspace dir doesn't exist when agent boots. | `mkdirSync(..., { recursive: true })` in the conversation service guarantees it before the row is committed. |

## Acceptance criteria

1. From the conversations list, "New conversation" lands on an empty
   active-conversation with a real profile pre-selected and the composer
   enabled.
2. Typing a message and clicking Send creates the conversation via
   `createConversation`, sends the message via `sendMessage`, and navigates
   to the new id — without showing any error in the happy path.
3. The new row in `listConversations` has:
   - `title = first ~60 chars of the message`
   - `profileId = selected profile`
   - `workspacePath = <dataDir>/workspaces/<id>` (verified by reading the row)
4. On an existing conversation, picking a different profile triggers a PATCH
   and the row's `profileId` updates in the backend.
5. Picking a different effort: row's `extra.overrides.reasoningEffort`
   updates; picking it back to the profile's default clears `extra.overrides`.
6. Both pickers are disabled while a stream is active.
7. Default profile persists across reloads via `localStorage`.
8. The composer Send button morphs into a Stop button while a run is
   streaming. Click Stop → `cancelConversation` fires → button returns to
   Send within ~3s (either via SSE `done` or local timeout fallback).
9. The status bar shows "Cancelled · Ns elapsed" after a successful cancel,
   identical to the pre-cancel "Streaming" strip.
10. `pnpm typecheck` + `pnpm test` green.

## File-by-file summary

| Path | Change |
|---|---|
| `packages/shared/src/index.ts` | `workspacePath` optional on `CreateConversationInput`. |
| `packages/backend/src/conversation.ts` | Zod: `workspacePath` optional. |
| `packages/conversation/src/conversations/conversation-service.ts` | Default-fill `workspacePath` + `mkdir`. |
| `packages/frontend/src/api.ts` | Add `updateConversation(id, patch)`. |
| `packages/frontend/src/components/composer/profile-picker.tsx` | NEW. |
| `packages/frontend/src/components/composer/reasoning-picker.tsx` | NEW. |
| `packages/frontend/src/lib/use-catalog.ts` | NEW. |
| `packages/frontend/src/lib/use-default-profile.ts` | NEW. |
| `packages/frontend/src/lib/use-ensure-conversation.ts` | NEW. |
| `packages/frontend/src/pages/active-conversation.tsx` | Wire both pickers, new-conv flow, switch via PATCH, Send↔Stop morph. Remove header Cancel button. |
| `packages/frontend/tests/components/profile-picker.test.tsx` | NEW. |
| `packages/frontend/tests/components/reasoning-picker.test.tsx` | NEW. |
| `packages/frontend/tests/lib/use-default-profile.test.tsx` | NEW. |
| `packages/frontend/tests/lib/use-ensure-conversation.test.tsx` | NEW. |
| `packages/conversation/tests/conversations/conversation-service.test.ts` | Extend: optional `workspacePath` covers `<dataDir>/workspaces/<id>`. |
