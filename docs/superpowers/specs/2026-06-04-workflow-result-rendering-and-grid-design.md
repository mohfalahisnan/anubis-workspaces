# Workflow Result Rendering + Card Preview — Design

**Date:** 2026-06-04
**Status:** Approved (pending implementation)
**Sister spec:** A follow-up spec will cover the Trigger node, JSON Transformer node, and the URL-only Instagram Post refactor. Those build on this foundation.

## Background

Two related deficits in the workflow editor today:

1. **Workflow list page looks sparse.** Each card just shows title + status text and stretches to fill its grid cell. With only a couple of workflows the page feels empty.
2. **Nodes don't show their results.** A node turning green means "succeeded" but the user has no way to see what the node actually produced without opening the inspector panel or re-running. The attached `content_workflow_react_flow_preview.jsx` shows the target style: each node renders its output inline (post images and captions, video posters, structured rows, AI envelope text).

## Goals

- Workflow card on the list page embeds a mini ReactFlow graph preview (~140px tall, draft graph) so each card carries the workflow's structure at a glance.
- Each executable node renderer (7 today) reads its succeeded step output via a shared hook and renders a per-type result block inside the node body.
- Local media files produced by executors (Instagram artifacts, image-video inputs, transformer outputs) are reachable from the renderer via a backend artifact route — no `file://` security gymnastics in Electron.

## Non-goals

- Trigger node, JSON Transformer node, Instagram Post URL-only refactor — sister spec.
- A separate inspector view of node output. Output rendering lives in the node body only.
- Real-time partial output streaming inside the node. We render after `node-succeeded`; partials stay in the existing run-event channel.
- Editing/exporting the rendered result. Display-only.

## Architecture

### Section A — Workflow card preview

#### API change

`packages/backend/src/workflow.ts` list route (`GET /workflows`) adds `previewGraph: string` to each summary. The repo's `list()` already returns `Workflow[]` which includes `draftGraph`; the route just forwards it:

```ts
return {
  // ...existing fields...
  previewGraph: wf.draftGraph,
}
```

No DB query change, no new endpoint. We prefer `draftGraph` over `publishedGraph` because every workflow has a draft (the editor saves continuously) but not every workflow is published.

Frontend type:

```ts
// packages/frontend/src/api/workflows.ts
export interface WorkflowSummary {
  // ...existing fields...
  previewGraph: string  // JSON-stringified WorkflowGraph (draft)
}
```

#### Preview node renderer

Mini graph nodes are NOT the full executable renderers — those have framer-motion entry animations, full footers, sometimes media. Rendering 7+ of them per card per row at small scale is wasteful and visually busy.

`packages/frontend/src/pages/workflows/preview-node.tsx` is a simplified, fixed-size pill:

- ~120 × 32 px
- Border + bg matching the editor theme
- Shows the node's type-display-name (e.g. `"Instagram Post"`, `"AI Agent · Conv."`) — short labels truncate
- Tiny accent dot on the left (color from a per-type table)
- No handles, no footer, no animation, no result block

The `previewNodeTypes` map registers `PreviewNode` for every type the editor knows about, so any node a user has placed renders without falling back to the default `<div>`.

#### Card preview component

`packages/frontend/src/pages/workflows/workflow-card-preview.tsx`:

```tsx
export function WorkflowCardPreview({ graphJson }: { graphJson: string }) {
  const graph = useMemo(() => JSON.parse(graphJson) as WorkflowGraph, [graphJson])
  if (graph.nodes.length === 0) {
    return <EmptyPreview />
  }
  return (
    <div className='h-[140px] w-full overflow-hidden rounded-xl border border-border bg-[#0b0b0c]/60'>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={previewNodeTypes}
        edgeTypes={previewEdgeTypes}
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

`previewEdgeTypes` is `{ separated: SimplePreviewEdge }` (a plain bezier, no animation) — the editor's animated edges would be distracting in a list of cards.

`EmptyPreview` is a flat `"No nodes yet"` placeholder in the same box.

#### Page integration

`packages/frontend/src/pages/workflows.tsx` keeps its existing `grid gap-4 md:grid-cols-2 xl:grid-cols-3` outer wrapper. Each card now reads:

```tsx
<div className='rounded-2xl border border-border bg-card overflow-hidden flex flex-col'>
  <WorkflowCardPreview graphJson={item.previewGraph} />
  <div className='p-5 space-y-3'>
    {/* existing title, status, buttons */}
  </div>
</div>
```

### Section B — Per-node result rendering

#### Shared hook

`packages/frontend/src/components/workflow-editor/executable-nodes/_use-run-output.ts`:

```ts
import { useEditorStore } from '../editor-store'

export function useNodeRunOutput(nodeId: string): unknown {
  return useEditorStore((s) => s.activeRun?.steps[nodeId]?.output)
}
```

Mirrors the existing `_use-run-status.ts`.

#### Per-renderer result blocks

Each of the 7 executable node renderers reads its output via the hook and renders a result section when output is present. The renderer knows its own output shape (executors return `{ kind, ... }` typed objects); no central switch / discriminator.

Concrete shape per renderer:

| Renderer | Output type (from executor) | Result block |
|---|---|---|
| `instagram-post` | `{ kind: 'instagramPost', post: { caption, mediaPaths, metrics, mediaErrors? } }` | Up to 3 media thumbnails in a row + clamped caption + likes/comments badges + (if any) media-error count |
| `image-video` | `{ kind: 'imageVideo', items: [{ kind: 'image'\|'video', path }] }` (verify in implementation) | Thumbnail row, 2 columns |
| `ocr-extractor` | `{ kind: 'text', text }` (verify) | `<pre>` block with extracted text, line-clamp-6 |
| `transformer-brief` | `{ kind: 'json', value }` | JSON pretty-printed, ~6 visible lines, scrollable |
| `transformer-media` | `{ kind: 'media', paths }` (verify) | Thumbnail row |
| `table` | `{ kind: 'table', rows }` (verify) | First 3 rows in a tight table |
| `ai-agent-conversation` | `{ kind: 'aiAgent', conversationId, text, data?, paths? }` | Text snippet (line-clamp-4) + paths count + "Open chat →" link |

Block visual style matches the reference JSX: rounded box, dark bg, small padding, ~140-200px tall, slot below the existing node body.

When the executor's output shape isn't certain (the table above marks `verify`), the implementing engineer reads `packages/workflow-runtime/src/executors/<name>.ts` and uses the actual return type. If a shape doesn't match what the renderer needs, that's logged as a deficiency and falls back to a `<JsonFallback>` (pretty-print the raw object).

Fallback `<JsonFallback>` lives next to the hook — used for any renderer that hasn't yet got a bespoke result block. Lets us ship the foundation without all 7 bespoke views landing simultaneously.

#### File asset display

Image / video paths returned by executors are absolute local filesystem paths under the run's artifact directory. Electron's renderer can't load `file://` URLs directly.

`<FileThumb>` (new shared component in `packages/frontend/src/components/workflow/file-thumb.tsx`):

- Takes `path: string`
- Renders `<img>` or `<video>` based on extension (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` → img; `.mp4`, `.mov`, `.webm` → video poster; everything else → file-icon + filename)
- `src` is built via a new helper `artifactUrl(path)` that hits the backend (see next subsection)

#### Backend artifact route

`packages/backend/src/workflow.ts` adds:

```ts
workflowRoutes.get('/runs/:runId/artifacts/*', async (c) => {
  // ...streams the file under {dataDir}/workflow-runs/{runId}/... with proper content-type
})
```

Wait — this route requires the renderer to know `runId`, which renderers don't have direct access to (they have `nodeId`). Two options:

1. **Path-keyed route** — `GET /artifacts?path=<absolute-path>` that validates the path is under `{dataDir}/workflow-runs` (no `..` escape) and streams it. Renderer just passes the path it got from the executor output.
2. **runId-keyed route** — renderer fetches `runId` from the editor store's `activeRun.runId` and builds `/workflow-runs/:runId/artifacts/<relative-path>`.

Option 1 is simpler and decouples the renderer from the run id. Path-traversal is prevented by `path.normalize` + `startsWith(allowedRoot)`. Going with Option 1.

```ts
const ARTIFACT_ROOT_REL = 'workflow-runs'

workflowRoutes.get('/artifacts', async (c) => {
  const requested = c.req.query('path')
  if (!requested) return c.json({ error: 'missing path' }, 400)
  const root = join(getDataDir(), ARTIFACT_ROOT_REL)
  const resolved = resolve(requested)
  if (!resolved.startsWith(root + sep) && resolved !== root) {
    return c.json({ error: 'forbidden' }, 403)
  }
  return c.body(createReadStream(resolved), 200, {
    'Content-Type': mimeFor(resolved),
    'Cache-Control': 'private, max-age=300',
  })
})
```

`mimeFor` is a small inline switch on the extension (jpeg, png, mp4, webm, etc.).

Frontend helper `artifactUrl(path)`:

```ts
export async function artifactUrl(path: string): Promise<string> {
  const base = await getApiBaseUrl()
  return `${base}/workflows/artifacts?path=${encodeURIComponent(path)}`
}
```

### Section C — Wiring sequence

1. New file: `_use-run-output.ts`
2. New file: `file-thumb.tsx` + `artifactUrl()` helper
3. Backend artifact route + tests
4. Workflow list route extension (return `previewGraph`)
5. New files: `preview-node.tsx`, `workflow-card-preview.tsx`
6. `workflows.tsx` page wires preview into card
7. Per-renderer result blocks (7 small modifications)

Each step is independent enough to land as its own commit.

## Data flow

```
Executor returns typed output ──► Runner emits node-succeeded { output } ──►
WorkflowRunManager publishes via SSE ──► Frontend openRunEventStream ──►
applyRunEvent stores in editor-store.activeRun.steps[nodeId].output ──►
useNodeRunOutput(nodeId) reads it ──► Per-renderer <ResultSection> shows it
                                                       │
                                                       └── file paths → <FileThumb>
                                                             └── artifactUrl(path) → /workflows/artifacts?path=...
```

## Error handling

- **Missing `previewGraph` on a workflow row** — defensive: the new field is required on `WorkflowSummary`. Backend always sets it (`draftGraph` is `NOT NULL` in the schema based on the route shape today). If a test fixture lacks it, default to `'{"nodes":[],"edges":[]}'`.
- **Malformed `previewGraph` JSON** — `JSON.parse` in `<WorkflowCardPreview>` runs inside a try/catch; on failure, render `<EmptyPreview />`.
- **Artifact route — path escape attempt** — 403, no body details, no logged path (avoid leaking attempted traversal targets).
- **Artifact route — missing file** — 404 with `{ error: 'not_found' }`.
- **Renderer — unexpected output shape** — `<JsonFallback>` shows the raw object. Renderer never throws.

## Testing

**Unit tests**

- `packages/frontend/__tests__/workflow-card-preview.test.tsx` (or co-located) — renders graph with N nodes, asserts the right number of `<PreviewNode>` instances; renders `<EmptyPreview>` for `{ nodes: [], edges: [] }`; renders `<EmptyPreview>` for malformed JSON.
- `packages/backend/tests/workflow-artifacts.test.ts` — 200 on valid path, 403 on `..` escape, 404 on missing.
- `packages/frontend/__tests__/use-run-output.test.tsx` — returns step output when set; returns `undefined` when no active run; updates when store updates.

**Manual smoke**

- Open `/workflows` with at least one workflow — confirm preview shows graph nodes
- Open a workflow editor, run it — after success each node shows its result block
- Verify IG post media thumbnails load (artifact route works)
- Verify AI Agent node shows envelope text and "Open chat →" link

## File change list

**Modified**

- `packages/backend/src/workflow.ts` — list returns `previewGraph`; new artifact route
- `packages/frontend/src/api/workflows.ts` — `previewGraph` on type
- `packages/frontend/src/pages/workflows.tsx` — embed preview
- `packages/frontend/src/components/workflow-editor/executable-nodes/instagram-post.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/image-video.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/ocr-extractor.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/transformer-brief.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/transformer-media.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/table.tsx`
- `packages/frontend/src/components/workflow-editor/executable-nodes/ai-agent-conversation.tsx`

**New**

- `packages/frontend/src/components/workflow-editor/executable-nodes/_use-run-output.ts`
- `packages/frontend/src/components/workflow-editor/executable-nodes/_json-fallback.tsx`
- `packages/frontend/src/components/workflow/file-thumb.tsx`
- `packages/frontend/src/pages/workflows/workflow-card-preview.tsx`
- `packages/frontend/src/pages/workflows/preview-node.tsx`
- `packages/frontend/src/lib/artifacts.ts` — `artifactUrl(path)` helper

## Open trade-offs

- **Preview uses draft graph, not published.** Draft is always present; reflects what the user is currently working on. If we ever want "what would run if I clicked Run" we can flip to `publishedGraph ?? draftGraph` — easy change later.
- **Path-keyed artifact route over runId-keyed.** Simpler for renderers; trades that for a strict path-allowlist on the server. Worth it.
- **`<JsonFallback>` is a deliberate escape hatch.** It lets us ship the foundation without all 7 bespoke result blocks landing at once. Implementation can prioritize the high-value ones (IG, image-video, AI agent) and use the fallback elsewhere first.
- **Result rendering is post-success only.** Streaming partials inside the node body was tempting but would require more state plumbing and adds visual jitter. The existing run-event channel already streams; the chat UI consumes it.
