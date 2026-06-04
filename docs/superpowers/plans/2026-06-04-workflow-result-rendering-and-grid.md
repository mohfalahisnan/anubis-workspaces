# Workflow Result Rendering + Card Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each executable node renders its succeeded output in the node body, and each workflow card on the list page embeds a mini graph preview of its draft graph.

**Architecture:** New backend artifact route streams files from `{dataDir}/workflow-runs/*` with a path-traversal guard. Frontend gets a `useNodeRunOutput(nodeId)` hook (mirrors `useNodeRunStatus`) that pulls the step output from the editor store. Each of the 7 executable node renderers reads its typed output and renders a per-type result block. The list route returns `previewGraph` per summary; a new mini ReactFlow card preview renders it with a stripped-down per-node pill component.

**Tech Stack:** TypeScript (ESM, `isolatedModules`, explicit `.js` imports), Zod, vitest, React 19, ReactFlow (`@xyflow/react`), Hono.

**Spec:** [docs/superpowers/specs/2026-06-04-workflow-result-rendering-and-grid-design.md](../specs/2026-06-04-workflow-result-rendering-and-grid-design.md)

---

## Task 1: Backend artifact route

**Files:**
- Modify: `packages/backend/src/workflow.ts`
- Test:   `packages/backend/tests/workflow-artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/workflow-artifacts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { mountWorkflowRoutes } from '../src/workflow.js'
import { setServices } from '../src/services.js'

let dataDir: string
let app: Hono

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-artifacts-'))
  mkdirSync(join(dataDir, 'workflow-runs', 'run-1'), { recursive: true })
  writeFileSync(join(dataDir, 'workflow-runs', 'run-1', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  // setServices lets tests inject a minimal stack + dataDir without booting the whole backend
  setServices({ stack: null as never, dataDir })
  app = new Hono()
  mountWorkflowRoutes(app)
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('GET /workflows/artifacts', () => {
  it('streams a file inside the artifact root', async () => {
    const valid = join(dataDir, 'workflow-runs', 'run-1', 'pic.png')
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(valid)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('400s on missing path query', async () => {
    const res = await app.request('/workflows/artifacts')
    expect(res.status).toBe(400)
  })

  it('403s on path-traversal attempt', async () => {
    const escape = join(dataDir, '..', 'etc', 'passwd')
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(escape)}`)
    expect(res.status).toBe(403)
  })

  it('404s on missing file inside root', async () => {
    const missing = join(dataDir, 'workflow-runs', 'run-1', 'nope.png')
    const res = await app.request(`/workflows/artifacts?path=${encodeURIComponent(missing)}`)
    expect(res.status).toBe(404)
  })
})
```

NOTE: this test imports two things that may not exist yet (`mountWorkflowRoutes` as a named export, `setServices`). If the backend already mounts via a singleton module pattern, adapt the imports in Step 1 to call whatever bootstrap the existing tests use. Run `grep -rn "mountWorkflowRoutes\|setServices" packages/backend/tests packages/backend/src` to confirm or find the existing pattern first; if absent, this test file fails at import time and the engineer should fall back to a simpler runtime test that hits the live backend startup helper (see `packages/backend/tests/` for one).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/workflow-artifacts.test.ts`
Expected: FAIL — route not implemented (or import errors if helpers differ; fix imports first per Step 1 note).

- [ ] **Step 3: Add the artifact route**

In `packages/backend/src/workflow.ts`, add imports at the top:

```ts
import { createReadStream, existsSync } from 'node:fs'
import { resolve, sep, join, extname } from 'node:path'
```

Then add this route alongside the existing routes (after the `/workflows/runs/:runId/events` route is a fine place):

```ts
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

workflowRoutes.get('/artifacts', (c) => {
  const requested = c.req.query('path')
  if (!requested) return c.json({ error: 'missing_path' }, 400)
  const root = resolve(join(getDataDir(), 'workflow-runs'))
  const target = resolve(requested)
  // Allow only paths under {dataDir}/workflow-runs/ with no `..` escape.
  if (!target.startsWith(root + sep) && target !== root) {
    return c.json({ error: 'forbidden' }, 403)
  }
  if (!existsSync(target)) return c.json({ error: 'not_found' }, 404)
  const stream = createReadStream(target)
  const contentType = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
  return c.body(stream as unknown as ReadableStream, 200, {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=300',
  })
})
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run packages/backend/tests/workflow-artifacts.test.ts`
Expected: PASS, all 4 tests.

Run: `pnpm --filter @anubis/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/workflow.ts packages/backend/tests/workflow-artifacts.test.ts
git commit -m "feat(backend): GET /workflows/artifacts streams files with path guard

Lets the frontend display media files produced by workflow executors
(IG post images, image-video, transformer-media output) via plain HTTP
without resorting to file:// URLs that Electron blocks. Path must be
under {dataDir}/workflow-runs/; .. escapes are rejected."
```

---

## Task 2: Backend list returns `previewGraph`

**Files:**
- Modify: `packages/backend/src/workflow.ts`

- [ ] **Step 1: Modify the list handler**

In `packages/backend/src/workflow.ts`, find the existing `workflowRoutes.get('/', ...)` handler. Replace its `return` object with:

```ts
    return {
      id: wf.id, name: wf.name, description: wf.description,
      hasPublished: wf.publishedGraph != null,
      draftAhead: wf.publishedGraph != null && wf.draftGraph !== wf.publishedGraph,
      draftUpdatedAt: wf.draftUpdatedAt, publishedAt: wf.publishedAt,
      lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt } : undefined,
      previewGraph: wf.draftGraph,
    }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit (with Task 3's frontend type bump)**

Hold uncommitted; combine with Task 3.

---

## Task 3: Frontend WorkflowSummary type + artifactUrl helper

**Files:**
- Modify: `packages/frontend/src/api/workflows.ts`
- Create: `packages/frontend/src/lib/artifacts.ts`

- [ ] **Step 1: Add `previewGraph` to the type**

In `packages/frontend/src/api/workflows.ts`, replace the `WorkflowSummary` interface with:

```ts
export interface WorkflowSummary {
  id: string
  name: string
  description?: string
  hasPublished: boolean
  draftAhead: boolean
  draftUpdatedAt: number
  publishedAt?: number
  lastRun?: { id: string; status: string; startedAt: number }
  previewGraph: string
}
```

- [ ] **Step 2: Add the `artifactUrl` helper**

Create `packages/frontend/src/lib/artifacts.ts`:

```ts
import { getApiBaseUrl } from '@/api'

/**
 * Build an absolute URL that streams a workflow-run artifact through the
 * backend. Works in both browser-dev and packaged Electron without the
 * `file://` security restrictions Electron's renderer imposes.
 */
export async function artifactUrl(absolutePath: string): Promise<string> {
  const base = await getApiBaseUrl()
  return `${base}/workflows/artifacts?path=${encodeURIComponent(absolutePath)}`
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit (Tasks 2 + 3 combined)**

```bash
git add packages/backend/src/workflow.ts packages/frontend/src/api/workflows.ts packages/frontend/src/lib/artifacts.ts
git commit -m "feat(workflow): list returns previewGraph; add artifactUrl helper

Backend list route forwards each workflow's draftGraph as previewGraph.
Frontend adds the field to WorkflowSummary and a small artifactUrl()
helper that points at the new /workflows/artifacts route."
```

---

## Task 4: `useNodeRunOutput` hook + `<JsonFallback>`

**Files:**
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/_use-run-output.ts`
- Create: `packages/frontend/src/components/workflow-editor/executable-nodes/_json-fallback.tsx`

- [ ] **Step 1: Write the hook**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/_use-run-output.ts`:

```ts
import { useEditorStore } from '../editor-store'

export function useNodeRunOutput(nodeId: string): unknown {
  return useEditorStore((s) => s.activeRun?.steps[nodeId]?.output)
}
```

- [ ] **Step 2: Write the fallback component**

Create `packages/frontend/src/components/workflow-editor/executable-nodes/_json-fallback.tsx`:

```tsx
export function JsonFallback({ value }: { value: unknown }) {
  let pretty: string
  try {
    pretty = JSON.stringify(value, null, 2)
  } catch {
    pretty = String(value)
  }
  return (
    <div className='mt-3 max-h-[180px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-2'>
      <pre className='whitespace-pre-wrap break-words text-[10px] text-zinc-300'>{pretty}</pre>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/_use-run-output.ts packages/frontend/src/components/workflow-editor/executable-nodes/_json-fallback.tsx
git commit -m "feat(frontend): add useNodeRunOutput hook + JsonFallback

useNodeRunOutput(nodeId) returns the succeeded step output from the
editor store; mirrors the existing useNodeRunStatus.

JsonFallback pretty-prints any output the per-renderer bespoke result
blocks haven't yet learned to display. Lets per-renderer rollouts
happen incrementally."
```

---

## Task 5: `<FileThumb>` shared component

**Files:**
- Create: `packages/frontend/src/components/workflow/file-thumb.tsx`

- [ ] **Step 1: Write the component**

Create `packages/frontend/src/components/workflow/file-thumb.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { artifactUrl } from '@/lib/artifacts'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov'])

function extOf(path: string): string {
  const m = path.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)
  return m && m[1] ? m[1].toLowerCase() : ''
}

function basename(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path
}

export function FileThumb({ path, className = '' }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    artifactUrl(path).then(setUrl).catch(() => setUrl(null))
  }, [path])

  const ext = extOf(path)
  if (IMAGE_EXT.has(ext)) {
    return url ? (
      <img src={url} alt={basename(path)} className={`h-20 w-full rounded-lg object-cover ${className}`} />
    ) : <Skeleton className={className} />
  }
  if (VIDEO_EXT.has(ext)) {
    return url ? (
      <video src={url} className={`h-20 w-full rounded-lg object-cover ${className}`} muted preload='metadata' />
    ) : <Skeleton className={className} />
  }
  return (
    <div className={`flex h-20 w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[10px] text-zinc-400 ${className}`}>
      <span className='truncate px-2'>{basename(path)}</span>
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`h-20 w-full animate-pulse rounded-lg bg-white/5 ${className}`} />
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow/file-thumb.tsx
git commit -m "feat(frontend): FileThumb shared component

Renders an artifact path as an image, video poster, or filename pill
based on extension. URL resolves via artifactUrl() so files served by
the new /workflows/artifacts route load without file:// issues."
```

---

## Task 6: `<PreviewNode>` + `<WorkflowCardPreview>`

**Files:**
- Create: `packages/frontend/src/pages/workflows/preview-node.tsx`
- Create: `packages/frontend/src/pages/workflows/workflow-card-preview.tsx`

- [ ] **Step 1: Write the preview-node component**

Create `packages/frontend/src/pages/workflows/preview-node.tsx`:

```tsx
import { memo } from 'react'

const TYPE_LABELS: Record<string, string> = {
  instagramPost: 'IG Post',
  imageVideo: 'Image / Video',
  transformerMedia: 'Transform · Media',
  transformerBrief: 'Transform · Brief',
  ocrExtractor: 'OCR',
  table: 'Table',
  aiAgentConversation: 'AI Agent',
}

const TYPE_DOTS: Record<string, string> = {
  instagramPost: 'bg-[#ff6b35]',
  imageVideo: 'bg-[#ff9b7a]',
  transformerMedia: 'bg-[#ff9b7a]',
  transformerBrief: 'bg-[#fd551d]',
  ocrExtractor: 'bg-[#22c55e]',
  table: 'bg-[#22c55e]',
  aiAgentConversation: 'bg-white',
}

export const PreviewNode = memo(function PreviewNode({ type }: { type?: string }) {
  const label = TYPE_LABELS[type ?? ''] ?? type ?? 'Node'
  const dot = TYPE_DOTS[type ?? ''] ?? 'bg-zinc-400'
  return (
    <div className='flex items-center gap-1.5 rounded-md border border-white/15 bg-[#161617]/95 px-2 py-1 shadow-md shadow-black/40 text-[9px] text-white'>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className='truncate'>{label}</span>
    </div>
  )
})
```

NOTE: ReactFlow nodes need to handle source/target handles. Since we disable all interaction, we still need invisible Handle elements so edges have anchor points. Update the component:

```tsx
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'

const TYPE_LABELS: Record<string, string> = {
  instagramPost: 'IG Post',
  imageVideo: 'Image / Video',
  transformerMedia: 'Transform · Media',
  transformerBrief: 'Transform · Brief',
  ocrExtractor: 'OCR',
  table: 'Table',
  aiAgentConversation: 'AI Agent',
}

const TYPE_DOTS: Record<string, string> = {
  instagramPost: 'bg-[#ff6b35]',
  imageVideo: 'bg-[#ff9b7a]',
  transformerMedia: 'bg-[#ff9b7a]',
  transformerBrief: 'bg-[#fd551d]',
  ocrExtractor: 'bg-[#22c55e]',
  table: 'bg-[#22c55e]',
  aiAgentConversation: 'bg-white',
}

export const PreviewNode = memo(function PreviewNode({ type }: { type?: string }) {
  const label = TYPE_LABELS[type ?? ''] ?? type ?? 'Node'
  const dot = TYPE_DOTS[type ?? ''] ?? 'bg-zinc-400'
  return (
    <>
      <Handle type='target' position={Position.Left} className='!h-1 !w-1 !border-0 !bg-transparent' isConnectable={false} />
      <div className='flex items-center gap-1.5 rounded-md border border-white/15 bg-[#161617]/95 px-2 py-1 shadow-md shadow-black/40 text-[9px] text-white'>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className='truncate'>{label}</span>
      </div>
      <Handle type='source' position={Position.Right} className='!h-1 !w-1 !border-0 !bg-transparent' isConnectable={false} />
    </>
  )
})
```

The two Handle elements are invisible (1×1 px transparent) but give ReactFlow's edges anchor points so lines draw.

- [ ] **Step 2: Write the card preview component**

Create `packages/frontend/src/pages/workflows/workflow-card-preview.tsx`:

```tsx
import { useMemo } from 'react'
import { ReactFlow, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PreviewNode } from './preview-node'

interface WorkflowGraph {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: unknown }>
  edges: Array<{ id: string; source: string; target: string }>
}

const previewNodeTypes = {
  instagramPost: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'instagramPost'} />,
  imageVideo: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'imageVideo'} />,
  transformerMedia: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'transformerMedia'} />,
  transformerBrief: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'transformerBrief'} />,
  ocrExtractor: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'ocrExtractor'} />,
  table: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'table'} />,
  aiAgentConversation: ({ type }: { type?: string }) => <PreviewNode type={type ?? 'aiAgentConversation'} />,
}

function EmptyPreview({ label = 'No nodes yet' }: { label?: string }) {
  return (
    <div className='flex h-[140px] w-full items-center justify-center rounded-xl border border-border bg-[#0b0b0c]/60 text-[11px] text-muted-foreground'>
      {label}
    </div>
  )
}

export function WorkflowCardPreview({ graphJson }: { graphJson?: string }) {
  const parsed = useMemo<WorkflowGraph | null>(() => {
    if (!graphJson) return null
    try {
      return JSON.parse(graphJson) as WorkflowGraph
    } catch {
      return null
    }
  }, [graphJson])

  if (!parsed || parsed.nodes.length === 0) return <EmptyPreview />

  const nodes: Node[] = parsed.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {},
    draggable: false,
    selectable: false,
    connectable: false,
  }))
  const edges: Edge[] = parsed.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: 'rgba(253, 85, 29, 0.5)', strokeWidth: 1.5 },
  }))

  return (
    <div className='h-[140px] w-full overflow-hidden rounded-xl border border-border bg-[#0b0b0c]/60'>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={previewNodeTypes as never}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/workflows/preview-node.tsx packages/frontend/src/pages/workflows/workflow-card-preview.tsx
git commit -m "feat(frontend): mini graph preview components for workflow cards

PreviewNode is a compact pill (type label + accent dot) with invisible
handles so ReactFlow edges anchor correctly. WorkflowCardPreview
renders a non-interactive ReactFlow at 140px tall with all interaction
disabled and fitView. Empty / malformed graphs fall back to an
EmptyPreview placeholder."
```

---

## Task 7: Wire preview into workflows list page

**Files:**
- Modify: `packages/frontend/src/pages/workflows.tsx`

- [ ] **Step 1: Embed the preview in each card**

In `packages/frontend/src/pages/workflows.tsx`, add the import after the existing imports:

```ts
import { WorkflowCardPreview } from './workflows/workflow-card-preview'
```

Then replace the existing inner card markup:

```tsx
) : items.map((item) => (
  <div key={item.id} className='rounded-2xl border border-border bg-card p-5 space-y-3'>
    <div>
      <p className='text-base font-medium'>{item.name}</p>
      {item.description ? <p className='text-xs text-muted-foreground'>{item.description}</p> : null}
      <p className='mt-2 text-[11px] uppercase tracking-wider text-muted-foreground'>{statusLabel(item)}</p>
      <p className='text-xs text-muted-foreground'>
        {item.lastRun ? `Last run: ${item.lastRun.status}` : 'Never run'}
      </p>
    </div>
    <div className='flex flex-wrap gap-2'>
      <Button size='sm' variant='secondary' onClick={() => navigate({ page: 'workflow-editor', workflowId: item.id })}>Open</Button>
      <Button size='sm' disabled={!item.hasPublished} onClick={() => handleRun(item.id)}>Run</Button>
      <Button size='sm' variant='ghost' onClick={() => handleDelete(item.id)}>Delete</Button>
    </div>
  </div>
))}
```

With:

```tsx
) : items.map((item) => (
  <div key={item.id} className='overflow-hidden rounded-2xl border border-border bg-card flex flex-col'>
    <WorkflowCardPreview graphJson={item.previewGraph} />
    <div className='p-5 space-y-3'>
      <div>
        <p className='text-base font-medium'>{item.name}</p>
        {item.description ? <p className='text-xs text-muted-foreground'>{item.description}</p> : null}
        <p className='mt-2 text-[11px] uppercase tracking-wider text-muted-foreground'>{statusLabel(item)}</p>
        <p className='text-xs text-muted-foreground'>
          {item.lastRun ? `Last run: ${item.lastRun.status}` : 'Never run'}
        </p>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' variant='secondary' onClick={() => navigate({ page: 'workflow-editor', workflowId: item.id })}>Open</Button>
        <Button size='sm' disabled={!item.hasPublished} onClick={() => handleRun(item.id)}>Run</Button>
        <Button size='sm' variant='ghost' onClick={() => handleDelete(item.id)}>Delete</Button>
      </div>
    </div>
  </div>
))}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/workflows.tsx
git commit -m "feat(frontend): workflow cards embed graph preview

Each card shows a 140px-tall non-interactive preview of the workflow's
draft graph at the top, with the existing title/status/buttons beneath."
```

---

## Task 8: instagram-post result block

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/instagram-post.tsx`

- [ ] **Step 1: Replace the renderer**

Replace the entire contents of `packages/frontend/src/components/workflow-editor/executable-nodes/instagram-post.tsx` with:

```tsx
import { memo } from 'react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='3' y='3' width='18' height='18' rx='5' />
      <circle cx='12' cy='12' r='4' />
      <circle cx='17.5' cy='6.5' r='0.8' fill='currentColor' stroke='none' />
    </svg>
  )
}

export interface InstagramPostNodeData {
  source?: 'existing' | 'url'
  postId?: string
  url?: string
}

interface InstagramPostOutput {
  kind: 'instagramPost'
  post: {
    id: string
    caption?: string
    mediaPaths: string[]
    mediaErrors?: string[]
    metrics?: { likes?: number; comments?: number }
  }
}

function ResultSection({ output }: { output: InstagramPostOutput }) {
  const post = output.post
  return (
    <div className='mt-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-2'>
      {post.mediaPaths.length > 0 ? (
        <div className={`grid gap-2 ${post.mediaPaths.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {post.mediaPaths.slice(0, 4).map((p) => (
            <FileThumb key={p} path={p} />
          ))}
        </div>
      ) : null}
      {post.caption ? (
        <p className='line-clamp-3 text-xs leading-relaxed text-zinc-300'>{post.caption}</p>
      ) : null}
      {(post.metrics || post.mediaErrors) ? (
        <div className='flex flex-wrap gap-2 text-[10px] text-zinc-400'>
          {post.metrics?.likes != null && <span>♥ {post.metrics.likes}</span>}
          {post.metrics?.comments != null && <span>💬 {post.metrics.comments}</span>}
          {post.mediaErrors && post.mediaErrors.length > 0 && (
            <span className='text-amber-400'>⚠ {post.mediaErrors.length} media error{post.mediaErrors.length > 1 ? 's' : ''}</span>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const InstagramPostExecutableNode = memo(function InstagramPostExecutableNode({ id, data }: { id: string; data: InstagramPostNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as InstagramPostOutput | undefined
  return (
    <NodeShell
      icon={InstagramIcon}
      title='Instagram Post'
      subtitle={data.source === 'url' ? data.url ?? 'No URL' : data.postId ? `Captured: ${data.postId}` : 'No source selected'}
      accent='from-[#fd551d] via-[#ff6b35] to-[#ff9b7a]'
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>{data.source ?? 'unset'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-zinc-300'>{data.source === 'url' ? 'Captures via research-crawler' : 'Reads from captured_posts table'}</p>
      {output?.kind === 'instagramPost' ? <ResultSection output={output} /> : null}
    </NodeShell>
  )
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/instagram-post.tsx
git commit -m "feat(frontend): instagram-post node renders captured result"
```

---

## Task 9: image-video + transformer-media result blocks

Both executors return the same `{ kind: 'file', path, mimeType?, sizeBytes? }` shape (plus `origin` on imageVideo). Use a shared result block.

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/image-video.tsx`
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/transformer-media.tsx`

- [ ] **Step 1: Replace image-video**

Find the existing return-block in `packages/frontend/src/components/workflow-editor/executable-nodes/image-video.tsx`. At the top of the file add:

```ts
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'

interface FileOutput {
  kind: 'file'
  path: string
  mimeType?: string
  sizeBytes?: number
}
```

Inside the component, after `const runStatus = useNodeRunStatus(id)` (or equivalent), add:

```ts
  const output = useNodeRunOutput(id) as FileOutput | undefined
```

Then inside the `NodeShell` children, append after the existing body:

```tsx
{output?.kind === 'file' ? (
  <div className='mt-3 rounded-xl border border-white/10 bg-black/30 p-2'>
    <FileThumb path={output.path} />
    {output.mimeType ? <p className='mt-1 truncate text-[10px] text-zinc-500'>{output.mimeType}{output.sizeBytes ? ` · ${(output.sizeBytes / 1024).toFixed(1)} KB` : ''}</p> : null}
  </div>
) : null}
```

NOTE: the current file's exact structure may differ from this skeleton — open it first, locate the children inside `NodeShell`, and append the result block at the end of those children. Don't restructure unrelated code.

- [ ] **Step 2: Repeat for transformer-media**

Apply the same pattern to `packages/frontend/src/components/workflow-editor/executable-nodes/transformer-media.tsx`. The output shape is identical.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/image-video.tsx packages/frontend/src/components/workflow-editor/executable-nodes/transformer-media.tsx
git commit -m "feat(frontend): image-video + transformer-media render file thumb"
```

---

## Task 10: ocr-extractor result block

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/ocr-extractor.tsx`

- [ ] **Step 1: Add hook + result section**

In `packages/frontend/src/components/workflow-editor/executable-nodes/ocr-extractor.tsx`, add to imports:

```ts
import { useNodeRunOutput } from './_use-run-output'
```

Inside the component, add:

```ts
  const output = useNodeRunOutput(id) as { kind: 'text'; text: string } | undefined
```

Append inside the `NodeShell` children:

```tsx
{output?.kind === 'text' ? (
  <div className='mt-3 max-h-[160px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-2'>
    <pre className='whitespace-pre-wrap break-words text-[10px] text-zinc-300'>{output.text || '(empty)'}</pre>
  </div>
) : null}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/ocr-extractor.tsx
git commit -m "feat(frontend): ocr-extractor renders extracted text"
```

---

## Task 11: transformer-brief result block

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/transformer-brief.tsx`

- [ ] **Step 1: Add hook + result section**

In `packages/frontend/src/components/workflow-editor/executable-nodes/transformer-brief.tsx`, add imports:

```ts
import { useNodeRunOutput } from './_use-run-output'
import { JsonFallback } from './_json-fallback'
```

Inside the component:

```ts
  const output = useNodeRunOutput(id) as { kind: 'json'; value: unknown } | undefined
```

Append inside the `NodeShell` children:

```tsx
{output?.kind === 'json' ? <JsonFallback value={output.value} /> : null}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/transformer-brief.tsx
git commit -m "feat(frontend): transformer-brief renders rendered JSON"
```

---

## Task 12: table result block

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/table.tsx`

- [ ] **Step 1: Add hook + result section**

In `packages/frontend/src/components/workflow-editor/executable-nodes/table.tsx`, add imports:

```ts
import { useNodeRunOutput } from './_use-run-output'
```

Inside the component:

```ts
  const output = useNodeRunOutput(id) as { kind: 'table'; rows: Array<Record<string, unknown>> } | undefined
```

Helper near the top of the file:

```ts
function previewCell(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value).slice(0, 40)
}
```

Append inside the `NodeShell` children:

```tsx
{output?.kind === 'table' && output.rows.length > 0 ? (() => {
  const cols = Object.keys(output.rows[0] ?? {}).slice(0, 4)
  return (
    <div className='mt-3 overflow-hidden rounded-xl border border-white/10'>
      <table className='w-full text-left text-[10px]'>
        <thead className='bg-white/[0.06] uppercase tracking-wider text-zinc-400'>
          <tr>{cols.map((c) => <th key={c} className='px-2 py-1'>{c}</th>)}</tr>
        </thead>
        <tbody className='divide-y divide-white/10'>
          {output.rows.slice(0, 3).map((row, i) => (
            <tr key={i}>{cols.map((c) => <td key={c} className='px-2 py-1 text-zinc-300'>{previewCell((row as Record<string, unknown>)[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {output.rows.length > 3 ? <p className='border-t border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] text-zinc-500'>+ {output.rows.length - 3} more rows</p> : null}
    </div>
  )
})() : null}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/table.tsx
git commit -m "feat(frontend): table renders first 3 rows + overflow count"
```

---

## Task 13: ai-agent-conversation result block

**Files:**
- Modify: `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`

- [ ] **Step 1: Add hook + result section**

In `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`, add imports:

```ts
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'
```

Inside the component:

```ts
  const output = useNodeRunOutput(id) as
    | { kind: 'aiAgent'; conversationId: string; messageId: string; text: string; data?: unknown; paths?: string[] }
    | undefined
```

Append inside the `NodeShell` children:

```tsx
{output?.kind === 'aiAgent' ? (
  <div className='mt-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-2'>
    {output.paths && output.paths.length > 0 ? (
      <div className={`grid gap-2 ${output.paths.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {output.paths.slice(0, 4).map((p) => <FileThumb key={p} path={p} />)}
      </div>
    ) : null}
    <p className='line-clamp-4 text-xs leading-relaxed text-zinc-300'>{output.text || '(no text)'}</p>
    <a
      href={`#/conversations/${encodeURIComponent(output.conversationId)}`}
      className='block text-[10px] font-medium text-[#fd551d] hover:underline'
    >
      Open chat →
    </a>
  </div>
) : null}
```

NOTE: the conversation-open link uses hash-based routing. If the app's navigation uses a different scheme (`useNavigation`), import that hook and replace the `<a href>` with a `<button onClick={() => navigate({ page: 'active-conversation', conversationId: output.conversationId })}>` — open `packages/frontend/src/lib/navigation.ts` to confirm.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx
git commit -m "feat(frontend): ai-agent-conversation renders envelope + open chat link"
```

---

## Task 14: Whole-repo verify + push

- [ ] **Step 1: Repo typecheck**

Run: `pnpm typecheck`
Expected: PASS across all 9 packages.

- [ ] **Step 2: Repo tests**

Run: `pnpm test`
Expected: all green. New tests in this plan:
- `packages/backend/tests/workflow-artifacts.test.ts` (4 tests)

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Task 15: Manual smoke test

This step is a verification, not a code change.

- [ ] **Step 1: Boot the desktop dev loop**

Run: `pnpm dev`
Expected: Electron window opens.

- [ ] **Step 2: Verify card preview**

Open `/workflows` page. For each existing workflow:
- The card has a ~140px tall preview at the top
- Preview shows compact pills for each node, connected by edges
- Workflows with no nodes show the "No nodes yet" placeholder
- Status text, buttons, and click-to-open behavior still work

- [ ] **Step 3: Verify per-node result rendering**

Build / open a workflow chain that exercises several executors:
1. `Image / Video` (local file)
2. `OCR Extractor` from Image/Video
3. `Transformer · Brief` referencing OCR output (e.g. `{"summary":"{{ocr.text}}"}`)
4. `AI Agent · Conversation` with a simple prompt and Image/Video upstream

Publish + run. After the run completes, each node should show its result block:
- Image/Video → thumbnail of the local file
- OCR → extracted text in a fenced block
- Transformer · Brief → JSON pretty-print
- AI Agent → envelope text + "Open chat →" link (and paths if the AI produced any)

- [ ] **Step 4: Verify artifact route directly**

Open the run's spawned Instagram Post (if you have one) — its media should display (via the artifact route).

In browser devtools network tab, find a `GET /workflows/artifacts?path=...` request — confirm 200 with correct content-type.

If anything fails, file fixes against the originating task.

---

## Self-review notes

- **Spec coverage:** card preview (Tasks 2, 3, 6, 7), useNodeRunOutput hook (Task 4), JsonFallback (Task 4), FileThumb + artifact route (Tasks 1, 3, 5), per-renderer result blocks (Tasks 8-13). All covered.
- **Type consistency:** every renderer reads its output via `useNodeRunOutput(id) as <ExecutorOutputType> | undefined` and gates with `output?.kind === '<kind>'`. `kind` discriminators match the executor return types verified before writing the plan.
- **No placeholders:** every code-changing step contains the actual code. The two NOTE blocks in Tasks 1, 9, and 13 flag points where the existing file shape may differ — the engineer locates the right insertion point first. That is concrete guidance, not a placeholder.
