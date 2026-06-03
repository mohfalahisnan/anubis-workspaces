# Workflow Node Library — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `packages/frontend` — new `components/workflow/` folder + one new demo route wired through `lib/navigation.tsx` and `components/dashboard/index.tsx`.
**Reference:** `C:\Users\User\Downloads\content_workflow_react_flow_preview.jsx` (9-node Anubis content pipeline preview built on the older `reactflow` v11 API).

## Problem

The Anubis frontend uses `@xyflow/react` (v12) and ships a small set of generic flow primitives in `components/ai-elements/` (`canvas.tsx`, `node.tsx`, `edge.tsx`), but no pages consume them and there are no domain-shaped nodes for the Anubis content workflow. The downloaded reference shows the shape we want — Instagram post → crawler → transformer → OCR/transcript → context builder → executor → review → ready-to-post, with multi-source fan-in to the context builder and an approve/reject fan-out from review — but the file is a single self-contained preview using the v11 API, hand-rolled SVG icons, and hard-coded dark theme colors.

We need a small **reusable workflow-node library** that:

1. Lives inside `packages/frontend` and can be imported from any future page/feature.
2. Uses `@xyflow/react` v12 (the project's installed version).
3. Supports **multiple inputs and outputs per node** via the reference's "virtual fan-out" mechanism (one real `Handle` per side, custom edge with visual offsets).
4. Ships nine specialized nodes built on a shared `NodeShell` primitive — matching the reference's set so the Anubis content pipeline can be assembled from named building blocks.
5. Themes through shadcn tokens for structure (so light/dark mode works) while preserving the Anubis orange (`#fd551d`) as the workflow accent.
6. Is verified by a single demo route with a **gallery** (every node standalone) plus a **wired flow** (the 9-node Anubis pipeline using `SeparatedEdge`).

## Goals

1. New folder `packages/frontend/src/components/workflow/` containing the primitive, helpers, nine nodes, and a demo page.
2. `NodeShell` primitive with a small, typed prop surface (`icon`, `title`, `subtitle?`, `accent?`, `footer?`, `children`, `className?`, `disableMotion?`).
3. Nine specialized nodes — each a thin wrapper around `NodeShell` with its own typed `data` shape and a default `accent`:
   `InstagramPostNode`, `TransformerNode`, `TextNode`, `TableNode`, `SearchNode`, `ContextBuilderNode`, `AIAgentNode`, `AgentReviewNode`, `FinalContentNode`.
4. `SeparatedEdge` + `applyVisualEdgeRouting` helper ported from the reference, adapted to `@xyflow/react` v12 typings and exported as part of the public API.
5. Shared sub-primitives: `StatusBadge` (footer chips) and the IN/OUT `<Handle>` pair (`handles.tsx`).
6. Lucide icons throughout (instead of the reference's hand-rolled `createIcon` SVG factory).
7. A demo route `workflow-demo` reachable via `navigate({ page: 'workflow-demo' })`, rendered by the existing dashboard switch. Two tabs: **Gallery** (3-column grid of standalone nodes) and **Wired flow** (full-height ReactFlow rendering the 9-node Anubis pipeline with `SeparatedEdge`, Background, Controls, MiniMap).
8. A single `demo/sample-data.ts` that both tabs consume — no duplicated fixtures.
9. Each node's data type exported (e.g. `InstagramPostNodeData`) so consumers get autocomplete.

## Non-goals

- A production workflow page or any persistence/serialization of graphs. The library is the deliverable.
- Typed multi-handles (named ports per side). The library uses the virtual fan-out model: one real handle per side, visual offsets in the edge. Decided in brainstorming.
- The reference's `TypeLegend` filter chips and `WorkflowTestPanel` runtime-check panel — useful for the standalone preview, not for a reusable library. Easy to add later.
- A sidebar entry for the demo. The route is wired only through `navigate(...)`; no nav surface.
- A generic graph editor (palette, add/delete UI). Out of scope per the brainstorming "Option A" choice.
- Migrating or replacing the existing `components/ai-elements/canvas.tsx|node.tsx|edge.tsx` primitives. They stay untouched.

## Architecture

### File layout

```
packages/frontend/src/components/workflow/
├── index.ts                    # public exports
├── theme.ts                    # WORKFLOW_ACCENT, default gradient presets
├── node-shell.tsx              # NodeShell primitive
├── handles.tsx                 # NodeDirectionalHandles (one IN, one OUT)
├── status-badge.tsx            # shared footer chip
├── separated-edge.tsx          # SeparatedEdge + applyVisualEdgeRouting
├── node-types.ts               # workflowNodeTypes map (id → component)
├── edge-types.ts               # workflowEdgeTypes map
├── nodes/
│   ├── instagram-post-node.tsx
│   ├── transformer-node.tsx
│   ├── text-node.tsx
│   ├── table-node.tsx
│   ├── search-node.tsx
│   ├── context-builder-node.tsx
│   ├── ai-agent-node.tsx
│   ├── agent-review-node.tsx
│   └── final-content-node.tsx
└── demo/
    ├── workflow-demo-page.tsx
    └── sample-data.ts
```

Routing changes (outside the folder):

- `packages/frontend/src/lib/navigation.tsx` — add `| { page: 'workflow-demo' }` to the `Route` union.
- `packages/frontend/src/components/dashboard/index.tsx` — add a `case 'workflow-demo'` that renders `<WorkflowDemoPage />`.

### `NodeShell` primitive

```tsx
type NodeShellProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  accent?: string              // tailwind gradient classes, e.g. "from-[#fd551d] to-[#ff9b7a]"
  footer?: React.ReactNode
  children?: React.ReactNode
  className?: string
  disableMotion?: boolean      // skip framer-motion entry fade if needed
}
```

Behavior:

- Width fixed at `w-[360px]` (matches the reference); height varies with content.
- Renders one real `Handle` per side via `NodeDirectionalHandles` — `id="in-main"` on the left (`type="target"`), `id="out-main"` on the right (`type="source"`). Visible badge text ("IN" / "OUT") matches the reference style.
- Surface uses shadcn tokens: `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground` for the subtitle and small text. The 1px top bar is the only place the accent gradient lives by default. The icon tile inherits a translucent tint of the accent (a CSS variable `--workflow-accent` set per-node via inline style derived from `accent`, with `#fd551d` as the fallback).
- Wraps content in `motion.div` with a small fade-up (`initial: { opacity: 0, y: 8 }` → `animate: { opacity: 1, y: 0 }`, 0.25s) by default. `disableMotion` skips the wrapper.
- Optional `footer` is divided from the body with a 1px `border-border` rule.

### Specialized nodes

Each node is a `memo()`'d component named `<NodeName>` that:

1. Declares its `data` type (e.g. `InstagramPostNodeData`).
2. Returns `<NodeShell icon={…} title={…} subtitle={…} accent={…} footer={…}> {body} </NodeShell>`.
3. Defaults its `accent` to a Anubis-flavored gradient (the reference's per-node values, e.g. `from-[#fd551d] to-[#ff9b7a]` for the InstagramPost, `from-[#fd551d] to-[#8b5cf6]` for the Video/Reel transformer variant, etc.).

Data shapes mirror the reference (one example):

```ts
type InstagramPostNodeData = {
  account: string
  caption: string
  imageUrl: string
  metrics: { likes: string }
}
```

Notable per-node body details (kept identical to the reference, since the design point is "library that ships the reference's nodes"):

- **InstagramPostNode** — image header + author row + caption, footer with "OCR ready" + "Transcript ready" + likes count badges.
- **TransformerNode** — `kind: "media" | "brief"` branch: media variant shows image + video side-by-side; brief variant shows label/value rows.
- **TextNode** — single text body with a footer badge. Used for crawler, OCR/transcript extractor, brand guideline.
- **TableNode** — `rows: { source, type, score }[]` rendered as a styled table.
- **SearchNode** — list of `{ title, score, summary }` plus latency footer badge.
- **ContextBuilderNode** — list of `{ label, source, value }` "brief" rows.
- **AIAgentNode** — list of step strings, footer mode badge.
- **AgentReviewNode** — `checks: { label, description, pass }[]` rendered as a 2-column grid.
- **FinalContentNode** — title + caption + 3-column format/channel/status footer.

### Handles + multi-IO

```tsx
function NodeDirectionalHandles() {
  return (
    <>
      <Handle id="in-main" type="target" position={Position.Left} className={handleClass}>
        <span>IN</span>
      </Handle>
      <Handle id="out-main" type="source" position={Position.Right} className={handleClass}>
        <span>OUT</span>
      </Handle>
    </>
  )
}
```

`handleClass` keeps the reference's visual treatment (large rounded badge in accent orange with a dark border). React Flow allows multiple edges per handle, so multi-source/multi-target works at the graph level without any node changes. The visual separation is the job of `SeparatedEdge`.

### `SeparatedEdge` + routing helper

`applyVisualEdgeRouting(edges)` — pure helper that:

1. Groups edges by `source` and separately by `target`.
2. For each edge, computes a centered y-offset `(index − (groupSize − 1) / 2) * gap` (default `gap = 42`) for both ends.
3. Returns a new array where each edge gains `data: { sourceOffset, targetOffset, hasSourceSiblings, hasTargetSiblings }`. Other edge fields are preserved.

`SeparatedEdge` — custom edge component that:

1. Reads `data.sourceOffset` / `data.targetOffset` (defaulting to 0 when no siblings).
2. Computes a cubic bezier from `(sourceX, sourceY + sourceOffset)` to `(targetX, targetY + targetOffset)`, with control distance `clamp(distance * 0.42, 120, 320)`.
3. Renders the bezier with `BaseEdge`, plus an optional `label` via `EdgeLabelRenderer`.
4. Injects the `@keyframes workflowLineDash` keyframe once (matches the reference's animated dashed look).

`workflowEdgeDefaults` exports the standard edge style preset (animated dashed off-white stroke, `type: "separated"`, no marker end).

Consumer pattern:

```tsx
const routedEdges = useMemo(() => applyVisualEdgeRouting(edges), [edges])
<ReactFlow nodes={nodes} edges={routedEdges}
  nodeTypes={workflowNodeTypes} edgeTypes={workflowEdgeTypes} ... />
```

### Theming

`theme.ts` exports:

```ts
export const WORKFLOW_ACCENT = '#fd551d'
export const ACCENT_GRADIENTS = {
  default: 'from-[#fd551d] to-[#ff9b7a]',
  media:   'from-[#fd551d] to-[#8b5cf6]',
  data:    'from-[#fd551d] to-[#3b82f6]',
  review:  'from-[#fd551d] to-[#22c55e]',
  warning: 'from-[#fd551d] to-[#f59e0b]',
  final:   'from-[#fd551d] via-[#ff7a45] to-[#fefefe]',
}
```

Each node picks a sensible default from this map; consumers can override per instance via the `accent` prop. All other surfaces use shadcn tokens so the workflow plays nicely with the app's existing dark/light themes.

### Demo route

`workflow-demo-page.tsx`:

- Header with title and a 2-tab segmented control (Gallery / Wired flow).
- **Gallery tab** — 3-column responsive grid, each cell wraps one node in a `ReactFlowProvider` + `ReactFlow` (no edges, single node, `fitView`, no controls/minimap, fixed-height container). This isolates each node so handles/layout can be inspected without graph noise.
- **Wired flow tab** — full-remaining-height `ReactFlow` rendering the 9-node Anubis pipeline (positions matching the reference x-coordinates 0 / 440 / 880 / 1320 / 1760 / 2200 / 2640 / 3080 / 3520, with brand-guideline / knowledge-base / similarity-context stacked vertically around the context builder). Includes `Background`, `Controls`, `MiniMap`, `fitView` on mount. Uses `applyVisualEdgeRouting` to drive `SeparatedEdge`.

`demo/sample-data.ts` exports:

- `sampleNodeData` — one realistic data object per node type, used by both the gallery and the wired flow.
- `sampleFlowNodes` / `sampleFlowEdges` — the 12 nodes + 12 edges that compose the reference pipeline (including the rejection loop edge back from `agent-review` → `ai-context-builder`).

Both tabs read from the same module — fixtures stay in one place.

## Data flow

The library has no runtime state beyond what React Flow holds. The wired-flow demo uses the standard `useNodesState` / `useEdgesState` hooks. Nodes render purely from their `data` prop. Edges render purely from their `data.sourceOffset` / `data.targetOffset` (stamped once via `applyVisualEdgeRouting`).

## Testing & verification

This is a UI-only library with no business logic, so verification is visual:

1. `pnpm typecheck` passes — all exported data shapes are typed.
2. `pnpm --filter @anubis/frontend dev` (via the desktop `pnpm dev` loop) launches; `navigate({ page: 'workflow-demo' })` from devtools shows the demo route.
3. Gallery tab: every one of the nine nodes renders standalone with its sample data; IN/OUT handle badges are visible.
4. Wired flow tab: all 12 edges render; the context builder visibly shows 4 lines fanning into its left side without overlapping; agent-review's right side shows 2 fanned-out lines (approved → ready, rejected → loop back). `fitView` centers the graph; MiniMap reflects layout.
5. Theme: toggle dark/light at the app level (existing `ModeToggle`) — node surfaces flip with the theme; the orange accent remains.

No automated tests in this iteration. If the library is later promoted to a production page, snapshot tests for `applyVisualEdgeRouting` (pure function) would be a sensible first add.

## Risks & open questions

- **`@xyflow/react` v12 vs reference's `reactflow` v11.** APIs are largely compatible (named exports moved from `reactflow` to `@xyflow/react`, `useNodesState`/`useEdgesState` unchanged, custom edge component contract identical). The reference's `BaseEdge` / `EdgeLabelRenderer` / `Handle` / `Position` / `Background` / `Controls` / `MiniMap` are all available under `@xyflow/react`. No expected blockers, but the implementation plan should validate each import early.
- **Motion + React Flow node transforms.** React Flow applies its own `transform` to each node wrapper for positioning. Wrapping content in `motion.div` is safe (the motion happens inside RF's transform), but if any visual jitter appears during pan/zoom we'll switch to a CSS-only fade and drop the motion wrapper. The `disableMotion` prop is the escape hatch.
- **Image sources in sample data.** The reference uses Unsplash URLs and a public MDN sample video. These require network access at demo time; if the Electron renderer is run offline they'll show broken images. Acceptable for a demo route — flagged so it's not a surprise.
- **Hard-coded accent palette.** `ACCENT_GRADIENTS` uses literal hex values. If the project later defines a `--workflow-accent` CSS variable in `index.css`, the constants can be promoted to that variable in a follow-up without API change.
