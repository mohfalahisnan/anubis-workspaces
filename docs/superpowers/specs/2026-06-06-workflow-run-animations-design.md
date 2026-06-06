# Workflow Run-State Animations — Design

**Date:** 2026-06-06
**Status:** Approved (design)
**Scope:** Visual run-state feedback in the workflow editor — animate the connectors
along the active path while a run is in progress, give the executing node an animated
glow, and dim nodes that haven't run yet. Frontend only.

## Problem

While a workflow runs, the editor gives weak feedback about where execution is:

- **Edges** already render an always-on marching-ants dash (`separated-edge.tsx`
  `workflowEdgeDefaults`), but it's not tied to the run — it animates identically at
  rest and while running, so it doesn't show the live path.
- **Node glow** exists for `running`/`awaiting` (`node-shell.tsx` `RUN_STATUS_BORDER`)
  but uses Tailwind `animate-pulse`, which fades the whole node's opacity rather than
  animating a halo.
- **Not-yet-run nodes** are not visually distinguished — nothing dims them.

Run state is fully available in the editor store: `activeRun.status`
(`running` | `awaiting_approval` | terminal) and
`activeRun.steps[nodeId].status` (`pending` | `running` | `awaiting` | `succeeded` |
`failed` | `skipped`).

## Decisions

- **Edge animation:** *active path only; idle static.* During a run, an edge flows when
  its source node has finished and its target is the live/next node; not-yet-reached
  edges dim; completed edges go quiet. When no run is in progress, edges are static
  (no animation).
- **Node glow:** an animated halo (box-shadow breathing) on `running`/`awaiting`,
  replacing the opacity-fading `animate-pulse`.
- **Dimming:** during a run, nodes that are not-yet-run (`pending`/not-started) or
  `skipped` (branch not taken) drop to 40% opacity. Full opacity at rest and after the
  run finishes.
- **Where:** centralized in the canvas via pure helpers, layered onto display copies of
  nodes/edges. Rejected: distributing run-state styling into each node/edge component.

## Components

### `packages/frontend/src/components/workflow/run-visuals.ts` (new, pure)
```ts
import type { CSSProperties } from 'react'
import type { NodeRunStatus } from './node-shell'   // 'pending'|'running'|'awaiting'|'succeeded'|'failed'|'skipped'

type RunStatusLike = { status: 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled' } | null | undefined

export type EdgeRunState = 'idle' | 'flowing' | 'settled' | 'dim'

export function isRunInProgress(run: RunStatusLike): boolean
//  → run?.status === 'running' || run?.status === 'awaiting_approval'

export function nodeDimmed(status: NodeRunStatus | undefined, inProgress: boolean): boolean
//  → inProgress && (status === undefined || status === 'pending' || status === 'skipped')

export function edgeRunState(
  source: NodeRunStatus | undefined,
  target: NodeRunStatus | undefined,
  inProgress: boolean,
): EdgeRunState
//  !inProgress                                           → 'idle'
//  source==='succeeded' && target ∈ {running,awaiting,pending,undefined} → 'flowing'
//  source==='succeeded' && target ∈ {succeeded,failed}   → 'settled'
//  otherwise                                             → 'dim'

export const EDGE_RUN_STYLE: Record<EdgeRunState, CSSProperties>
```

`EDGE_RUN_STYLE` values:
- **idle:** `{ strokeWidth: 2, stroke: 'var(--anubis-gold)', strokeOpacity: 0.5 }` (solid, no animation).
- **flowing:** `{ strokeWidth: 2.5, stroke: 'var(--anubis-gold-hi)', strokeOpacity: 1, strokeDasharray: '10 8', animation: 'workflowLineDash 700ms linear infinite' }`.
- **settled:** `{ strokeWidth: 2, stroke: 'var(--anubis-gold)', strokeOpacity: 0.55 }`.
- **dim:** `{ strokeWidth: 2, stroke: 'var(--anubis-gold)', strokeOpacity: 0.16 }`.

### `packages/frontend/src/components/workflow-editor/editor-canvas.tsx`
- Subscribe: `const activeRun = useEditorStore((s) => s.activeRun)`.
- `const inProgress = isRunInProgress(activeRun)`, `const steps = activeRun?.steps`.
- `displayNodes = useMemo(() => nodes.map((n) => ({ ...n, style: { ...n.style, opacity: nodeDimmed(steps?.[n.id]?.status, inProgress) ? 0.4 : 1, transition: 'opacity 300ms ease' } })), [nodes, steps, inProgress])`.
- `displayEdges = useMemo(() => applyVisualEdgeRouting(edges).map((e) => ({ ...e, style: EDGE_RUN_STYLE[edgeRunState(steps?.[e.source]?.status, steps?.[e.target]?.status, inProgress)] })), [edges, steps, inProgress])`.
- Pass `nodes={displayNodes}` / `edges={displayEdges}` to `<ReactFlow>`. `onNodesChange`/`onEdgesChange` keep using the raw store `nodes`/`edges`, so the styling is render-only and never persisted to the saved graph.

### `packages/frontend/src/components/workflow/node-shell.tsx`
In `RUN_STATUS_BORDER`, swap `animate-pulse` for `animate-[nodeRunGlow_1.6s_ease-in-out_infinite]` on:
- `running:` `'border-primary shadow-[0_0_26px_3px_rgba(217,164,65,0.5)] animate-[nodeRunGlow_1.6s_ease-in-out_infinite]'`
- `awaiting:` `'border-anubis-gold-hi shadow-[0_0_30px_4px_rgba(217,164,65,0.7)] animate-[nodeRunGlow_1.6s_ease-in-out_infinite]'`

The static `shadow-[…]` remains as the steady fallback (e.g. under reduced motion). Other
statuses unchanged. Dimming is handled at the canvas, so `pending` stays `border-border`.

### `packages/frontend/src/index.css`
Add, next to `anubisPulse`:
```css
@keyframes nodeRunGlow {
  0%, 100% { box-shadow: 0 0 18px 2px color-mix(in oklab, var(--anubis-gold) 35%, transparent); }
  50%      { box-shadow: 0 0 30px 6px color-mix(in oklab, var(--anubis-gold-hi) 70%, transparent); }
}
```
Add `[class*='nodeRunGlow']` to the existing `@media (prefers-reduced-motion: reduce)`
rule that already disables `anubisPulse`/`anubisBlink`/`anubisIndeterminate`.

## Testing

- **`run-visuals.test.ts`** (frontend vitest): table tests for `isRunInProgress`
  (running/awaiting_approval → true; terminal/null → false), `nodeDimmed`
  (undefined/pending/skipped + inProgress → true; running/succeeded → false; anything +
  !inProgress → false), and `edgeRunState` (idle when !inProgress; succeeded→running =
  flowing; succeeded→succeeded = settled; pending→running = dim; succeeded→skipped = dim).
- **Canvas / shell:** typecheck + manual verification — start a run and confirm: active
  edges flow along the path, the executing node glows, not-yet-run and skipped nodes dim
  to ~40%; at rest (no run) and after a run finishes, edges are static and nodes are full
  opacity.

## Out of scope

- Changing run-state derivation, the run engine, or the SSE event flow.
- Animating node entry/exit (the existing framer-motion entry animation stays).
- Persisting any visual state to the saved graph.
- MiniMap run-state coloring.
