# Workspace/workdir selector with remembered folders

**Date:** 2026-06-05
**Status:** Approved

## Problem

When starting a new conversation the working directory is fixed: the backend
auto-creates a throwaway folder under `{dataDir}/workspaces/{conversationId}`.
There is no way to start a conversation in an existing project folder, and the
only way to change a conversation's workdir is the header pencil, which opens a
raw `window.prompt` requiring the user to type or paste a full path every time.

Users want to:

1. Pick the working directory when creating a new conversation.
2. Have every chosen workdir remembered in the database, so a folder used
   before can be re-selected from a list without browsing the filesystem again.

## Goals

- A workdir selector available in the composer for new conversations.
- Persist chosen real folders in the DB; list them ordered by most-recently-used.
- New conversations default to the most recently used saved folder (falling back
  to an auto temp folder when nothing has been saved yet).
- Reuse the same selector for the existing mid-conversation header changer.

## Non-goals

- Per-folder friendly labels/renaming (basename is shown, derived client-side).
- Recording the per-conversation scratch dirs under the auto `workspacesRoot`
  (those are throwaway and pollute the list).
- Validating that a remembered folder still exists on disk at list time
  (a stale entry can simply be removed with the ✕).

## Design

### 1. Data layer (`@anubis/conversation`)

New migration `006_known_workspaces.sql`:

```sql
CREATE TABLE known_workspaces (
  path         TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
```

Registered as migration version 6 in `db/migrations/index.ts`.

New `KnownWorkspacesRepo` (`db/repositories/known-workspaces-repo.ts`):

- `remember(path: string): void` — upsert; insert with `created_at`/`last_used_at`
  on first sight, otherwise bump `last_used_at`. Implemented with
  `INSERT ... ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`.
- `list(): KnownWorkspace[]` — all rows ordered by `last_used_at DESC`.
- `remove(path: string): void` — delete by path.

`KnownWorkspace` type: `{ path: string; lastUsedAt: number; createdAt: number }`.

### 2. Recording logic (`ConversationService`)

The service already receives `workspacesRoot` in its deps. Add `knownWorkspaces:
KnownWorkspacesRepo` to `ConversationServiceDeps`.

A private helper records a path only when it is a real, user-chosen folder:

```
private rememberWorkspace(path: string): void {
  // Skip throwaway per-conversation scratch dirs under workspacesRoot.
  if (isUnder(path, this.deps.workspacesRoot)) return
  this.deps.knownWorkspaces.remember(path)
}
```

`isUnder` uses `path.relative(root, p)` and checks the result does not start
with `..` and is not absolute (handles Windows drive-letter cases).

Call `rememberWorkspace` from:
- `create()` when `input.workspacePath` is provided.
- `update()` when `patch.workspacePath` is provided (covers the header changer).

This automatically captures both entry points without the frontend needing a
separate "remember" call.

### 3. Backend routes (`@anubis/backend`)

New `workspaceRoutes` (`src/workspaces.ts`), mounted at `/workspaces` in `app.ts`:

- `GET /workspaces` → `{ ok: true, items: KnownWorkspace[] }`.
- `DELETE /workspaces` with Zod-validated body `{ path: string }` → `{ ok: true }`.

Conversation creation already accepts `workspacePath` (`CreateBody` in
`conversation.ts`), so no change there.

Shared types: add `WorkspaceSummary` (`{ path; lastUsedAt }`) to `@anubis/shared`
for the frontend.

### 4. Electron main + preload

New IPC handler `anubis:pick-workspace` in `apps/desktop/electron/main/index.ts`,
mirroring `anubis:pick-skill-source`:

```ts
ipcMain.handle('anubis:pick-workspace', async () => {
  const result = win
    ? await dialog.showOpenDialog(win, { title: 'Select working directory',
        properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ /* same */ })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})
```

Exposed in `preload/index.ts` as
`window.anubis.workspace.pick(): Promise<string | null>`.
The renderer's `window.anubis` type declaration is updated accordingly.

### 5. Frontend (`@anubis/frontend`)

**API (`api.ts`):**
- `listWorkspaces(): Promise<WorkspaceSummary[]>`
- `removeWorkspace(path: string): Promise<void>`
- `createConversation` input already supports `workspacePath`; ensure it is passed.

**`useEnsureConversation`:** accept a `workspacePath?: string` argument and
forward it to `createConversation`.

**`WorkdirPicker` component** (`components/composer/workdir-picker.tsx`),
styled to match `ProfilePicker`:
- Trigger button shows a folder icon + the selected folder's basename (or
  "New temp folder" when none selected).
- Dropdown contents:
  - **New temp folder** — clears selection; conversation is created with no
    `workspacePath` so the backend auto-creates a scratch dir.
  - Saved workspaces (from `listWorkspaces()`), each showing basename + dim full
    path, with a ✕ on hover that calls `removeWorkspace` and refreshes the list.
  - **Browse…** — calls `window.anubis.workspace.pick()`; outside Electron falls
    back to `window.prompt`. The returned path becomes the selected value (and is
    added to the in-memory list so it shows immediately).
- Props: `value: string | null`, `onChange(path: string | null)`,
  `workspaces`, `onRefresh`, `disabled`.

**Composer wiring (`active-conversation.tsx`):**
- Lift workdir state into `ActiveConversationPage`: `pickedWorkdir`, and a
  `workspaces` list loaded via `listWorkspaces()` (a small `useWorkspaces` hook).
- Default selection: most recent saved workspace, else `null` (temp).
- For an existing conversation, the selected value reflects `conv.workspacePath`.
- Pass `pickedWorkdir` into `useEnsureConversation` so first send creates the
  conversation in that folder.
- Render `WorkdirPicker` in the composer controls row beside `ProfilePicker`
  and `ReasoningPicker`. Disabled while streaming.
- Replace the header pencil's `window.prompt` flow: the header keeps its
  read-only folder chip, and the pencil button now renders a `WorkdirPicker`
  (anchored at the header) instead of calling `window.prompt`. Choosing a folder
  for an existing conversation calls `updateConversation({ workspacePath })` and
  refreshes the local `conv` state. This makes the picker the single way to set a
  workdir in both the new-conversation and existing-conversation cases.

### Behavior summary

- New conversation: picker defaults to last-used folder; first message creates
  the conversation with that path, which records it (no-op if already present,
  just bumps recency).
- Browsing a brand-new folder: shows immediately as selected; joins the saved
  list once the conversation is created (or, for an existing conversation, as
  soon as the update persists).
- Temp-folder choice: no path sent; backend auto-creates; nothing recorded.
- Mid-conversation change via header: updates the conversation and records the
  folder, using the same picker UI.

## Testing

- `KnownWorkspacesRepo`: insert-then-list ordering by recency; `remember` on an
  existing path bumps `last_used_at` without duplicating; `remove` deletes.
- `ConversationService`: `create`/`update` with a real folder records it;
  with a path under `workspacesRoot` (or no path) records nothing.
- Backend route smoke: `GET /workspaces` returns recorded items; `DELETE`
  removes one.

## Integration points (files)

- `packages/conversation/src/db/migrations/006_known_workspaces.sql` (new)
- `packages/conversation/src/db/migrations/index.ts`
- `packages/conversation/src/db/repositories/known-workspaces-repo.ts` (new)
- `packages/conversation/src/conversations/conversation-service.ts`
- `packages/conversation/src/index.ts` (stack wiring + exports)
- `packages/backend/src/workspaces.ts` (new) + `app.ts` mount
- `packages/shared` — `WorkspaceSummary` type
- `apps/desktop/electron/main/index.ts`, `apps/desktop/electron/preload/index.ts`
- `packages/frontend/src/api.ts`
- `packages/frontend/src/lib/use-ensure-conversation.ts`
- `packages/frontend/src/components/composer/workdir-picker.tsx` (new)
- `packages/frontend/src/pages/active-conversation.tsx`
- renderer `window.anubis` type declaration
