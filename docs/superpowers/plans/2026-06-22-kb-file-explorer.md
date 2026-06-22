# Knowledge Base File Explorer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Knowledge Base page with a two-pane file explorer + markdown viewer/editor (full create/edit/delete of `.md` files under the project's `knowledge/` dir), keep search + re-ingest, and remove leftover graph artifacts.

**Architecture:** Reuse the existing `knowledge-base` route slot and rewrite the page in place. Add two read endpoints (`GET /tree`, `GET /read`) backed by two new `@anubis/knowledge-lite` engine methods (`listFiles`, `readFile`); create/edit/delete reuse the existing `/save /update /delete` routes (which already auto-reindex). The page is split into small `components/knowledge/` pieces. Markdown renders with the already-present `streamdown`.

**Tech Stack:** TypeScript (ESM), `@anubis/knowledge-lite` (better-sqlite3 engine), Hono + Zod (backend), React 19 + Vite + Tailwind v4 + shadcn/ui + `streamdown` (frontend), vitest (+ jsdom/testing-library for frontend).

**Build order (load-bearing for tests — vitest resolves `@anubis/*` to `dist`):** `knowledge-lite` → `shared` → `backend` → `frontend`. Rebuild a changed package before testing a downstream one.

**Commit policy:** This repo's owner works on local `main` and asks not to push. Treat each task's commit step as a checkpoint — commit on `main` when the owner confirms; **never push**. If `git` is needed, confirm first.

**Heads-up (better-sqlite3 ABI):** If backend/engine tests fail with `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch, run `pnpm rebuild better-sqlite3` — that is environment drift, not a regression.

---

## Task 1: Engine — `listFiles()` + `readFile()` (`@anubis/knowledge-lite`)

**Files:**
- Test: `packages/knowledge-lite/src/files-api.test.ts` (create)
- Modify: `packages/knowledge-lite/src/index.ts` (interface + implementation + imports)

- [ ] **Step 1: Write the failing test**

Create `packages/knowledge-lite/src/files-api.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngine } from './index.js'
import { ValidationError } from './types.js'

let sourceRoot: string; let dbPath: string
beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'kl-files-'))
  sourceRoot = join(tmp, 'knowledge')
  dbPath = join(tmp, 'db', 'index.db')
  mkdirSync(sourceRoot, { recursive: true })
})
afterEach(() => { rmSync(join(sourceRoot, '..'), { recursive: true, force: true }) })

describe('listFiles', () => {
  it('returns every markdown file on disk, including un-ingested ones', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    mkdirSync(join(sourceRoot, 'brand'), { recursive: true })
    writeFileSync(join(sourceRoot, 'brand', 'voice.md'), '# Voice\n\nwarm\n', 'utf8')
    writeFileSync(join(sourceRoot, 'root.md'), '# Root\n\ntext\n', 'utf8')
    // deliberately never call ingest()
    const { items } = engine.listFiles()
    const paths = items.map((i) => i.path)
    expect(paths).toContain('brand/voice.md')
    expect(paths).toContain('root.md')
    const voice = items.find((i) => i.path === 'brand/voice.md')!
    expect(voice.size).toBeGreaterThan(0)
    expect(typeof voice.updatedAt).toBe('string')
  })

  it('returns an empty list when the corpus is empty', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    expect(engine.listFiles().items).toEqual([])
  })
})

describe('readFile', () => {
  it('returns the raw content of an existing markdown file', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'brand/voice.md', content: '# Voice\n\nwarm confident\n' })
    const out = engine.readFile({ path: 'brand/voice.md' })
    expect(out.path).toBe('brand/voice.md')
    expect(out.content).toContain('warm confident')
  })

  it('throws ValidationError for a missing file', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    expect(() => engine.readFile({ path: 'nope.md' })).toThrow(ValidationError)
  })

  it('rejects path traversal and non-markdown paths', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    expect(() => engine.readFile({ path: '../escape.md' })).toThrow(ValidationError)
    expect(() => engine.readFile({ path: 'notes.txt' })).toThrow(ValidationError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test src/files-api.test.ts`
Expected: FAIL — `engine.listFiles is not a function` / `engine.readFile is not a function`.

- [ ] **Step 3: Implement the engine methods**

In `packages/knowledge-lite/src/index.ts`:

(a) Update the `node:fs` import (line 1) to add `statSync`:

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
```

(b) Add an import from `./fs.js` (the file has no `./fs.js` import yet) right after the `./paths.js` import (line 10):

```ts
import { scanMarkdownFiles, toSourcePath } from './fs.js'
```

(c) Add two methods to the `KnowledgeEngine` interface (after the `listDocuments(...)` line ~31):

```ts
  listFiles(): { items: Array<{ path: string; size: number; updatedAt: string }> }
  readFile(opts: { path: string }): { path: string; content: string }
```

(d) Add their implementations to the returned object, right after the `listDocuments() { ... }` block (before the final closing `}` of the returned object):

```ts
    listFiles() {
      mkdirSync(sourceRoot, { recursive: true })
      const items = scanMarkdownFiles(sourceRoot).map((abs) => {
        const st = statSync(abs)
        return { path: toSourcePath(sourceRoot, abs), size: st.size, updatedAt: st.mtime.toISOString() }
      })
      return { items }
    },

    readFile(opts) {
      const target = resolveTargetPath(sourceRoot, opts.path)
      if (!existsSync(target)) throw new ValidationError('target does not exist')
      return { path: toSourcePath(sourceRoot, target), content: readFileSync(target, 'utf8') }
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test src/files-api.test.ts`
Expected: PASS (6 assertions across 5 tests).

- [ ] **Step 5: Build the package so downstream packages see the new methods**

Run: `pnpm --filter @anubis/knowledge-lite build`
Expected: tsc completes with no errors; `dist/index.js` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-lite/src/index.ts packages/knowledge-lite/src/files-api.test.ts
git commit -m "feat(knowledge-lite): add listFiles + readFile engine methods"
```

---

## Task 2: Shared types (`@anubis/shared`)

**Files:**
- Modify: `packages/shared/src/index.ts` (add two interfaces after `KnowledgeBaseSearchResponse`, ~line 460)

- [ ] **Step 1: Add the types**

In `packages/shared/src/index.ts`, immediately after the `KnowledgeBaseSearchResponse` interface (before the `/* === Extractor === */` comment), add:

```ts
export interface KnowledgeBaseFileEntry {
  path: string
  size: number
  updatedAt: string
}

export interface KnowledgeBaseFileContent {
  path: string
  content: string
}
```

- [ ] **Step 2: Build shared so backend + frontend resolve the new types**

Run: `pnpm --filter @anubis/shared build`
Expected: tsc completes, `dist` updated.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add KnowledgeBaseFileEntry + KnowledgeBaseFileContent types"
```

---

## Task 3: Backend routes — `GET /tree` + `GET /read`

**Files:**
- Modify: `packages/backend/src/knowledge-base.ts` (add `ReadQuery` schema + two routes)
- Test: `packages/backend/tests/knowledge-base.test.ts` (add two cases)

- [ ] **Step 1: Write the failing tests**

In `packages/backend/tests/knowledge-base.test.ts`, add these two `it` blocks inside the existing `describe('knowledge-base routes', () => { ... })`:

```ts
  it('tree lists markdown files on disk and read returns content', async () => {
    const app = await loadApp()
    const projectId = 'default'

    await app.request('/knowledge-base/save', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, path: 'guides/setup.md', content: '# Setup\n\nstep one\n' }),
    })

    const treeRes = await app.request(`/knowledge-base/tree?projectId=${projectId}`)
    expect(treeRes.status).toBe(200)
    const treeBody = await treeRes.json() as {
      ok: boolean; items: Array<{ path: string; size: number; updatedAt: string }>
    }
    expect(treeBody.ok).toBe(true)
    expect(treeBody.items.some((i) => i.path === 'guides/setup.md')).toBe(true)

    const readRes = await app.request(
      `/knowledge-base/read?projectId=${projectId}&path=${encodeURIComponent('guides/setup.md')}`,
    )
    expect(readRes.status).toBe(200)
    const readBody = await readRes.json() as { ok: boolean; path: string; content: string }
    expect(readBody.ok).toBe(true)
    expect(readBody.path).toBe('guides/setup.md')
    expect(readBody.content).toContain('step one')
  })

  it('read rejects path traversal with 400', async () => {
    const app = await loadApp()
    const projectId = 'default'
    const res = await app.request(
      `/knowledge-base/read?projectId=${projectId}&path=${encodeURIComponent('../escape.md')}`,
    )
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @anubis/backend test tests/knowledge-base.test.ts`
Expected: FAIL — `/tree` and `/read` return 404 (routes not registered yet).

- [ ] **Step 3: Implement the routes**

In `packages/backend/src/knowledge-base.ts`, add a query schema right after the `ProjectQuery` definition (~line 84):

```ts
const ReadQuery = z.object({ projectId: z.string().min(1), path: z.string().min(1) })
```

Then add these two routes after the existing `/documents` route (end of file, ~line 128):

```ts
knowledgeBaseRoutes.get('/tree', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).listFiles())
  return c.json({ ok: true, items: out.items })
})

knowledgeBaseRoutes.get('/read', async (c) => {
  const { projectId, path } = ReadQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).readFile({ path }))
  return c.json({ ok: true, path: out.path, content: out.content })
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @anubis/backend test tests/knowledge-base.test.ts`
Expected: PASS (all cases, old + new). If `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3` then retry.

- [ ] **Step 5: Build backend**

Run: `pnpm --filter @anubis/backend build`
Expected: tsc completes, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/knowledge-base.ts packages/backend/tests/knowledge-base.test.ts
git commit -m "feat(backend): add knowledge-base /tree and /read routes"
```

---

## Task 4: Frontend API wrappers (`packages/frontend/src/api.ts`)

**Files:**
- Modify: `packages/frontend/src/api.ts` (extend the `@anubis/shared` import; add 5 functions)

- [ ] **Step 1: Import the new shared types**

In `packages/frontend/src/api.ts`, find the existing `import type { ... } from '@anubis/shared'` block (it already lists `KnowledgeBaseDocument`, `KnowledgeBaseSearchHit`, `KnowledgeBaseStats`). Add the two new names to it:

```ts
  KnowledgeBaseFileEntry,
  KnowledgeBaseFileContent,
```

- [ ] **Step 2: Add the wrapper functions**

In `packages/frontend/src/api.ts`, directly after `listKnowledgeBaseDocuments` (~line 1427, end of the `/* ---------- Knowledge Base ---------- */` section), add:

```ts
export async function getKnowledgeBaseTree(projectId: string): Promise<KnowledgeBaseFileEntry[]> {
  const params = new URLSearchParams({ projectId })
  const r = await api<{ ok: true; items: KnowledgeBaseFileEntry[] }>(`/knowledge-base/tree?${params}`)
  return r.items
}

export async function readKnowledgeBaseFile(projectId: string, path: string): Promise<KnowledgeBaseFileContent> {
  const params = new URLSearchParams({ projectId, path })
  const r = await api<{ ok: true; path: string; content: string }>(`/knowledge-base/read?${params}`)
  return { path: r.path, content: r.content }
}

export async function saveKnowledgeBaseFile(input: {
  projectId: string; path: string; content: string; force?: boolean
}): Promise<{ path: string }> {
  const r = await api<{ ok: true; path: string }>('/knowledge-base/save', {
    method: 'POST', body: JSON.stringify(input),
  })
  return { path: r.path }
}

export async function updateKnowledgeBaseFile(input: {
  projectId: string; path: string; content: string
}): Promise<{ path: string }> {
  const r = await api<{ ok: true; path: string }>('/knowledge-base/update', {
    method: 'POST', body: JSON.stringify(input),
  })
  return { path: r.path }
}

export async function deleteKnowledgeBaseFile(input: {
  projectId: string; path: string
}): Promise<{ path: string }> {
  const r = await api<{ ok: true; path: string }>('/knowledge-base/delete', {
    method: 'POST', body: JSON.stringify(input),
  })
  return { path: r.path }
}
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (no errors). (The Vite build does **not** catch type errors — always run this.)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): add knowledge-base tree/read/save/update/delete api wrappers"
```

---

## Task 5: File tree component + `buildKnowledgeTree` helper

**Files:**
- Create: `packages/frontend/src/components/knowledge/file-tree.tsx`
- Test: `packages/frontend/tests/components/knowledge-file-tree.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/knowledge-file-tree.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { buildKnowledgeTree, KnowledgeFileTree } from '@/components/knowledge/file-tree'

const entries = [
  { path: 'root.md', size: 10, updatedAt: '2026-06-22T00:00:00Z' },
  { path: 'brand/voice.md', size: 20, updatedAt: '2026-06-22T00:00:00Z' },
  { path: 'brand/offer.md', size: 30, updatedAt: '2026-06-22T00:00:00Z' },
]

describe('buildKnowledgeTree', () => {
  it('nests files under folders, folders before files, each sorted', () => {
    const tree = buildKnowledgeTree(entries)
    expect(tree[0].kind).toBe('folder')
    expect(tree[0].name).toBe('brand')
    if (tree[0].kind === 'folder') {
      expect(tree[0].children.map((c) => c.name)).toEqual(['offer.md', 'voice.md'])
    }
    expect(tree[1].kind).toBe('file')
    expect(tree[1].name).toBe('root.md')
  })
})

describe('KnowledgeFileTree', () => {
  it('calls onSelect with the path when a file is clicked', () => {
    const onSelect = vi.fn()
    render(<KnowledgeFileTree entries={entries} selectedPath={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('root.md'))
    expect(onSelect).toHaveBeenCalledWith('root.md')
  })

  it('shows an empty message when there are no files', () => {
    render(<KnowledgeFileTree entries={[]} selectedPath={null} onSelect={() => {}} />)
    expect(screen.getByText('No files yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend test tests/components/knowledge-file-tree.test.tsx`
Expected: FAIL — cannot resolve `@/components/knowledge/file-tree`.

- [ ] **Step 3: Implement the component + helper**

Create `packages/frontend/src/components/knowledge/file-tree.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { ChevronRightIcon, FileTextIcon, FolderIcon } from 'lucide-react'
import type { KnowledgeBaseFileEntry } from '@anubis/shared'
import { cn } from '@/lib/utils'

export interface KnowledgeTreeFile { kind: 'file'; name: string; path: string }
export interface KnowledgeTreeFolder { kind: 'folder'; name: string; path: string; children: KnowledgeTreeNode[] }
export type KnowledgeTreeNode = KnowledgeTreeFolder | KnowledgeTreeFile

export function buildKnowledgeTree(entries: { path: string }[]): KnowledgeTreeNode[] {
  const root: KnowledgeTreeFolder = { kind: 'folder', name: '', path: '', children: [] }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let cursor = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      if (isFile) {
        cursor.children.push({ kind: 'file', name: part, path: entry.path })
      } else {
        const folderPath = parts.slice(0, i + 1).join('/')
        let next = cursor.children.find(
          (c): c is KnowledgeTreeFolder => c.kind === 'folder' && c.path === folderPath,
        )
        if (!next) {
          next = { kind: 'folder', name: part, path: folderPath, children: [] }
          cursor.children.push(next)
        }
        cursor = next
      }
    }
  }
  sortTree(root.children)
  return root.children
}

function sortTree(nodes: KnowledgeTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const n of nodes) if (n.kind === 'folder') sortTree(n.children)
}

export function KnowledgeFileTree({
  entries, selectedPath, onSelect,
}: {
  entries: KnowledgeBaseFileEntry[]
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const tree = useMemo(() => buildKnowledgeTree(entries), [entries])
  if (entries.length === 0) {
    return <p className='px-3 py-1.5 text-[12px] text-muted-foreground'>No files yet.</p>
  }
  return (
    <ul className='flex flex-col'>
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function TreeNode({
  node, depth, selectedPath, onSelect,
}: {
  node: KnowledgeTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const pad = depth * 12 + 8
  if (node.kind === 'folder') {
    return (
      <li>
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: pad }}
          className='flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12.5px] text-foreground/80 hover:bg-background'
        >
          <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          <FolderIcon className='size-3.5 shrink-0 text-muted-foreground' />
          <span className='truncate'>{node.name}</span>
        </button>
        {open && (
          <ul>
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </li>
    )
  }
  return (
    <li>
      <button
        type='button'
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: pad }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-background',
          selectedPath === node.path ? 'bg-background text-foreground' : 'text-foreground/70',
        )}
      >
        <FileTextIcon className='size-3.5 shrink-0 text-muted-foreground' />
        <span className='truncate'>{node.name}</span>
      </button>
    </li>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend test tests/components/knowledge-file-tree.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/knowledge/file-tree.tsx packages/frontend/tests/components/knowledge-file-tree.test.tsx
git commit -m "feat(frontend): knowledge file-tree component + buildKnowledgeTree helper"
```

---

## Task 6: Markdown view + editor components

**Files:**
- Create: `packages/frontend/src/components/knowledge/markdown-view.tsx`
- Create: `packages/frontend/src/components/knowledge/markdown-editor.tsx`
- Test: `packages/frontend/tests/components/knowledge-markdown-editor.test.tsx`

> Note: `MarkdownView` wraps `streamdown` (with the cjk/code/math/mermaid plugins, mirroring `components/ai-elements/reasoning.tsx`). It is **not** unit-tested — the streamdown + mermaid pipeline does not render meaningfully under jsdom; it is verified in-app (Task 10). The editor *is* tested (pure textarea).

- [ ] **Step 1: Write the failing editor test**

Create `packages/frontend/tests/components/knowledge-markdown-editor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownEditor } from '@/components/knowledge/markdown-editor'

describe('MarkdownEditor', () => {
  it('calls onChange with the new value when typed', () => {
    const onChange = vi.fn()
    render(<MarkdownEditor value='hi' onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('hi'), { target: { value: 'hello world' } })
    expect(onChange).toHaveBeenCalledWith('hello world')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend test tests/components/knowledge-markdown-editor.test.tsx`
Expected: FAIL — cannot resolve `@/components/knowledge/markdown-editor`.

- [ ] **Step 3: Implement both components**

Create `packages/frontend/src/components/knowledge/markdown-editor.tsx`:

```tsx
import { cn } from '@/lib/utils'

export function MarkdownEditor({
  value, onChange, className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className={cn(
        'h-full w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-[12.5px] leading-relaxed text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]',
        className,
      )}
    />
  )
}
```

Create `packages/frontend/src/components/knowledge/markdown-view.tsx`:

```tsx
import { Streamdown } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'

const plugins = { cjk, code, math, mermaid }

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className='text-[13.5px] leading-relaxed text-foreground/90'>
      <Streamdown plugins={plugins}>{content}</Streamdown>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend test tests/components/knowledge-markdown-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/knowledge/markdown-view.tsx packages/frontend/src/components/knowledge/markdown-editor.tsx packages/frontend/tests/components/knowledge-markdown-editor.test.tsx
git commit -m "feat(frontend): knowledge markdown view + editor components"
```

---

## Task 7: Rewrite the Knowledge Base page

**Files:**
- Modify (full rewrite): `packages/frontend/src/pages/knowledge-base.tsx`

> The export name `KnowledgeBasePage` is preserved so `components/dashboard/index.tsx` needs no change. `useKbLoader` is kept for the compact stats line. Delete is guarded by `window.confirm` (supported in Electron; `window.prompt` is **not**, hence the inline new-file input).

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `packages/frontend/src/pages/knowledge-base.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  DatabaseIcon, FilePlusIcon, FolderTreeIcon, PencilIcon,
  RefreshCwIcon, SaveIcon, SearchIcon, Trash2Icon, XIcon,
} from 'lucide-react'
import type { KnowledgeBaseFileEntry, KnowledgeBaseSearchHit } from '@anubis/shared'
import {
  deleteKnowledgeBaseFile, getKnowledgeBaseTree, ingestKnowledgeBase,
  readKnowledgeBaseFile, saveKnowledgeBaseFile, searchKnowledgeBase, updateKnowledgeBaseFile,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { useKbLoader } from '@/lib/use-kb-loader'
import { KnowledgeFileTree } from '@/components/knowledge/file-tree'
import { MarkdownView } from '@/components/knowledge/markdown-view'
import { MarkdownEditor } from '@/components/knowledge/markdown-editor'

type Banner = { kind: 'success' | 'error'; message: string }
type Mode = 'view' | 'edit'

export function KnowledgeBasePage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id
  const projectWorkdir = activeProject?.workdir

  const stats = useKbLoader((s) => (projectId ? s.kbStats[projectId] : null)) || null
  const loadProjectData = useKbLoader((s) => s.loadProjectData)

  const [tree, setTree] = useState<KnowledgeBaseFileEntry[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<Mode>('view')
  const [editBuffer, setEditBuffer] = useState('')
  const [isNewFile, setIsNewFile] = useState(false)
  const [newPathInput, setNewPathInput] = useState('')
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [ingesting, setIngesting] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeBaseSearchHit[] | null>(null)

  const refreshTree = useCallback(async () => {
    if (!projectId) return
    setTreeLoading(true)
    try {
      setTree(await getKnowledgeBaseTree(projectId))
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load files.' })
    } finally {
      setTreeLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    void refreshTree()
    void loadProjectData(projectId, true)
  }, [projectId, refreshTree, loadProjectData])

  const openFile = useCallback(async (path: string) => {
    if (!projectId) return
    setBusy(true); setBanner(null)
    try {
      const file = await readKnowledgeBaseFile(projectId, path)
      setSelectedPath(file.path)
      setContent(file.content)
      setMode('view')
      setIsNewFile(false)
      setResults(null)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to open file.' })
    } finally {
      setBusy(false)
    }
  }, [projectId])

  function startEdit() {
    setEditBuffer(content)
    setMode('edit')
    setBanner(null)
  }

  function startNewFile() {
    setIsNewFile(true)
    setNewPathInput('')
    setSelectedPath(null)
    setContent('')
    setEditBuffer('')
    setMode('edit')
    setResults(null)
    setBanner(null)
  }

  function cancelEdit() {
    if (isNewFile) {
      setIsNewFile(false)
      setNewPathInput('')
      setSelectedPath(null)
      setContent('')
    }
    setMode('view')
    setBanner(null)
  }

  async function handleSave() {
    if (!projectId) return
    const path = isNewFile ? newPathInput.trim() : selectedPath
    if (!path) {
      setBanner({ kind: 'error', message: 'Enter a file path ending in .md' })
      return
    }
    setBusy(true); setBanner(null)
    try {
      if (isNewFile) await saveKnowledgeBaseFile({ projectId, path, content: editBuffer })
      else await updateKnowledgeBaseFile({ projectId, path, content: editBuffer })
      setContent(editBuffer)
      setSelectedPath(path)
      setIsNewFile(false)
      setNewPathInput('')
      setMode('view')
      setBanner({ kind: 'success', message: `Saved ${path}.` })
      await refreshTree()
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Save failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!projectId || !selectedPath) return
    if (!window.confirm(`Delete ${selectedPath}? This cannot be undone.`)) return
    setBusy(true); setBanner(null)
    try {
      await deleteKnowledgeBaseFile({ projectId, path: selectedPath })
      setBanner({ kind: 'success', message: `Deleted ${selectedPath}.` })
      setSelectedPath(null)
      setContent('')
      setMode('view')
      await refreshTree()
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Delete failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleIngest() {
    if (!projectId) return
    setIngesting(true); setBanner(null)
    try {
      const r = await ingestKnowledgeBase({ projectId, full: true })
      setBanner({ kind: 'success', message: `Re-indexed ${r.documents} document(s), ${r.chunks} chunk(s).` })
      await refreshTree()
      await loadProjectData(projectId, true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Ingest failed.' })
    } finally {
      setIngesting(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !query.trim()) return
    setBanner(null)
    try {
      const r = await searchKnowledgeBase({ projectId, query: query.trim(), limit: 20 })
      setResults(r.results)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Search failed.' })
    }
  }

  if (!projectId) {
    return <EmptyState title='Pick a project to use Knowledge Base'
      body='Each project has its own Knowledge Base, scoped to the project workspace. Create or select a project from the top bar.' />
  }
  if (!projectWorkdir) {
    return <EmptyState title='This project has no workspace folder'
      body='Set a workspace path on the project before using its Knowledge Base.' />
  }

  return (
    <div className='flex flex-1 overflow-hidden bg-background'>
      <aside className='flex w-[300px] shrink-0 flex-col border-r border-border bg-card/40'>
        <div className='flex items-center justify-between gap-2 border-b border-border px-3 py-2.5'>
          <span className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Files</span>
          <div className='flex items-center gap-1'>
            <IconButton title='New file' onClick={startNewFile}><FilePlusIcon className='size-[15px]' strokeWidth={1.8} /></IconButton>
            <IconButton title='Re-index corpus' onClick={() => void handleIngest()} disabled={ingesting}>
              <RefreshCwIcon className={cn('size-[15px]', ingesting && 'animate-spin')} strokeWidth={1.8} />
            </IconButton>
            <IconButton title='Refresh file tree' onClick={() => void refreshTree()} disabled={treeLoading}>
              <FolderTreeIcon className={cn('size-[15px]', treeLoading && 'animate-pulse')} strokeWidth={1.8} />
            </IconButton>
          </div>
        </div>

        <form onSubmit={handleSearch} className='border-b border-border px-3 py-2'>
          <div className='relative'>
            <SearchIcon className='pointer-events-none absolute left-2.5 top-1/2 size-[14px] -translate-y-1/2 text-muted-foreground' strokeWidth={1.8} />
            <input
              type='text' value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder='Search the corpus…' spellCheck={false}
              className='h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
            />
          </div>
        </form>

        <div className='flex-1 overflow-y-auto py-1'>
          {results !== null
            ? <SearchResults results={results} onClear={() => setResults(null)} onOpen={(p) => void openFile(p)} />
            : <KnowledgeFileTree entries={tree} selectedPath={selectedPath} onSelect={(p) => void openFile(p)} />}
        </div>

        <div className='border-t border-border px-3 py-2 font-mono text-[10.5px] text-muted-foreground'>
          {stats ? `${stats.documentCount} docs · ${stats.chunkCount} chunks` : '—'}
        </div>
      </aside>

      <main className='flex flex-1 flex-col overflow-hidden'>
        {banner && (
          <div role='status' className={cn(
            'mx-5 mt-4 rounded-md border px-3.5 py-2.5 text-[13px]',
            banner.kind === 'error'
              ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
              : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
          )}>
            {banner.message}
          </div>
        )}

        <div className='flex items-center justify-between gap-3 border-b border-border px-5 py-3'>
          <div className='min-w-0'>
            {isNewFile ? (
              <input
                type='text' autoFocus value={newPathInput} onChange={(e) => setNewPathInput(e.target.value)}
                placeholder='folder/name.md' spellCheck={false}
                className='h-8 w-[320px] max-w-full rounded-md border border-border bg-background px-2.5 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
              />
            ) : selectedPath ? (
              <span className='block truncate font-mono text-[13px] text-foreground'>{selectedPath}</span>
            ) : (
              <span className='text-[13px] text-muted-foreground'>Select a file to view</span>
            )}
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {mode === 'view' && selectedPath && (
              <>
                <ToolbarButton onClick={startEdit}><PencilIcon className='size-[14px]' strokeWidth={1.8} />Edit</ToolbarButton>
                <ToolbarButton onClick={() => void handleDelete()} tone='danger' disabled={busy}>
                  <Trash2Icon className='size-[14px]' strokeWidth={1.8} />Delete
                </ToolbarButton>
              </>
            )}
            {mode === 'edit' && (
              <>
                <ToolbarButton onClick={() => void handleSave()} tone='gold' disabled={busy}>
                  <SaveIcon className='size-[14px]' strokeWidth={1.8} />Save
                </ToolbarButton>
                <ToolbarButton onClick={cancelEdit}><XIcon className='size-[14px]' strokeWidth={1.8} />Cancel</ToolbarButton>
              </>
            )}
          </div>
        </div>

        <div className='flex-1 overflow-y-auto p-5'>
          {mode === 'edit' ? (
            <MarkdownEditor value={editBuffer} onChange={setEditBuffer} className='min-h-[420px]' />
          ) : selectedPath ? (
            <MarkdownView content={content} />
          ) : (
            <div className='flex h-full items-center justify-center'>
              <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
                <DatabaseIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
                <p className='text-[13px] leading-relaxed text-muted-foreground'>
                  Browse <code className='font-mono text-foreground/80'>{projectWorkdir}/knowledge/</code>. Pick a file on the left, or create a new one.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function IconButton({ children, title, onClick, disabled }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type='button' title={title} onClick={onClick} disabled={disabled}
      className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50'
    >
      {children}
    </button>
  )
}

function ToolbarButton({ children, onClick, tone, disabled }: {
  children: React.ReactNode; onClick: () => void; tone?: 'gold' | 'danger'; disabled?: boolean
}) {
  return (
    <button
      type='button' onClick={onClick} disabled={disabled}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50',
        tone === 'gold'
          ? 'border-transparent bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]'
          : tone === 'danger'
            ? 'border-border text-destructive hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)]'
            : 'border-border bg-card text-foreground hover:bg-card/70',
      )}
    >
      {children}
    </button>
  )
}

function SearchResults({ results, onClear, onOpen }: {
  results: KnowledgeBaseSearchHit[]; onClear: () => void; onOpen: (path: string) => void
}) {
  return (
    <div className='px-2'>
      <button type='button' onClick={onClear} className='mb-1 px-1 text-[11px] text-muted-foreground hover:text-foreground'>
        ← back to files
      </button>
      {results.length === 0 ? (
        <p className='px-1 py-1 text-[12px] text-muted-foreground'>No results.</p>
      ) : (
        <ul className='flex flex-col gap-1'>
          {results.map((h, i) => (
            <li key={`${h.source}-${h.startLine}-${i}`}>
              <button type='button' onClick={() => onOpen(h.source)} className='w-full rounded px-1.5 py-1 text-left hover:bg-background'>
                <span className='block truncate font-mono text-[11.5px] text-foreground/80'>{h.source}</span>
                {h.heading && <span className='block truncate text-[11px] text-muted-foreground'>{h.heading}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex flex-1 items-center justify-center bg-background'>
      <div className='mx-auto flex max-w-md flex-col items-center gap-3 px-7 text-center'>
        <DatabaseIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
        <h1 className='text-[20px] font-semibold leading-tight'>{title}</h1>
        <p className='text-[13px] leading-relaxed text-muted-foreground'>{body}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS. (Confirms imports resolve — including the new `@/components/knowledge/*` and `@/api` functions.)

- [ ] **Step 3: Run the full frontend test suite (catch regressions in route/sidebar tests)**

Run: `pnpm --filter @anubis/frontend test`
Expected: PASS — including `tests/components/sidebar-routes.test.ts` (the `knowledge-base` route is unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/knowledge-base.tsx
git commit -m "feat(frontend): rewrite Knowledge Base page as file explorer + markdown editor"
```

---

## Task 8: Sidebar icon (small polish)

**Files:**
- Modify: `packages/frontend/src/components/dashboard/data.ts`

- [ ] **Step 1: Swap the Knowledge Base icon to a folder-tree icon**

In `packages/frontend/src/components/dashboard/data.ts`, add `FolderTreeIcon` to the `lucide-react` import (keep the alphabetical-ish grouping), then change the nav item on line ~42 from:

```ts
  { label: 'Knowledge Base', icon: DatabaseIcon, page: 'knowledge-base' },
```

to:

```ts
  { label: 'Knowledge Base', icon: FolderTreeIcon, page: 'knowledge-base' },
```

(If `DatabaseIcon` becomes unused elsewhere in the file, leave it — it is still imported by other modules; only remove it from this import if `pnpm --filter @anubis/frontend typecheck` flags it as unused here.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/dashboard/data.ts
git commit -m "chore(frontend): use folder-tree icon for Knowledge Base nav item"
```

---

## Task 9: Graph cleanup — workflow demo + dead dependency

**Files:**
- Modify: `packages/frontend/src/components/workflow/demo/sample-data.ts`
- Modify: `packages/frontend/src/components/workflow/demo/gallery.tsx`
- Modify: `packages/frontend/src/components/workflow/nodes/context-builder-node.tsx`
- Modify: `packages/frontend/package.json` (remove `react-force-graph-2d`)

- [ ] **Step 1: Confirm no test asserts the demo node/edge counts**

Run: `pnpm exec rg -n "sampleFlowNodes|sampleFlowEdges|knowledgeBase|'knowledge-base'|\\be7\\b" packages/frontend/tests`
Expected: review output. If any test asserts a node/edge **count** or the `knowledge-base` node id / `e7` edge, note it — you will update that assertion in Step 6.

- [ ] **Step 2: Remove the `knowledgeBase` sample data + its type import**

In `packages/frontend/src/components/workflow/demo/sample-data.ts`:

(a) Delete the `knowledgeBase: { ... } satisfies TableNodeData,` block (the 8 lines starting at `knowledgeBase: {`).

(b) Delete the now-unused import line:

```ts
import type { TableNodeData }         from '../nodes/table-node'
```

- [ ] **Step 3: Remove the demo node and its edge**

In the same file:

(a) Delete the `knowledge-base` node from `sampleFlowNodes`:

```ts
  { id: 'knowledge-base',            type: 'referenceTable',  position: { x: 1760, y:  520 }, data: { ...sampleNodeData.knowledgeBase } },
```

(b) Delete the `e7` edge from `EDGE_SPECS`:

```ts
  { id: 'e7',  source: 'knowledge-base',           target: 'ai-context-builder',       label: 'KB context' },
```

- [ ] **Step 4: Remove the gallery showcase that used it**

In `packages/frontend/src/components/workflow/demo/gallery.tsx`, delete the `TableNode` item (line ~17):

```ts
  { label: 'TableNode',               node: { id: 'g-tb2', type: 'referenceTable', position: { x: 0, y: 0 }, data: { ...sampleNodeData.knowledgeBase } } },
```

- [ ] **Step 5: Trim the incidental KB mention from the context-builder node subtitle**

In `packages/frontend/src/components/workflow/nodes/context-builder-node.tsx`, change the subtitle (line ~27) from:

```tsx
      subtitle='Builds the execution brief from crawler output, transformed data, brand rules, knowledge base, and similarity context.'
```

to:

```tsx
      subtitle='Builds the execution brief from crawler output, transformed data, brand rules, and similarity context.'
```

- [ ] **Step 6: Typecheck + run workflow tests; fix any count assertions found in Step 1**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (no unused-import errors; `TableNodeData` import is gone, `referenceTable` node type still exists in the registry).

Run: `pnpm --filter @anubis/frontend test tests/workflow`
Expected: PASS. If a test asserted the old node/edge count (e.g. 12 nodes / 12 edges), update it to the new counts (11 nodes / 11 edges) and re-run.

- [ ] **Step 7: Remove the dead `react-force-graph-2d` dependency**

Run: `pnpm --filter @anubis/frontend remove react-force-graph-2d`
Expected: it is removed from `packages/frontend/package.json` and the lockfile. (Verified zero imports in `packages/frontend/src` during design.)

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/workflow packages/frontend/package.json pnpm-lock.yaml
git commit -m "chore(frontend): remove knowledge-base node from workflow demo + drop dead react-force-graph-2d dep"
```

---

## Task 10: Whole-repo verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Rebuild changed packages in order**

Run:
```bash
pnpm --filter @anubis/knowledge-lite build
pnpm --filter @anubis/shared build
pnpm --filter @anubis/backend build
```
Expected: all succeed.

- [ ] **Step 2: Whole-repo typecheck**

Run: `pnpm typecheck`
Expected: PASS across every package.

- [ ] **Step 3: Targeted test suites**

Run:
```bash
pnpm --filter @anubis/knowledge-lite test
pnpm --filter @anubis/backend test tests/knowledge-base.test.ts
pnpm --filter @anubis/frontend test
```
Expected: all PASS. (If backend hits `ERR_DLOPEN_FAILED`, `pnpm rebuild better-sqlite3` then retry.)

- [ ] **Step 4: Manual smoke in the real Electron app**

Use the `verify` skill (or `pnpm dev`). On a project that has a `knowledge/` folder with a few `.md` files (create some if needed), confirm:
  - Sidebar "Knowledge Base" opens the new two-pane explorer.
  - The file tree shows nested folders; clicking a file renders its markdown on the right.
  - Edit → change text → Save persists (reopen shows new content); the stats line updates.
  - New file → type `folder/test.md` → write content → Save creates it and it appears in the tree.
  - Delete → confirm dialog → file disappears from the tree.
  - Search box returns hits; clicking a hit opens that file.
  - Re-index button reports document/chunk counts.
  - Open the Workflows demo/gallery: the knowledge-base table node is gone and the flow still renders without errors.

- [ ] **Step 5: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "test(knowledge-base): verification fixes for file-explorer rework"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** engine methods (T1), shared types (T2), backend routes (T3), api wrappers (T4), file-tree+helper (T5), markdown view/editor (T6), page rewrite with search/ingest/CRUD/stats (T7), nav icon (T8), graph cleanup — dead dep + workflow demo (T9), testing/verification (T10). All spec sections mapped.
- **Type consistency:** `KnowledgeBaseFileEntry {path,size,updatedAt}` and `KnowledgeBaseFileContent {path,content}` are defined once (T2), returned structurally by the engine (T1), surfaced by the api (T4), and consumed by the page (T7). Function names `getKnowledgeBaseTree` / `readKnowledgeBaseFile` / `saveKnowledgeBaseFile` / `updateKnowledgeBaseFile` / `deleteKnowledgeBaseFile` and components `buildKnowledgeTree` / `KnowledgeFileTree` / `MarkdownView` / `MarkdownEditor` are used identically across tasks.
- **No placeholders:** every code step contains complete code; every run step has an expected result.
- **Known deliberate gaps:** `MarkdownView` is not unit-tested (jsdom can't render the streamdown/mermaid pipeline) — covered by the T10 manual smoke; page-level integration is covered by the pure `buildKnowledgeTree`/`KnowledgeFileTree`/`MarkdownEditor` unit tests plus the manual smoke.
