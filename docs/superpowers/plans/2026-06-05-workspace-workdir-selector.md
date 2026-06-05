# Workspace/workdir Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose a working directory when creating a conversation, remember every chosen folder in the DB, and re-select remembered folders without browsing.

**Architecture:** A new `known_workspaces` table + `KnownWorkspacesRepo` persists real folders. `ConversationService` records a folder whenever a conversation is created/updated with a path outside the auto `workspacesRoot`. A backend `/workspaces` route lists/removes them. An Electron folder-picker IPC plus a reusable `WorkdirPicker` dropdown in the composer (and header) drive selection; new conversations default to the most recently used folder.

**Tech Stack:** TypeScript ESM monorepo (pnpm), better-sqlite3, Hono, Electron, React 19 + radix-ui Popover, Vitest.

---

## File Structure

- `packages/conversation/src/db/migrations/006_known_workspaces.sql` (new) — table DDL.
- `packages/conversation/src/db/migrations/index.ts` (modify) — register migration 6.
- `packages/conversation/src/db/repositories/known-workspaces-repo.ts` (new) — `KnownWorkspace` type + repo.
- `packages/conversation/tests/db/known-workspaces-repo.test.ts` (new) — repo tests.
- `packages/conversation/src/conversations/conversation-service.ts` (modify) — record on create/update.
- `packages/conversation/tests/conversations/conversation-service.test.ts` (modify) — pass new dep + recording tests.
- `packages/conversation/tests/conversations/conversation-service-await.test.ts` (modify) — pass new dep.
- `packages/conversation/src/index.ts` (modify) — wire repo into stack + export.
- `packages/shared/src/index.ts` (modify) — `WorkspaceSummary` type.
- `packages/backend/src/workspaces.ts` (new) — GET/DELETE routes.
- `packages/backend/src/app.ts` (modify) — mount `/workspaces`.
- `apps/desktop/electron/main/index.ts` (modify) — `anubis:pick-workspace` IPC.
- `apps/desktop/electron/preload/index.ts` (modify) — expose `workspace.pick`.
- `packages/frontend/src/vite-env.d.ts` (modify) — `window.anubis.workspace` type.
- `packages/frontend/src/api.ts` (modify) — `listWorkspaces`, `removeWorkspace`.
- `packages/frontend/src/lib/use-ensure-conversation.ts` (modify) — forward `workspacePath`.
- `packages/frontend/src/lib/use-workspaces.ts` (new) — list hook.
- `packages/frontend/src/components/composer/workdir-picker.tsx` (new) — dropdown.
- `packages/frontend/src/pages/active-conversation.tsx` (modify) — compose picker + header.

---

## Task 1: known_workspaces table + repo

**Files:**
- Create: `packages/conversation/src/db/migrations/006_known_workspaces.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Create: `packages/conversation/src/db/repositories/known-workspaces-repo.ts`
- Test: `packages/conversation/tests/db/known-workspaces-repo.test.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/conversation/src/db/migrations/006_known_workspaces.sql`:

```sql
CREATE TABLE known_workspaces (
  path         TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
```

- [ ] **Step 2: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, add a line to the `MIGRATIONS` array after the version-5 entry:

```ts
  load(5, '005_competitors_bio_level.sql'),
  load(6, '006_known_workspaces.sql'),
]
```

- [ ] **Step 3: Write the failing repo test**

Create `packages/conversation/tests/db/known-workspaces-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { KnownWorkspacesRepo } from '../../src/db/repositories/known-workspaces-repo.js'

function freshRepo() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return new KnownWorkspacesRepo(db)
}

describe('KnownWorkspacesRepo', () => {
  it('lists remembered paths most-recent first', () => {
    const repo = freshRepo()
    repo.remember('/a', 100)
    repo.remember('/b', 200)
    const items = repo.list()
    expect(items.map((w) => w.path)).toEqual(['/b', '/a'])
    expect(items[0]!.lastUsedAt).toBe(200)
  })

  it('remember on an existing path bumps recency without duplicating', () => {
    const repo = freshRepo()
    repo.remember('/a', 100)
    repo.remember('/b', 150)
    repo.remember('/a', 300)
    const items = repo.list()
    expect(items.map((w) => w.path)).toEqual(['/a', '/b'])
    expect(items.find((w) => w.path === '/a')!.lastUsedAt).toBe(300)
  })

  it('remove deletes a path', () => {
    const repo = freshRepo()
    repo.remember('/a', 100)
    repo.remember('/b', 200)
    repo.remove('/a')
    expect(repo.list().map((w) => w.path)).toEqual(['/b'])
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/known-workspaces-repo.test.ts`
Expected: FAIL — cannot resolve `known-workspaces-repo.js` (module missing).

- [ ] **Step 5: Implement the repo**

Create `packages/conversation/src/db/repositories/known-workspaces-repo.ts`:

```ts
import type { Db } from '../client.js'

export interface KnownWorkspace {
  path: string
  lastUsedAt: number
  createdAt: number
}

interface Row {
  path: string
  last_used_at: number
  created_at: number
}

function toWorkspace(r: Row): KnownWorkspace {
  return { path: r.path, lastUsedAt: r.last_used_at, createdAt: r.created_at }
}

export class KnownWorkspacesRepo {
  constructor(private db: Db) {}

  /** Insert a path on first sight, otherwise bump its last_used_at. */
  remember(path: string, now: number = Date.now()): void {
    this.db.prepare(`
      INSERT INTO known_workspaces (path, last_used_at, created_at)
      VALUES (@path, @now, @now)
      ON CONFLICT(path) DO UPDATE SET last_used_at = @now
    `).run({ path, now })
  }

  list(): KnownWorkspace[] {
    const rows = this.db.prepare(
      'SELECT * FROM known_workspaces ORDER BY last_used_at DESC',
    ).all() as Row[]
    return rows.map(toWorkspace)
  }

  remove(path: string): void {
    this.db.prepare('DELETE FROM known_workspaces WHERE path = ?').run(path)
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/known-workspaces-repo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/migrations/006_known_workspaces.sql \
        packages/conversation/src/db/migrations/index.ts \
        packages/conversation/src/db/repositories/known-workspaces-repo.ts \
        packages/conversation/tests/db/known-workspaces-repo.test.ts
git commit -m "feat(conversation): known_workspaces table and repo"
```

---

## Task 2: ConversationService records chosen workspaces

**Files:**
- Modify: `packages/conversation/src/conversations/conversation-service.ts`
- Modify: `packages/conversation/tests/conversations/conversation-service.test.ts`
- Modify: `packages/conversation/tests/conversations/conversation-service-await.test.ts`

- [ ] **Step 1: Write the failing recording test**

In `packages/conversation/tests/conversations/conversation-service.test.ts`, add the import near the other repo imports at the top:

```ts
import { KnownWorkspacesRepo } from '../../src/db/repositories/known-workspaces-repo.js'
```

The file's existing `setup()` helper already returns `{ svc, db, workspacesRoot, ... }` and already imports `mkdtempSync`, `tmpdir`, and `join`. Add this test inside the existing `describe('ConversationService', ...)` block. It creates a conversation with an explicit real folder and asserts it is recorded, and that an auto/temp workspace is NOT recorded:

```ts
it('records an explicitly chosen workspace but not an auto temp dir', () => {
  const { svc, db, workspacesRoot } = setup()
  const real = mkdtempSync(join(tmpdir(), 'anubis-real-ws-'))
  // Explicit real folder → recorded.
  svc.create({ title: 't', profileId: 'claude-coding', workspacePath: real })
  // No workspacePath → backend auto-creates one under workspacesRoot → NOT recorded.
  svc.create({ title: 't2', profileId: 'claude-coding' })
  const known = new KnownWorkspacesRepo(db).list().map((w) => w.path)
  expect(known).toContain(real)
  expect(known.some((p) => p.startsWith(workspacesRoot))).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/conversations/conversation-service.test.ts`
Expected: FAIL — either a TypeScript error that `knownWorkspaces` is missing from deps, or the assertion fails because nothing is recorded yet.

- [ ] **Step 3: Add the dependency and recording logic**

In `packages/conversation/src/conversations/conversation-service.ts`:

(a) Add the path import at the top (the file already imports `join` from `node:path`):

```ts
import { join, relative, isAbsolute } from 'node:path'
```

(b) Add the import for the repo type near the other repo imports:

```ts
import type { KnownWorkspacesRepo } from '../db/repositories/known-workspaces-repo.js'
```

(c) Add to `ConversationServiceDeps`:

```ts
  conversations: ConversationsRepo
  messages: MessagesRepo
  artifacts: ArtifactsRepo
  sessions: AgentSessionsRepo
  knownWorkspaces: KnownWorkspacesRepo
```

(d) Add a private helper method to the `ConversationService` class (place it next to `resolveOrThrow`):

```ts
  /**
   * Remember a user-chosen workspace so it can be re-selected later. Skips
   * the throwaway per-conversation scratch dirs the service auto-creates
   * under `workspacesRoot` — only real folders the user picked are kept.
   */
  private rememberWorkspace(path: string): void {
    const rel = relative(this.deps.workspacesRoot, path)
    const isScratch = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    if (isScratch) return
    this.deps.knownWorkspaces.remember(path)
  }
```

(e) In `create()`, after the conversation row is inserted (after `this.deps.conversations.insert(conv)`), record an explicitly provided path:

```ts
    this.deps.conversations.insert(conv)
    if (input.workspacePath) this.rememberWorkspace(input.workspacePath)
    if (input.profileId) this.deps.profiles.touchLastUsed(input.profileId)
```

(f) In `update()`, after `this.deps.conversations.updateFields(...)`, record a newly set path:

```ts
    this.deps.conversations.updateFields(id, {
      title: patch.title,
      extra,
      profileId: patch.profileId === undefined ? undefined : patch.profileId,
      workspacePath,
    })
    if (workspacePath) this.rememberWorkspace(workspacePath)
    return this.deps.conversations.findById(id)!
```

- [ ] **Step 4: Fix the existing test constructors**

Both service test files build `new ConversationService({ ... })` directly and will now fail to typecheck because `knownWorkspaces` is required.

In `packages/conversation/tests/conversations/conversation-service-await.test.ts`, add the import:

```ts
import { KnownWorkspacesRepo } from '../../src/db/repositories/known-workspaces-repo.js'
```

and add the dependency to the `new ConversationService({ ... })` literal (next to `sessions: new AgentSessionsRepo(db),`):

```ts
    sessions: new AgentSessionsRepo(db),
    knownWorkspaces: new KnownWorkspacesRepo(db),
```

In `packages/conversation/tests/conversations/conversation-service.test.ts`, add the same dependency inside the shared `setup()` helper's `new ConversationService({ ... })` literal (next to `sessions: new AgentSessionsRepo(db),`):

```ts
    sessions: new AgentSessionsRepo(db),
    knownWorkspaces: new KnownWorkspacesRepo(db),
```

(The `KnownWorkspacesRepo` import was already added in Task 2 Step 1. `setup()` already returns `db` and `workspacesRoot`, so no change to its return is needed.)

- [ ] **Step 5: Run the conversation tests to verify they pass**

Run: `pnpm vitest run packages/conversation/tests/conversations`
Expected: PASS (all conversation-service + await + task-manager + stream-relay tests green, including the new recording test).

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/conversations/conversation-service.ts \
        packages/conversation/tests/conversations/conversation-service.test.ts \
        packages/conversation/tests/conversations/conversation-service-await.test.ts
git commit -m "feat(conversation): record chosen workspaces on create/update"
```

---

## Task 3: Wire repo into the stack and export it

**Files:**
- Modify: `packages/conversation/src/index.ts`

- [ ] **Step 1: Import and construct the repo**

In `packages/conversation/src/index.ts`, add the import next to the other repo imports:

```ts
import { KnownWorkspacesRepo } from './db/repositories/known-workspaces-repo.js'
```

Construct it next to the other repos (after `const cronRepo = new CronJobsRepo(db)`):

```ts
  const cronRepo = new CronJobsRepo(db)
  const knownWorkspacesRepo = new KnownWorkspacesRepo(db)
```

- [ ] **Step 2: Pass it to the ConversationService**

Add to the `new ConversationService({ ... })` deps literal (next to `sessions: sessionsRepo,`):

```ts
    sessions: sessionsRepo,
    knownWorkspaces: knownWorkspacesRepo,
```

- [ ] **Step 3: Expose it on the stack**

Add to the `ConversationStack` interface:

```ts
  taskManager: TaskManager
  aiAgent: AiAgentService
  knownWorkspaces: KnownWorkspacesRepo
```

Add it to the returned object (next to `taskManager: tm, aiAgent,`):

```ts
    appConfig, skills, sse, cron, taskManager: tm, aiAgent,
    knownWorkspaces: knownWorkspacesRepo,
```

- [ ] **Step 4: Export the repo type**

Add near the other repo re-exports at the bottom of the file:

```ts
export type { KnownWorkspace } from './db/repositories/known-workspaces-repo.js'
export { KnownWorkspacesRepo } from './db/repositories/known-workspaces-repo.js'
```

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @anubis/conversation typecheck`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/index.ts
git commit -m "feat(conversation): expose knownWorkspaces on the stack"
```

---

## Task 4: Shared WorkspaceSummary type

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the type**

In `packages/shared/src/index.ts`, add near `CreateConversationInput`:

```ts
export interface WorkspaceSummary {
  /** Absolute path to a previously used working directory. */
  path: string
  /** Epoch ms of the last time a conversation used this folder. */
  lastUsedAt: number
}
```

Add a list response alias next to the other `ListResponse` aliases:

```ts
export type WorkspaceListResponse = ListResponse<WorkspaceSummary>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/shared typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): WorkspaceSummary type"
```

---

## Task 5: Backend /workspaces routes

**Files:**
- Create: `packages/backend/src/workspaces.ts`
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Write the route module**

Create `packages/backend/src/workspaces.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { WorkspaceSummary } from '@anubis/shared'
import { getStack } from './services.js'

const RemoveBody = z.object({ path: z.string().min(1) }).strict()

export const workspaceRoutes = new Hono()

workspaceRoutes.get('/', (c) => {
  const items: WorkspaceSummary[] = getStack().knownWorkspaces.list().map((w) => ({
    path: w.path,
    lastUsedAt: w.lastUsedAt,
  }))
  return c.json({ ok: true, items })
})

workspaceRoutes.delete('/', async (c) => {
  const body = RemoveBody.parse(await c.req.json())
  getStack().knownWorkspaces.remove(body.path)
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Mount the routes**

In `packages/backend/src/app.ts`, add the import next to the other route imports:

```ts
import { workflowRoutes } from './workflow.js'
import { workspaceRoutes } from './workspaces.js'
```

Mount it next to the other `app.route(...)` calls:

```ts
app.route('/workflows', workflowRoutes)
app.route('/workspaces', workspaceRoutes)
```

- [ ] **Step 3: Typecheck the backend**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/workspaces.ts packages/backend/src/app.ts
git commit -m "feat(backend): GET/DELETE /workspaces routes"
```

---

## Task 6: Electron folder picker IPC + preload

**Files:**
- Modify: `apps/desktop/electron/main/index.ts`
- Modify: `apps/desktop/electron/preload/index.ts`
- Modify: `packages/frontend/src/vite-env.d.ts`

- [ ] **Step 1: Add the IPC handler**

In `apps/desktop/electron/main/index.ts`, add after the `anubis:pick-skill-source` handler (which ends near line 64). Reuse the already-imported `dialog`, `win`:

```ts
// Native picker for a conversation working directory. Returns the selected
// absolute path, or null on cancel.
ipcMain.handle('anubis:pick-workspace', async () => {
  const options: Electron.OpenDialogOptions = {
    title: 'Select working directory',
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})
```

- [ ] **Step 2: Expose it in preload**

In `apps/desktop/electron/preload/index.ts`, add a `workspace` block to the `contextBridge.exposeInMainWorld('anubis', { ... })` object, next to `skills`:

```ts
  skills: {
    pickSource: (kind: 'folder' | 'zip') =>
      ipcRenderer.invoke('anubis:pick-skill-source', kind) as Promise<string | null>,
  },
  workspace: {
    /** Open a native folder picker. Resolves to the selected absolute path,
     *  or null if the user cancels. */
    pick: () => ipcRenderer.invoke('anubis:pick-workspace') as Promise<string | null>,
  },
```

- [ ] **Step 3: Add the renderer type**

In `packages/frontend/src/vite-env.d.ts`, add a `workspace` member to the `anubis?` interface, next to `skills`:

```ts
    skills: {
      /** Resolves to the selected absolute path, or null if cancelled. */
      pickSource(kind: 'folder' | 'zip'): Promise<string | null>
    }
    workspace: {
      /** Resolves to the selected absolute path, or null if cancelled. */
      pick(): Promise<string | null>
    }
```

- [ ] **Step 4: Typecheck desktop + frontend**

Run: `pnpm --filter @anubis/frontend typecheck && pnpm --filter desktop typecheck`
Expected: clean. (If the desktop package name differs, run `pnpm -r --if-present typecheck` and confirm no new errors.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/index.ts apps/desktop/electron/preload/index.ts packages/frontend/src/vite-env.d.ts
git commit -m "feat(desktop): native workspace folder picker IPC"
```

---

## Task 7: Frontend API helpers

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Add the API functions**

In `packages/frontend/src/api.ts`, add (near the conversation helpers). Import `WorkspaceSummary` from `@anubis/shared` in the existing type import block at the top of the file:

```ts
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const r = await api<{ ok: true; items: WorkspaceSummary[] }>('/workspaces')
  return r.items
}

export async function removeWorkspace(path: string): Promise<void> {
  await api<{ ok: true }>('/workspaces', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: clean (the functions are unused for now, which is fine — they are exported).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): listWorkspaces/removeWorkspace api"
```

---

## Task 8: useWorkspaces hook

**Files:**
- Create: `packages/frontend/src/lib/use-workspaces.ts`

- [ ] **Step 1: Implement the hook**

Create `packages/frontend/src/lib/use-workspaces.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceSummary } from '@anubis/shared'
import { listWorkspaces, removeWorkspace } from '@/api'

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])

  const refetch = useCallback(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => {})
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const remove = useCallback(
    async (path: string) => {
      try { await removeWorkspace(path) } catch { /* ignore */ }
      setWorkspaces((prev) => prev.filter((w) => w.path !== path))
    },
    [],
  )

  return { workspaces, refetch, remove }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/lib/use-workspaces.ts
git commit -m "feat(frontend): useWorkspaces hook"
```

---

## Task 9: WorkdirPicker component

**Files:**
- Create: `packages/frontend/src/components/composer/workdir-picker.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/frontend/src/components/composer/workdir-picker.tsx`. It mirrors `ProfilePicker`'s radix Popover structure. `value === null` means "new temp folder".

```tsx
import { useState } from 'react'
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, XIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { WorkspaceSummary } from '@anubis/shared'
import { cn } from '@/lib/utils'

interface WorkdirPickerProps {
  /** Selected absolute path, or null for "new temp folder". */
  value: string | null
  onChange: (path: string | null) => void
  workspaces: WorkspaceSummary[]
  onRemove: (path: string) => void
  /** Called after a new folder is browsed, so the list can refresh. */
  onBrowsed?: (path: string) => void
  disabled?: boolean
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

async function pickFolder(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.anubis?.workspace) {
    return window.anubis.workspace.pick()
  }
  // Browser dev fallback: no native dialog available.
  const typed = window.prompt('Working directory (absolute path):')
  return typed && typed.trim() ? typed.trim() : null
}

export function WorkdirPicker({
  value, onChange, workspaces, onRemove, onBrowsed, disabled,
}: WorkdirPickerProps) {
  const [open, setOpen] = useState(false)
  const label = value ? basename(value) : 'New temp folder'

  async function onBrowse() {
    const picked = await pickFolder()
    if (!picked) return
    onChange(picked)
    onBrowsed?.(picked)
    setOpen(false)
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          title={value ?? 'New temp folder'}
          className={cn(
            'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 font-mono text-[12px] text-foreground',
            disabled && 'cursor-not-allowed opacity-60',
            !disabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
          aria-haspopup='listbox'
          aria-expanded={open}
        >
          <FolderIcon className='size-3 text-[var(--anubis-gold)]' strokeWidth={2} />
          <span className='truncate'>{label}</span>
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[320px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          <button
            type='button'
            onClick={() => { onChange(null); setOpen(false) }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
              value === null ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
            )}
          >
            <FolderPlusIcon className='size-3.5 text-muted-foreground' strokeWidth={2} />
            <span className='min-w-0 flex-1 truncate'>New temp folder</span>
          </button>

          {workspaces.length > 0 && (
            <div className='py-1'>
              <div className='px-2 pb-1 pt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/70'>
                Recent
              </div>
              {workspaces.map((w) => {
                const selected = w.path === value
                return (
                  <div
                    key={w.path}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                      selected ? 'bg-muted' : 'hover:bg-muted/70',
                    )}
                  >
                    <button
                      type='button'
                      onClick={() => { onChange(w.path); setOpen(false) }}
                      className='flex min-w-0 flex-1 flex-col items-start'
                    >
                      <span className='w-full truncate text-foreground'>{basename(w.path)}</span>
                      <span className='w-full truncate font-mono text-[10.5px] text-muted-foreground'>{w.path}</span>
                    </button>
                    <button
                      type='button'
                      aria-label='Forget this folder'
                      onClick={(e) => { e.stopPropagation(); onRemove(w.path) }}
                      className='flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100'
                    >
                      <XIcon className='size-3' strokeWidth={2} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <button
            type='button'
            onClick={() => void onBrowse()}
            className='mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-muted/70'
          >
            <FolderIcon className='size-3.5 text-muted-foreground' strokeWidth={2} />
            <span>Browse…</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: clean. (Confirm `lucide-react` exports `FolderPlusIcon`; it does.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/composer/workdir-picker.tsx
git commit -m "feat(frontend): WorkdirPicker dropdown component"
```

---

## Task 10: Wire the picker into the conversation page

**Files:**
- Modify: `packages/frontend/src/lib/use-ensure-conversation.ts`
- Modify: `packages/frontend/src/pages/active-conversation.tsx`

- [ ] **Step 1: Forward workspacePath through useEnsureConversation**

In `packages/frontend/src/lib/use-ensure-conversation.ts`, add a `workspacePath` parameter and include it in the create call.

Change the signature:

```ts
export function useEnsureConversation(
  conversationId: string | undefined,
  selectedProfile: ProfileSummary | null,
  effort: ReasoningEffort,
  profileDefaultEffort: ReasoningEffort,
  workspacePath: string | null,
): EnsureState {
```

In the `createConversation({ ... })` call, add the path when set:

```ts
        const created = await createConversation({
          title: deriveTitle(firstContent),
          profileId: selectedProfile.id,
          agent: selectedProfile.config.agent,
          ...(workspacePath ? { workspacePath } : {}),
          ...(override ? { override } : {}),
        })
```

Add `workspacePath` to the `useCallback` dependency array:

```ts
    [conversationId, selectedProfile, effort, profileDefaultEffort, workspacePath],
```

- [ ] **Step 2: Add workspace state + handler in ActiveConversationPage**

In `packages/frontend/src/pages/active-conversation.tsx`:

(a) Add imports:

```ts
import { useWorkspaces } from '@/lib/use-workspaces'
import { WorkdirPicker } from '@/components/composer/workdir-picker'
```

(b) Inside `ActiveConversationPage`, near the other `useState` calls, add:

```ts
  const { workspaces, refetch: refetchWorkspaces, remove: removeWorkspace } = useWorkspaces()
  const [pickedWorkdir, setPickedWorkdir] = useState<string | null>(null)
```

(c) Default the picked workdir to the most-recent saved folder for a NEW conversation, once workspaces load. Add this effect (only applies when there is no conversationId yet, and only seeds once while still null):

```ts
  useEffect(() => {
    if (conversationId) return
    if (pickedWorkdir !== null) return
    if (workspaces.length > 0) setPickedWorkdir(workspaces[0]!.path)
  }, [conversationId, workspaces, pickedWorkdir])
```

(d) Compute the value the picker shows and a single change handler. For an existing conversation the value is the conversation's folder and changes persist; for a new one it is local state:

```ts
  const selectedWorkdir: string | null = conversationId
    ? conv?.workspacePath ?? null
    : pickedWorkdir

  const onWorkdirChange = useCallback(async (path: string | null) => {
    if (!conversationId) { setPickedWorkdir(path); return }
    // Existing conversation: "new temp folder" (null) is not meaningful — only
    // persist a concrete folder.
    if (!path) return
    try {
      const updated = await updateConversation(conversationId, { workspacePath: path })
      setConv(updated)
      refetchWorkspaces()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, refetchWorkspaces])
```

(e) Update the `useEnsureConversation` call to pass the workdir:

```ts
  const { ensure } = useEnsureConversation(
    conversationId, selectedProfile, effectiveEffort, profileDefaultEffort, selectedWorkdir,
  )
```

(f) After a successful send creates a new conversation, refresh the saved list so the just-used folder appears. In `onSend`, after the navigate line, add a refetch (only meaningful when a real folder was used):

```ts
      if (id !== conversationId) {
        refetchWorkspaces()
        navigate({ page: 'active-conversation', conversationId: id })
      }
```

Add `refetchWorkspaces` to `onSend`'s dependency array.

- [ ] **Step 3: Render the picker in the composer controls row**

Pass the picker down to `Composer` via new props. In the `<Composer ... />` JSX, add:

```tsx
        availability={catalog?.agentAvailability}
        workspaces={workspaces}
        selectedWorkdir={selectedWorkdir}
        onWorkdirChange={(p) => void onWorkdirChange(p)}
        onWorkdirRemove={(p) => void removeWorkspace(p)}
        onWorkdirBrowsed={refetchWorkspaces}
        pendingQuote={pendingQuote}
```

In the `Composer` function signature/props type, add:

```ts
  availability?: Record<'claude' | 'codex', AgentAvailability>
  workspaces: WorkspaceSummary[]
  selectedWorkdir: string | null
  onWorkdirChange: (path: string | null) => void
  onWorkdirRemove: (path: string) => void
  onWorkdirBrowsed: () => void
  pendingQuote?: string | null
```

Import the type at the top of the file:

```ts
import type { AgentAvailability, ConversationSummary, MessageSummary, ProfileSummary, WorkspaceSummary } from '@anubis/shared'
```

Destructure the new props in `Composer({ ... })` and render the picker in the controls row right after `ReasoningPicker`:

```tsx
          <ReasoningPicker
            efforts={efforts}
            value={effort}
            isOverride={effortIsOverride}
            onChange={onEffortChange}
            disabled={streaming}
          />
          <WorkdirPicker
            value={selectedWorkdir}
            onChange={onWorkdirChange}
            workspaces={workspaces}
            onRemove={onWorkdirRemove}
            onBrowsed={onWorkdirBrowsed}
            disabled={streaming}
          />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/use-ensure-conversation.ts packages/frontend/src/pages/active-conversation.tsx
git commit -m "feat(frontend): workdir picker in the conversation composer"
```

---

## Task 11: Replace the header pencil prompt with the picker

**Files:**
- Modify: `packages/frontend/src/pages/active-conversation.tsx`

- [ ] **Step 1: Swap the header changer for the picker**

In the header block, the current folder chip renders a pencil button calling `onChangeWorkdir` (a `window.prompt`). Replace that pencil button with a `WorkdirPicker` that reuses the same `onWorkdirChange` handler and saved list. Find the `<button ... onClick={() => void onChangeWorkdir()} ...>` with the `PencilIcon` inside the workspace chip and replace that button element with:

```tsx
                  <WorkdirPicker
                    value={conv.workspacePath}
                    onChange={(p) => void onWorkdirChange(p)}
                    workspaces={workspaces}
                    onRemove={(p) => void removeWorkspace(p)}
                    onBrowsed={refetchWorkspaces}
                  />
```

- [ ] **Step 2: Remove the now-dead onChangeWorkdir**

Delete the `onChangeWorkdir` `useCallback` (the `window.prompt`-based handler) since nothing references it anymore. Leave `onOpenWorkdir` (the "open in file manager" button) untouched.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: clean (no "unused PencilIcon" — if `PencilIcon` is now unused, remove it from the `lucide-react` import line).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/active-conversation.tsx
git commit -m "feat(frontend): header workdir changer uses the picker"
```

---

## Task 12: Full verification

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: all 9 projects pass.

- [ ] **Step 2: Run the full test suite for touched packages**

Run: `pnpm vitest run packages/conversation packages/backend`
Expected: all green (includes the new repo + recording tests).

- [ ] **Step 3: Build the load-bearing packages**

Run: `pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: both succeed (migrations copied to dist).

- [ ] **Step 4: Manual smoke (real app)**

Run: `pnpm dev`
Verify:
- New conversation: a folder picker sits in the composer row; it defaults to the most-recent saved folder (or "New temp folder" on a fresh install).
- "Browse…" opens a native OS folder dialog; the chosen folder becomes selected.
- Send the first message; the conversation starts in that folder; reopening the picker shows that folder under "Recent".
- The header folder chip's picker changes the folder for an existing conversation and persists across reload.
- The ✕ on a Recent entry forgets it.

- [ ] **Step 5: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "chore: workspace selector verification fixes"
```

(Skip if nothing changed in Step 4.)
