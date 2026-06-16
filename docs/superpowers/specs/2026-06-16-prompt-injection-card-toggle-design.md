# Prompt-injection card: settings toggle + cross-session persistence

**Date:** 2026-06-16
**Status:** Approved (design)
**Scope:** Conversation UI — the collapsible card that shows prompt-injection details. Adds a settings-controlled visibility flag and persists the expand/collapse state across sessions. Card content and appearance are unchanged.

## Problem

A `CollapsibleHookCard` already exists ([packages/frontend/src/pages/active-conversation.tsx:626](../../../packages/frontend/src/pages/active-conversation.tsx)). It renders on a user message when the context-injection hook ran, showing the retrieved **context pack** and the **improved prompt** sent to the agent, with a toggle button. Two gaps remain versus the desired behavior:

1. There is no setting to control whether the card is shown at all.
2. Its expand/collapse uses local `useState`, so it resets every render/session — the state is not remembered.

## Goal

- Add an `AppConfig.showPromptInjectionCard` flag (default `true`) with a toggle on the settings page. When `false`, the card is not rendered.
- Persist the expand/collapse state across sessions as a single **global default**: toggling any card updates the shared preference and all cards reflect it.
- Keep the card's current content (context pack + improved prompt) and appearance.

Decisions (confirmed with user):
- **Persistence granularity:** global default (one localStorage key, shared across all cards), initial state **collapsed**.
- **Settings default:** shown by default (`showPromptInjectionCard` defaults to `true`; `undefined` is treated as `true`).
- **Card content:** unchanged — context pack + improved prompt.

## Approach (chosen)

Lift a single shared `promptCardExpanded` boolean to the active-conversation page (initialized from localStorage, default collapsed) and pass it plus a toggle handler to every `CollapsibleHookCard`. Toggling writes back to localStorage, so all cards share one persisted global default. Gate rendering on `AppConfig.showPromptInjectionCard`, fetched once on mount and treated as `true` when unset.

Rejected:
- **Per-card local state seeded from a global default** — cards drift apart after the first toggle; "toggle one → all update" wouldn't hold.
- **Persisting expand state in AppConfig (backend)** — a network round-trip per toggle for a pure UI preference; unnecessary.

## Design

### Config field — `showPromptInjectionCard` (default `true`)

- `packages/shared/src/index.ts` — add `showPromptInjectionCard?: boolean` to the `AppConfig` interface.
- `packages/conversation/src/config/app-config.ts` — add `showPromptInjectionCard?: boolean` to the `AppConfig` interface and handle it in `sanitize` as a boolean passthrough, mirroring `enableNotifications`.
- `packages/backend/src/config.ts` — add `showPromptInjectionCard: z.boolean().optional()` to the `PatchBody` zod schema.
- `undefined` is treated as `true` (shown) everywhere it's read; no migration or stored default needed.

### Settings page — visibility toggle

`packages/frontend/src/pages/settings.tsx`: add a checkbox bound to `form.showPromptInjectionCard ?? true`, included in the `handleSave` patch, following the existing `enableNotifications` toggle pattern (control + `setForm` binding + inclusion in `updateAppConfig`). Label: "Show prompt-injection card in conversations".

### Expand/collapse persistence — new hook

New file `packages/frontend/src/lib/use-prompt-card-expanded.ts`: a hook `usePromptCardExpanded(): [boolean, (next: boolean) => void]` backed by `localStorage['anubis:prompt-injection-card-expanded']`, default `false` (collapsed). Follows the `use-default-profile.ts` convention (lazy `useState` initializer reading localStorage; setter updates state and writes localStorage; guards `typeof window !== 'undefined'`).

### Wiring — `active-conversation.tsx`

- On mount, fetch `getAppConfig()` and store `showPromptInjectionCard` (treat `undefined` as `true`).
- Call `usePromptCardExpanded()` once at page level; thread `expanded` + an `onToggle` callback through `RenderedMessage` to `CollapsibleHookCard`.
- Refactor `CollapsibleHookCard` to accept `expanded: boolean` and `onToggle: () => void` props and drop its internal `useState`.
- When `showPromptInjectionCard` is `false`, do not render `CollapsibleHookCard` at all (skip the `showHookInfo` branch's card).

## Testing (TDD)

- **Hook** (`packages/frontend` vitest): `usePromptCardExpanded` defaults to `false` when nothing stored; reads a stored `true`; writes localStorage on set.
- **Backend config**: `AppConfigService.update({ showPromptInjectionCard: false })` round-trips through `get()`; the `PatchBody` zod schema accepts the field.

## Out of scope

- Changing what the card displays or how it looks.
- Per-message or per-conversation expand state (explicitly chose global default).
- Live propagation of a settings change into already-open conversations (config is read on mount).
