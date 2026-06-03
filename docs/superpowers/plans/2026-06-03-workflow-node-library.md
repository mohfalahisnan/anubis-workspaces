# Workflow Node Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable workflow-node library inside `packages/frontend` — `NodeShell` primitive, nine specialized Anubis content-workflow nodes, `SeparatedEdge` with virtual fan-out routing, and a `workflow-demo` route with a gallery + wired flow.

**Architecture:** New `packages/frontend/src/components/workflow/` folder. Nodes share a `NodeShell` wrapper with one real `<Handle>` per side; multi-input/output is rendered by a custom `SeparatedEdge` that computes y-offsets via the pure helper `applyVisualEdgeRouting`. Demo route wired through the existing `lib/navigation.tsx` switch with no sidebar entry. Theming uses shadcn tokens for structure; Anubis orange `#fd551d` is preserved as the workflow accent.

**Tech Stack:** React 19, `@xyflow/react` v12, Tailwind v4 + shadcn UI tokens, `lucide-react` for icons, `motion` (v12, imported from `motion/react`) for entry animations, `vitest` for the pure-function unit test.

**Reference (do not edit):** `C:\Users\User\Downloads\content_workflow_react_flow_preview.jsx` — original preview file the library is modelled on.

**Spec:** [docs/superpowers/specs/2026-06-03-workflow-node-library-design.md](../specs/2026-06-03-workflow-node-library-design.md)

---

## File Structure

Created by this plan (paths relative to repo root):

```
packages/frontend/src/components/workflow/
├── index.ts                                # public exports
├── theme.ts                                # accent gradients + WORKFLOW_ACCENT constant
├── handles.tsx                             # one IN + one OUT Handle (shared by every node)
├── status-badge.tsx                        # footer chip used in node footers
├── node-shell.tsx                          # the primitive (icon, title, subtitle, accent, footer, children)
├── separated-edge.tsx                      # SeparatedEdge + applyVisualEdgeRouting + workflowEdgeDefaults
├── edge-types.ts                           # workflowEdgeTypes map
├── node-types.ts                           # workflowNodeTypes map
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
    ├── sample-data.ts                      # fixtures shared by gallery + wired flow
    ├── gallery.tsx                         # gallery tab body
    ├── wired-flow.tsx                      # wired flow tab body
    └── workflow-demo-page.tsx              # tabs + layout

packages/frontend/tests/workflow/
└── separated-edge-routing.test.ts          # unit tests for applyVisualEdgeRouting
```

Modified:

- `packages/frontend/src/lib/navigation.tsx` — add `'workflow-demo'` to the `Route` union.
- `packages/frontend/src/components/dashboard/index.tsx` — import `WorkflowDemoPage`, add a `BREADCRUMBS` entry, add a `case 'workflow-demo'`.

---

## Task 1: Scaffold the folder + theme constants + public-export skeleton

**Files:**
- Create: `packages/frontend/src/components/workflow/theme.ts`
- Create: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `theme.ts`**

```ts
// packages/frontend/src/components/workflow/theme.ts
export const WORKFLOW_ACCENT = '#fd551d'

export const ACCENT_GRADIENTS = {
  default: 'from-[#fd551d] to-[#ff9b7a]',
  media:   'from-[#fd551d] to-[#8b5cf6]',
  data:    'from-[#fd551d] to-[#3b82f6]',
  review:  'from-[#fd551d] to-[#22c55e]',
  warning: 'from-[#fd551d] to-[#f59e0b]',
  final:   'from-[#fd551d] via-[#ff7a45] to-[#fefefe]',
} as const

export type AccentKey = keyof typeof ACCENT_GRADIENTS
```

- [ ] **Step 2: Create empty public-export file**

```ts
// packages/frontend/src/components/workflow/index.ts
export { ACCENT_GRADIENTS, WORKFLOW_ACCENT } from './theme'
export type { AccentKey } from './theme'
// Further exports added in later tasks.
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (no errors — the new module exports types/constants only).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow/theme.ts \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): scaffold workflow node library folder"
```

---

## Task 2: Build the `StatusBadge` and `NodeDirectionalHandles` shared sub-primitives

**Files:**
- Create: `packages/frontend/src/components/workflow/status-badge.tsx`
- Create: `packages/frontend/src/components/workflow/handles.tsx`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `status-badge.tsx`**

```tsx
// packages/frontend/src/components/workflow/status-badge.tsx
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type StatusBadgeTone = 'default' | 'success' | 'warning' | 'info'

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  default: 'border-[#fd551d]/20 bg-white/5 text-zinc-300',
  success: 'border-[#22c55e]/25 bg-[#22c55e]/10 text-[#86efac]',
  warning: 'border-[#f59e0b]/25 bg-[#f59e0b]/10 text-[#fcd34d]',
  info:    'border-[#3b82f6]/25 bg-[#3b82f6]/10 text-[#93c5fd]',
}

export interface StatusBadgeProps {
  children: ReactNode
  tone?: StatusBadgeTone
  className?: string
}

export function StatusBadge({ children, tone = 'default', className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Create `handles.tsx`**

```tsx
// packages/frontend/src/components/workflow/handles.tsx
import { Handle, Position } from '@xyflow/react'

export const WORKFLOW_TARGET_HANDLE = 'in-main'
export const WORKFLOW_SOURCE_HANDLE = 'out-main'

const HANDLE_CLASS =
  '!h-9 !w-9 !rounded-full !border-2 !border-[#0b0b0c] !bg-[#fd551d] !shadow-xl !shadow-black/50 !z-20 ' +
  'flex items-center justify-center text-[9px] font-bold tracking-[0.08em] text-white'

interface NodeHandleProps {
  type: 'target' | 'source'
  position: Position
  id: string
  label: string
}

function NodeHandle({ type, position, id, label }: NodeHandleProps) {
  return (
    <Handle id={id} type={type} position={position} className={HANDLE_CLASS}>
      <span className='pointer-events-none select-none leading-none'>{label}</span>
    </Handle>
  )
}

export function NodeDirectionalHandles() {
  return (
    <>
      <NodeHandle type='target' position={Position.Left}  id={WORKFLOW_TARGET_HANDLE} label='IN' />
      <NodeHandle type='source' position={Position.Right} id={WORKFLOW_SOURCE_HANDLE} label='OUT' />
    </>
  )
}
```

- [ ] **Step 3: Re-export from `index.ts`**

Update `packages/frontend/src/components/workflow/index.ts` to:

```ts
export { ACCENT_GRADIENTS, WORKFLOW_ACCENT } from './theme'
export type { AccentKey } from './theme'

export { StatusBadge } from './status-badge'
export type { StatusBadgeProps, StatusBadgeTone } from './status-badge'

export {
  NodeDirectionalHandles,
  WORKFLOW_SOURCE_HANDLE,
  WORKFLOW_TARGET_HANDLE,
} from './handles'
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/workflow/status-badge.tsx \
        packages/frontend/src/components/workflow/handles.tsx \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add StatusBadge and node directional handles"
```

---

## Task 3: Build the `NodeShell` primitive

**Files:**
- Create: `packages/frontend/src/components/workflow/node-shell.tsx`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `node-shell.tsx`**

```tsx
// packages/frontend/src/components/workflow/node-shell.tsx
import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { motion } from 'motion/react'

import { ACCENT_GRADIENTS } from './theme'
import { NodeDirectionalHandles } from './handles'

export interface NodeShellProps {
  icon: ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  /** Tailwind gradient classes (e.g. "from-[#fd551d] to-[#ff9b7a]"). */
  accent?: string
  footer?: ReactNode
  children?: ReactNode
  className?: string
  /** Skip the framer-motion entry animation. */
  disableMotion?: boolean
}

const SHELL_BASE =
  'relative w-[360px] overflow-visible rounded-2xl border border-[#fd551d]/20 ' +
  'bg-[#0b0b0c]/90 backdrop-blur-xl text-white shadow-2xl shadow-black/35'

export function NodeShell({
  icon: Icon,
  title,
  subtitle,
  accent = ACCENT_GRADIENTS.default,
  footer,
  children,
  className,
  disableMotion = false,
}: NodeShellProps) {
  const inner = (
    <div className={cn(SHELL_BASE, className)}>
      <NodeDirectionalHandles />
      <div className='overflow-hidden rounded-2xl'>
        <div className={cn('h-1 bg-gradient-to-r', accent)} />
        <div className='p-4'>
          <div className='flex items-start gap-3'>
            <div className='rounded-xl border border-[#fd551d]/20 bg-[#fd551d]/10 p-2 text-[#fd551d]'>
              <Icon className='h-5 w-5' />
            </div>
            <div className='min-w-0 flex-1'>
              <h3 className='text-sm font-semibold tracking-tight text-white'>{title}</h3>
              {subtitle ? (
                <p className='mt-0.5 text-xs leading-relaxed text-zinc-400'>{subtitle}</p>
              ) : null}
            </div>
          </div>
          {children ? <div className='mt-4'>{children}</div> : null}
          {footer ? <div className='mt-4 border-t border-white/10 pt-3'>{footer}</div> : null}
        </div>
      </div>
    </div>
  )

  if (disableMotion) return inner

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {inner}
    </motion.div>
  )
}
```

- [ ] **Step 2: Re-export from `index.ts`**

Append to `packages/frontend/src/components/workflow/index.ts`:

```ts
export { NodeShell } from './node-shell'
export type { NodeShellProps } from './node-shell'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow/node-shell.tsx \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add NodeShell primitive with handles and accent bar"
```

---

## Task 4: TDD `applyVisualEdgeRouting` (pure helper)

**Files:**
- Test: `packages/frontend/tests/workflow/separated-edge-routing.test.ts`
- Create (later steps in this task): `packages/frontend/src/components/workflow/separated-edge.tsx`

This is the one piece of logic worth unit testing — it's pure and the visual correctness of every multi-IO line depends on it.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/workflow/separated-edge-routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

import { applyVisualEdgeRouting } from '@/components/workflow/separated-edge'

interface FlowEdgeLike {
  id: string
  source: string
  target: string
}

describe('applyVisualEdgeRouting', () => {
  it('returns 0 offsets for edges with no siblings', () => {
    const edges: FlowEdgeLike[] = [
      { id: 'e1', source: 'a', target: 'b' },
    ]
    const routed = applyVisualEdgeRouting(edges)
    expect(routed[0].data).toMatchObject({
      sourceOffset: 0,
      targetOffset: 0,
      hasSourceSiblings: false,
      hasTargetSiblings: false,
    })
  })

  it('centers offsets symmetrically around 0 for shared targets', () => {
    const edges: FlowEdgeLike[] = [
      { id: 'e1', source: 'a', target: 'z' },
      { id: 'e2', source: 'b', target: 'z' },
      { id: 'e3', source: 'c', target: 'z' },
    ]
    const routed = applyVisualEdgeRouting(edges)
    const targetOffsets = routed.map((e) => e.data.targetOffset)
    // 3 edges, gap 42 → (i - 1) * 42 → [-42, 0, 42]
    expect(targetOffsets).toEqual([-42, 0, 42])
    expect(routed.every((e) => e.data.hasTargetSiblings)).toBe(true)
    expect(routed.every((e) => e.data.hasSourceSiblings === false)).toBe(true)
  })

  it('flags fan-out from a shared source', () => {
    const edges: FlowEdgeLike[] = [
      { id: 'e1', source: 's', target: 'a' },
      { id: 'e2', source: 's', target: 'b' },
    ]
    const routed = applyVisualEdgeRouting(edges)
    expect(routed.map((e) => e.data.sourceOffset)).toEqual([-21, 21])
    expect(routed.every((e) => e.data.hasSourceSiblings)).toBe(true)
    expect(routed.every((e) => e.data.hasTargetSiblings === false)).toBe(true)
  })

  it('preserves all other edge fields untouched', () => {
    const edges = [{ id: 'e1', source: 'a', target: 'b', label: 'hello', extra: 42 } as never]
    const routed = applyVisualEdgeRouting(edges) as readonly { label: string; extra: number }[]
    expect(routed[0].label).toBe('hello')
    expect(routed[0].extra).toBe(42)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend vitest run tests/workflow/separated-edge-routing.test.ts`
Expected: FAIL with "Cannot find module '@/components/workflow/separated-edge'" or similar.

- [ ] **Step 3: Implement the minimal helper to make tests pass**

Create `packages/frontend/src/components/workflow/separated-edge.tsx` with just the helper for now (the React edge component is added in Task 5):

```tsx
// packages/frontend/src/components/workflow/separated-edge.tsx
export interface RoutedEdgeData {
  sourceOffset: number
  targetOffset: number
  hasSourceSiblings: boolean
  hasTargetSiblings: boolean
}

interface EdgeShape {
  id: string
  source: string
  target: string
  data?: Record<string, unknown>
}

const GAP_PX = 42

function getCenteredOffset(index: number, total: number, gap = GAP_PX): number {
  if (total <= 1) return 0
  return (index - (total - 1) / 2) * gap
}

function groupEdgeIdsByKey<T extends EdgeShape>(
  edges: readonly T[],
  keyName: 'source' | 'target',
): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const edge of edges) {
    const key = edge[keyName]
    const current = groups[key] ?? []
    current.push(edge.id)
    groups[key] = current
  }
  return groups
}

export function applyVisualEdgeRouting<T extends EdgeShape>(
  edges: readonly T[],
): (T & { data: T['data'] & RoutedEdgeData })[] {
  const sourceGroups = groupEdgeIdsByKey(edges, 'source')
  const targetGroups = groupEdgeIdsByKey(edges, 'target')

  return edges.map((edge) => {
    const sourceGroup = sourceGroups[edge.source] ?? []
    const targetGroup = targetGroups[edge.target] ?? []
    const sourceIndex = Math.max(sourceGroup.indexOf(edge.id), 0)
    const targetIndex = Math.max(targetGroup.indexOf(edge.id), 0)
    const sourceOffset = getCenteredOffset(sourceIndex, sourceGroup.length)
    const targetOffset = getCenteredOffset(targetIndex, targetGroup.length)

    return {
      ...edge,
      data: {
        ...(edge.data ?? {}),
        sourceOffset,
        targetOffset,
        hasSourceSiblings: sourceGroup.length > 1,
        hasTargetSiblings: targetGroup.length > 1,
      },
    } as T & { data: T['data'] & RoutedEdgeData }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend vitest run tests/workflow/separated-edge-routing.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/workflow/separated-edge.tsx \
        packages/frontend/tests/workflow/separated-edge-routing.test.ts
git commit -m "feat(workflow): add applyVisualEdgeRouting with unit tests"
```

---

## Task 5: Add `SeparatedEdge` component + edge defaults + edge-type map

**Files:**
- Modify: `packages/frontend/src/components/workflow/separated-edge.tsx`
- Create: `packages/frontend/src/components/workflow/edge-types.ts`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Append edge component + defaults to `separated-edge.tsx`**

Add the following to the bottom of `packages/frontend/src/components/workflow/separated-edge.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

const KEYFRAMES = `@keyframes workflowLineDash { from { stroke-dashoffset: 18; } to { stroke-dashoffset: 0; } }`

export const workflowEdgeDefaults = {
  animated: true,
  type: 'separated' as const,
  style: {
    strokeWidth: 2,
    stroke: 'rgba(255, 255, 255, 0.78)',
    strokeDasharray: '10 8',
    animation: 'workflowLineDash 900ms linear infinite',
  } satisfies CSSProperties,
} as const

export const workflowEdgeLabelDefaults = {
  labelBgPadding: [8, 4] as [number, number],
  labelBgBorderRadius: 8,
  labelStyle: { fill: '#ffffff', fontSize: 11, fontWeight: 600 },
  labelBgStyle: { fill: 'rgba(11, 11, 12, 0.94)', stroke: 'rgba(253, 85, 29, 0.24)' },
}

export function SeparatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  label,
  data,
}: EdgeProps<{ sourceOffset?: number; targetOffset?: number; hasSourceSiblings?: boolean; hasTargetSiblings?: boolean }>) {
  const sourceOffset = data?.hasSourceSiblings ? data.sourceOffset ?? 0 : 0
  const targetOffset = data?.hasTargetSiblings ? data.targetOffset ?? 0 : 0
  const visualSourceY = sourceY + sourceOffset
  const visualTargetY = targetY + targetOffset
  const distance = Math.max(Math.abs(targetX - sourceX), 160)
  const controlDistance = Math.min(Math.max(distance * 0.42, 120), 320)
  const labelX = (sourceX + targetX) / 2
  const labelY = (visualSourceY + visualTargetY) / 2

  const edgePath = [
    `M ${sourceX},${visualSourceY}`,
    `C ${sourceX + controlDistance},${visualSourceY} ${targetX - controlDistance},${visualTargetY} ${targetX},${visualTargetY}`,
  ].join(' ')

  return (
    <>
      <style>{KEYFRAMES}</style>
      <BaseEdge id={id} path={edgePath} markerEnd={undefined} style={style} />
      {label != null ? (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan absolute rounded-lg border border-[#fd551d]/25 bg-[#0b0b0c]/95 px-2 py-1 text-[11px] font-semibold text-white shadow-lg shadow-black/30'
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label as ReactNode}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
```

- [ ] **Step 2: Create the edge-type map**

```ts
// packages/frontend/src/components/workflow/edge-types.ts
import type { EdgeTypes } from '@xyflow/react'

import { SeparatedEdge } from './separated-edge'

export const workflowEdgeTypes: EdgeTypes = {
  separated: SeparatedEdge,
}
```

- [ ] **Step 3: Re-export from `index.ts`**

Append:

```ts
export {
  applyVisualEdgeRouting,
  SeparatedEdge,
  workflowEdgeDefaults,
  workflowEdgeLabelDefaults,
} from './separated-edge'
export type { RoutedEdgeData } from './separated-edge'
export { workflowEdgeTypes } from './edge-types'
```

- [ ] **Step 4: Re-run the helper tests and typecheck**

Run: `pnpm --filter @anubis/frontend vitest run tests/workflow/separated-edge-routing.test.ts && pnpm --filter @anubis/frontend typecheck`
Expected: PASS for tests; PASS for typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/workflow/separated-edge.tsx \
        packages/frontend/src/components/workflow/edge-types.ts \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add SeparatedEdge component with workflow edge defaults"
```

---

## Task 6: Build the three text-shaped nodes — `TextNode`, `TableNode`, `SearchNode`

These three share a simple "list/table of rows" body and exercise the `NodeShell` API with minimal extras.

**Files:**
- Create: `packages/frontend/src/components/workflow/nodes/text-node.tsx`
- Create: `packages/frontend/src/components/workflow/nodes/table-node.tsx`
- Create: `packages/frontend/src/components/workflow/nodes/search-node.tsx`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `text-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/text-node.tsx
import { memo } from 'react'
import { FileText } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface TextNodeData {
  title: string
  subtitle: string
  badge: string
  body: string
}

export const TextNode = memo(function TextNode({ data }: NodeProps<TextNodeData>) {
  return (
    <NodeShell
      icon={FileText}
      title={data.title}
      subtitle={data.subtitle}
      accent={ACCENT_GRADIENTS.default}
      footer={<StatusBadge>{data.badge}</StatusBadge>}
    >
      <div className='rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed text-zinc-300'>
        {data.body}
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 2: Create `table-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/table-node.tsx
import { memo } from 'react'
import { Table as TableIcon } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface TableNodeRow {
  source: string
  type: string
  score: string
}

export interface TableNodeData {
  rows: TableNodeRow[]
}

export const TableNode = memo(function TableNode({ data }: NodeProps<TableNodeData>) {
  return (
    <NodeShell
      icon={TableIcon}
      title='Reference Table'
      subtitle='Internal and external references rendered as structured source rows.'
      accent={ACCENT_GRADIENTS.review}
      footer={<StatusBadge tone='success'>{data.rows.length} references matched</StatusBadge>}
    >
      <div className='overflow-hidden rounded-xl border border-white/10'>
        <table className='w-full text-left text-xs'>
          <thead className='bg-white/[0.06] text-[10px] uppercase tracking-wider text-zinc-400'>
            <tr>
              <th className='px-3 py-2'>Source</th>
              <th className='px-3 py-2'>Type</th>
              <th className='px-3 py-2'>Score</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-white/10'>
            {data.rows.map((row) => (
              <tr key={row.source} className='bg-zinc-950/40'>
                <td className='px-3 py-2 text-zinc-200'>{row.source}</td>
                <td className='px-3 py-2 text-zinc-400'>{row.type}</td>
                <td className='px-3 py-2 font-medium text-[#ff9b7a]'>{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 3: Create `search-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/search-node.tsx
import { memo } from 'react'
import { Search } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface SearchNodeContext {
  title: string
  score: string
  summary: string
}

export interface SearchNodeData {
  latency: string
  context: SearchNodeContext[]
}

export const SearchNode = memo(function SearchNode({ data }: NodeProps<SearchNodeData>) {
  return (
    <NodeShell
      icon={Search}
      title='Anubis Context Retrieval'
      subtitle='Similarity search and full context pack retrieval from internal knowledge base.'
      accent={ACCENT_GRADIENTS.data}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Similarity engine</StatusBadge>
          <StatusBadge tone='success'>Context pack</StatusBadge>
          <StatusBadge>{data.latency}</StatusBadge>
        </div>
      }
    >
      <div className='space-y-2'>
        {data.context.map((ctx) => (
          <div key={ctx.title} className='rounded-xl bg-white/[0.04] p-3'>
            <div className='flex items-center justify-between gap-3'>
              <p className='truncate text-xs font-medium text-white'>{ctx.title}</p>
              <span className='text-[10px] text-[#ff9b7a]'>{ctx.score}</span>
            </div>
            <p className='mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400'>{ctx.summary}</p>
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 4: Re-export from `index.ts`**

Append:

```ts
export { TextNode }   from './nodes/text-node'
export type { TextNodeData }   from './nodes/text-node'
export { TableNode }  from './nodes/table-node'
export type { TableNodeData, TableNodeRow } from './nodes/table-node'
export { SearchNode } from './nodes/search-node'
export type { SearchNodeData, SearchNodeContext } from './nodes/search-node'
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/workflow/nodes/text-node.tsx \
        packages/frontend/src/components/workflow/nodes/table-node.tsx \
        packages/frontend/src/components/workflow/nodes/search-node.tsx \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add Text, Table, and Search nodes"
```

---

## Task 7: Build the two media-shaped nodes — `InstagramPostNode` and `TransformerNode`

**Files:**
- Create: `packages/frontend/src/components/workflow/nodes/instagram-post-node.tsx`
- Create: `packages/frontend/src/components/workflow/nodes/transformer-node.tsx`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `instagram-post-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/instagram-post-node.tsx
import { memo } from 'react'
import { Instagram } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface InstagramPostNodeData {
  account: string
  caption: string
  imageUrl: string
  metrics: { likes: string }
}

export const InstagramPostNode = memo(function InstagramPostNode({
  data,
}: NodeProps<InstagramPostNodeData>) {
  return (
    <NodeShell
      icon={Instagram}
      title='Competitor Instagram Post'
      subtitle='Raw social content input with caption, media, engagement, and extracted text.'
      accent='from-[#fd551d] via-[#ff6b35] to-[#ff9b7a]'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>OCR ready</StatusBadge>
          <StatusBadge tone='info'>Transcript ready</StatusBadge>
          <StatusBadge>{data.metrics.likes} likes</StatusBadge>
        </div>
      }
    >
      <div className='overflow-hidden rounded-xl border border-white/10 bg-black'>
        <img src={data.imageUrl} alt='Competitor post visual' className='h-44 w-full object-cover' />
        <div className='p-3'>
          <div className='flex items-center gap-2'>
            <div className='h-8 w-8 rounded-full bg-gradient-to-tr from-[#fd551d] to-[#ff9b7a]' />
            <div>
              <p className='text-xs font-semibold'>{data.account}</p>
              <p className='text-[10px] text-zinc-500'>Sponsored content · 2h ago</p>
            </div>
          </div>
          <p className='mt-3 line-clamp-4 text-xs leading-relaxed text-zinc-300'>
            <span className='font-semibold text-white'>{data.account}</span> {data.caption}
          </p>
        </div>
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 2: Create `transformer-node.tsx`** (handles both "media" and "brief" kinds in one component, matching the reference)

```tsx
// packages/frontend/src/components/workflow/nodes/transformer-node.tsx
import { memo } from 'react'
import { Image as ImageIcon, FileText } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface TransformerBriefItem {
  label: string
  value: string
}

export type TransformerNodeData =
  | {
      kind: 'media'
      title: string
      subtitle: string
      badge: string
      imageUrl: string
      videoUrl: string
      videoPoster: string
    }
  | {
      kind: 'brief'
      title: string
      subtitle: string
      badge: string
      items: TransformerBriefItem[]
    }

export const TransformerNode = memo(function TransformerNode({
  data,
}: NodeProps<TransformerNodeData>) {
  const Icon = data.kind === 'media' ? ImageIcon : FileText

  return (
    <NodeShell
      icon={Icon}
      title={data.title}
      subtitle={data.subtitle}
      accent={data.kind === 'media' ? ACCENT_GRADIENTS.media : ACCENT_GRADIENTS.default}
      footer={<StatusBadge tone='info'>{data.badge}</StatusBadge>}
    >
      {data.kind === 'media' ? (
        <div className='grid grid-cols-2 gap-2'>
          <div className='overflow-hidden rounded-xl border border-white/10 bg-black'>
            <img src={data.imageUrl} alt='Image transform preview' className='h-28 w-full object-cover' />
            <div className='border-t border-white/10 p-2 text-[10px] text-zinc-400'>Image output</div>
          </div>
          <div className='overflow-hidden rounded-xl border border-white/10 bg-black'>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video className='h-28 w-full object-cover' poster={data.videoPoster} muted>
              <source src={data.videoUrl} type='video/mp4' />
            </video>
            <div className='border-t border-white/10 p-2 text-[10px] text-zinc-400'>Video output</div>
          </div>
        </div>
      ) : (
        <div className='space-y-2'>
          {data.items.map((item) => (
            <div key={item.label} className='rounded-xl border border-white/10 bg-white/[0.04] p-3'>
              <p className='text-[10px] uppercase tracking-wider text-zinc-500'>{item.label}</p>
              <p className='mt-1 text-xs leading-relaxed text-zinc-200'>{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </NodeShell>
  )
})
```

- [ ] **Step 3: Re-export from `index.ts`**

Append:

```ts
export { InstagramPostNode } from './nodes/instagram-post-node'
export type { InstagramPostNodeData } from './nodes/instagram-post-node'
export { TransformerNode } from './nodes/transformer-node'
export type { TransformerNodeData, TransformerBriefItem } from './nodes/transformer-node'
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/workflow/nodes/instagram-post-node.tsx \
        packages/frontend/src/components/workflow/nodes/transformer-node.tsx \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add InstagramPost and Transformer media nodes"
```

---

## Task 8: Build the four pipeline nodes — `ContextBuilderNode`, `AIAgentNode`, `AgentReviewNode`, `FinalContentNode`

**Files:**
- Create: `packages/frontend/src/components/workflow/nodes/context-builder-node.tsx`
- Create: `packages/frontend/src/components/workflow/nodes/ai-agent-node.tsx`
- Create: `packages/frontend/src/components/workflow/nodes/agent-review-node.tsx`
- Create: `packages/frontend/src/components/workflow/nodes/final-content-node.tsx`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `context-builder-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/context-builder-node.tsx
import { memo } from 'react'
import { Brain } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface ContextBuilderBriefItem {
  label: string
  source: string
  value: string
}

export interface ContextBuilderNodeData {
  brief: ContextBuilderBriefItem[]
}

export const ContextBuilderNode = memo(function ContextBuilderNode({
  data,
}: NodeProps<ContextBuilderNodeData>) {
  return (
    <NodeShell
      icon={Brain}
      title='AI Context Builder'
      subtitle='Builds the execution brief from crawler output, transformed data, brand rules, knowledge base, and similarity context.'
      accent={ACCENT_GRADIENTS.data}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Brief generated</StatusBadge>
          <StatusBadge tone='info'>Context packed</StatusBadge>
        </div>
      }
    >
      <div className='space-y-2'>
        {data.brief.map((item) => (
          <div key={item.label} className='rounded-xl border border-white/10 bg-white/[0.04] p-3'>
            <div className='flex items-center justify-between gap-3'>
              <p className='text-xs font-semibold text-white'>{item.label}</p>
              <span className='text-[10px] text-[#ff9b7a]'>{item.source}</span>
            </div>
            <p className='mt-1 text-xs leading-relaxed text-zinc-400'>{item.value}</p>
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 2: Create `ai-agent-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/ai-agent-node.tsx
import { memo } from 'react'
import { Bot } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface AIAgentNodeData {
  mode: string
  steps: string[]
}

export const AIAgentNode = memo(function AIAgentNode({ data }: NodeProps<AIAgentNodeData>) {
  return (
    <NodeShell
      icon={Bot}
      title='AI Agent Executor'
      subtitle='Executes the approved content workflow and prepares the final publishing package.'
      accent='from-[#fd551d] to-white'
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Executor ready</StatusBadge>
          <StatusBadge tone='info'>Tools scoped</StatusBadge>
          <StatusBadge>{data.mode}</StatusBadge>
        </div>
      }
    >
      <div className='space-y-2'>
        {data.steps.map((step) => (
          <div
            key={step}
            className='rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-zinc-300'
          >
            {step}
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 3: Create `agent-review-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/agent-review-node.tsx
import { memo } from 'react'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface AgentReviewCheck {
  label: string
  description: string
  pass: boolean
}

export interface AgentReviewNodeData {
  checks: AgentReviewCheck[]
}

export const AgentReviewNode = memo(function AgentReviewNode({
  data,
}: NodeProps<AgentReviewNodeData>) {
  return (
    <NodeShell
      icon={ShieldCheck}
      title='Agent Review'
      subtitle='Reviews executor result against brand guideline, source support, originality, and publish readiness.'
      accent={ACCENT_GRADIENTS.review}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Approve path</StatusBadge>
          <StatusBadge tone='warning'>Reject loops back</StatusBadge>
        </div>
      }
    >
      <div className='grid grid-cols-2 gap-2'>
        {data.checks.map((check) => (
          <div key={check.label} className='rounded-xl border border-white/10 bg-white/[0.04] p-3'>
            <div className='flex items-center gap-2'>
              {check.pass ? (
                <CheckCircle2 className='h-4 w-4 text-[#22c55e]' />
              ) : (
                <AlertTriangle className='h-4 w-4 text-[#f59e0b]' />
              )}
              <p className='text-xs font-medium text-white'>{check.label}</p>
            </div>
            <p className='mt-1 text-[10px] text-zinc-500'>{check.description}</p>
          </div>
        ))}
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 4: Create `final-content-node.tsx`**

```tsx
// packages/frontend/src/components/workflow/nodes/final-content-node.tsx
import { memo } from 'react'
import { Sparkles } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'

import { ACCENT_GRADIENTS } from '../theme'
import { NodeShell } from '../node-shell'
import { StatusBadge } from '../status-badge'

export interface FinalContentNodeData {
  title: string
  caption: string
  format: string
  channel: string
  status: string
}

export const FinalContentNode = memo(function FinalContentNode({
  data,
}: NodeProps<FinalContentNodeData>) {
  return (
    <NodeShell
      icon={Sparkles}
      title='Ready-to-Post Content'
      subtitle='Approved final content package prepared for publishing.'
      accent={ACCENT_GRADIENTS.final}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='success'>Approved</StatusBadge>
          <StatusBadge tone='success'>Ready to schedule</StatusBadge>
          <StatusBadge>{data.channel}</StatusBadge>
        </div>
      }
    >
      <div className='overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]'>
        <div className='border-b border-white/10 p-3'>
          <p className='text-xs font-semibold text-white'>{data.title}</p>
          <p className='mt-1 text-xs leading-relaxed text-zinc-400'>{data.caption}</p>
        </div>
        <div className='grid grid-cols-3 divide-x divide-white/10 text-center text-[10px] text-zinc-400'>
          <div className='p-3'><b className='block text-white'>{data.format}</b>Format</div>
          <div className='p-3'><b className='block text-white'>{data.channel}</b>Channel</div>
          <div className='p-3'><b className='block text-white'>{data.status}</b>Status</div>
        </div>
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 5: Re-export from `index.ts`**

Append:

```ts
export { ContextBuilderNode } from './nodes/context-builder-node'
export type { ContextBuilderNodeData, ContextBuilderBriefItem } from './nodes/context-builder-node'
export { AIAgentNode }       from './nodes/ai-agent-node'
export type { AIAgentNodeData } from './nodes/ai-agent-node'
export { AgentReviewNode }   from './nodes/agent-review-node'
export type { AgentReviewNodeData, AgentReviewCheck } from './nodes/agent-review-node'
export { FinalContentNode }  from './nodes/final-content-node'
export type { FinalContentNodeData } from './nodes/final-content-node'
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/workflow/nodes/context-builder-node.tsx \
        packages/frontend/src/components/workflow/nodes/ai-agent-node.tsx \
        packages/frontend/src/components/workflow/nodes/agent-review-node.tsx \
        packages/frontend/src/components/workflow/nodes/final-content-node.tsx \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add ContextBuilder, AIAgent, AgentReview, FinalContent nodes"
```

---

## Task 9: Build the node-type map

**Files:**
- Create: `packages/frontend/src/components/workflow/node-types.ts`
- Modify: `packages/frontend/src/components/workflow/index.ts`

- [ ] **Step 1: Create `node-types.ts`**

```ts
// packages/frontend/src/components/workflow/node-types.ts
import type { NodeTypes } from '@xyflow/react'

import { InstagramPostNode } from './nodes/instagram-post-node'
import { TransformerNode }   from './nodes/transformer-node'
import { TextNode }          from './nodes/text-node'
import { TableNode }         from './nodes/table-node'
import { SearchNode }        from './nodes/search-node'
import { ContextBuilderNode } from './nodes/context-builder-node'
import { AIAgentNode }       from './nodes/ai-agent-node'
import { AgentReviewNode }   from './nodes/agent-review-node'
import { FinalContentNode }  from './nodes/final-content-node'

export const workflowNodeTypes: NodeTypes = {
  instagramPost:    InstagramPostNode,
  transformer:      TransformerNode,
  textBlock:        TextNode,
  referenceTable:   TableNode,
  contextSearch:    SearchNode,
  contextBuilder:   ContextBuilderNode,
  aiAgent:          AIAgentNode,
  agentReview:      AgentReviewNode,
  finalContent:     FinalContentNode,
}

export type WorkflowNodeType = keyof typeof workflowNodeTypes
```

- [ ] **Step 2: Re-export from `index.ts`**

Append:

```ts
export { workflowNodeTypes } from './node-types'
export type { WorkflowNodeType } from './node-types'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/workflow/node-types.ts \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): export workflowNodeTypes map"
```

---

## Task 10: Create the demo sample data

**Files:**
- Create: `packages/frontend/src/components/workflow/demo/sample-data.ts`

- [ ] **Step 1: Create the sample data file**

```ts
// packages/frontend/src/components/workflow/demo/sample-data.ts
import type { Edge, Node } from '@xyflow/react'

import {
  workflowEdgeDefaults,
  workflowEdgeLabelDefaults,
} from '../separated-edge'
import {
  WORKFLOW_SOURCE_HANDLE,
  WORKFLOW_TARGET_HANDLE,
} from '../handles'

import type { InstagramPostNodeData } from '../nodes/instagram-post-node'
import type { TransformerNodeData }   from '../nodes/transformer-node'
import type { TextNodeData }          from '../nodes/text-node'
import type { TableNodeData }         from '../nodes/table-node'
import type { SearchNodeData }        from '../nodes/search-node'
import type { ContextBuilderNodeData } from '../nodes/context-builder-node'
import type { AIAgentNodeData }       from '../nodes/ai-agent-node'
import type { AgentReviewNodeData }   from '../nodes/agent-review-node'
import type { FinalContentNodeData }  from '../nodes/final-content-node'

/** Realistic fixtures — one per node type — shared by gallery and wired flow. */
export const sampleNodeData = {
  instagramPost: {
    account: '@competitor.brand',
    caption:
      'Stop creating random content. Build one repeatable content engine that converts attention into trust, then trust into sales.',
    imageUrl:
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?q=80&w=1200&auto=format&fit=crop',
    metrics: { likes: '12.8k' },
  } satisfies InstagramPostNodeData,

  postCrawler: {
    title: 'Post Crawler',
    subtitle:
      'Extracts competitor post content and sends normalized raw output to the transformer.',
    badge: 'Crawler output',
    body: 'Extracts caption, media URLs, hashtags, engagement metrics, post structure, creator metadata, CTA, timestamp, comments signal, and raw media references.',
  } satisfies TextNodeData,

  mediaOutputTransformer: {
    kind: 'media',
    title: 'Output Transformer',
    subtitle:
      'Refines crawler output and renders content as image/video objects for downstream extraction.',
    badge: 'Image / Video render',
    imageUrl:
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?q=80&w=1200&auto=format&fit=crop',
    videoUrl:
      'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    videoPoster:
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1200&auto=format&fit=crop',
  } satisfies TransformerNodeData,

  ocrTranscriptExtractor: {
    title: 'OCR / Transcript Extractor',
    subtitle: 'Extracts text from images and speech from video/reel content.',
    badge: 'Text extracted',
    body: 'Produces on-image text, scene notes, speech transcript, hook timestamps, key claims, visual framing, CTA extraction, and content pattern signals.',
  } satisfies TextNodeData,

  briefOutputTransformer: {
    kind: 'brief',
    title: 'Output Transformer',
    subtitle: 'Transforms extracted OCR/transcript data into structured content atoms for context building.',
    badge: 'Structured atoms',
    items: [
      { label: 'Core topic',       value: 'Content operations as a repeatable growth system.' },
      { label: 'Content angle',    value: 'Problem-aware educational framing with operational authority.' },
      { label: 'Reusable pattern', value: 'Problem → cost of inaction → framework → proof → CTA.' },
    ],
  } satisfies TransformerNodeData,

  brandGuideline: {
    title: 'Brand Guideline',
    subtitle: 'Additional input for context builder.',
    badge: 'Brand rules',
    body: 'Defines tone, banned claims, visual style, positioning, vocabulary, compliance constraints, and CTA boundaries.',
  } satisfies TextNodeData,

  knowledgeBase: {
    rows: [
      { source: 'Brand Voice',    type: 'Guideline', score: '94%' },
      { source: 'Offer Doc',      type: 'KB',        score: '91%' },
      { source: 'Past Campaign',  type: 'Post',      score: '88%' },
      { source: 'FAQ / Claims',   type: 'KB',        score: '83%' },
    ],
  } satisfies TableNodeData,

  similarityContext: {
    latency: '482ms',
    context: [
      { title: 'Similar previous post', score: '0.91',
        summary: 'Explains content workflow from competitor research to source-backed generation.' },
      { title: 'Competitor cluster', score: '0.86',
        summary: 'Market pattern shows strong response to operational content systems.' },
      { title: 'Internal offer positioning', score: '0.84',
        summary: 'Frames Anubis as orchestration layer for knowledge, competitor intelligence, and execution.' },
    ],
  } satisfies SearchNodeData,

  aiContextBuilder: {
    brief: [
      { label: 'Executor brief', source: 'crawler + transformer',
        value: 'Create content inspired by competitor structure but grounded in internal brand and offer context.' },
      { label: 'Required context', source: 'brand + KB + similarity',
        value: 'Use brand guideline, knowledge base references, previous similar posts, and content angle constraints.' },
      { label: 'Review loop rule', source: 'agent review',
        value: 'If rejected, rebuild the brief using reviewer feedback and send back to executor.' },
    ],
  } satisfies ContextBuilderNodeData,

  agentExecutor: {
    mode: 'executor',
    steps: [
      'Proceed with the approved brief from the context builder.',
      'Generate caption, carousel/reel direction, creative notes, and source-backed claims.',
      'Package draft output for agent review instead of publishing directly.',
    ],
  } satisfies AIAgentNodeData,

  agentReview: {
    checks: [
      { label: 'Brand fit',     description: 'Tone and positioning match guideline', pass: true },
      { label: 'Source support', description: 'Claims backed by context',             pass: true },
      { label: 'Originality',   description: 'Not too close to competitor',          pass: true },
      { label: 'Publish ready', description: 'Approved path continues',              pass: true },
    ],
  } satisfies AgentReviewNodeData,

  readyToPost: {
    title: 'Post: Build a Content Engine, Not Random Posts',
    caption:
      'Most teams do not have a content problem. They have a context problem. A strong workflow connects competitor insight, internal knowledge, brand rules, and execution into one repeatable system.',
    format: 'Carousel / Reel',
    channel: 'Instagram',
    status: 'Ready',
  } satisfies FinalContentNodeData,
} as const

/** 12 nodes positioned to match the reference layout. */
export const sampleFlowNodes: Node[] = [
  { id: 'competitor-post',           type: 'instagramPost',   position: { x: 0,    y:  160 }, data: sampleNodeData.instagramPost },
  { id: 'post-crawler',              type: 'textBlock',       position: { x: 440,  y:  160 }, data: sampleNodeData.postCrawler },
  { id: 'media-output-transformer',  type: 'transformer',     position: { x: 880,  y:  160 }, data: sampleNodeData.mediaOutputTransformer },
  { id: 'ocr-transcript-extractor',  type: 'textBlock',       position: { x: 1320, y:  160 }, data: sampleNodeData.ocrTranscriptExtractor },
  { id: 'brief-output-transformer',  type: 'transformer',     position: { x: 1760, y:  160 }, data: sampleNodeData.briefOutputTransformer },
  { id: 'brand-guideline',           type: 'textBlock',       position: { x: 1760, y: -250 }, data: sampleNodeData.brandGuideline },
  { id: 'knowledge-base',            type: 'referenceTable',  position: { x: 1760, y:  520 }, data: sampleNodeData.knowledgeBase },
  { id: 'similarity-context',        type: 'contextSearch',   position: { x: 1760, y:  890 }, data: sampleNodeData.similarityContext },
  { id: 'ai-context-builder',        type: 'contextBuilder',  position: { x: 2200, y:  160 }, data: sampleNodeData.aiContextBuilder },
  { id: 'agent-executor',            type: 'aiAgent',         position: { x: 2640, y:  160 }, data: sampleNodeData.agentExecutor },
  { id: 'agent-review',              type: 'agentReview',     position: { x: 3080, y:  160 }, data: sampleNodeData.agentReview },
  { id: 'ready-to-post',             type: 'finalContent',    position: { x: 3520, y:  160 }, data: sampleNodeData.readyToPost },
]

interface EdgeSpec {
  id: string
  source: string
  target: string
  label: string
}

const EDGE_SPECS: EdgeSpec[] = [
  { id: 'e1',  source: 'competitor-post',          target: 'post-crawler',             label: 'crawl post' },
  { id: 'e2',  source: 'post-crawler',             target: 'media-output-transformer', label: 'raw output' },
  { id: 'e3',  source: 'media-output-transformer', target: 'ocr-transcript-extractor', label: 'image / video' },
  { id: 'e4',  source: 'ocr-transcript-extractor', target: 'brief-output-transformer', label: 'extracted text' },
  { id: 'e5',  source: 'brief-output-transformer', target: 'ai-context-builder',       label: 'content atoms' },
  { id: 'e6',  source: 'brand-guideline',          target: 'ai-context-builder',       label: 'brand rules' },
  { id: 'e7',  source: 'knowledge-base',           target: 'ai-context-builder',       label: 'KB context' },
  { id: 'e8',  source: 'similarity-context',       target: 'ai-context-builder',       label: 'similarity' },
  { id: 'e9',  source: 'ai-context-builder',       target: 'agent-executor',           label: 'brief' },
  { id: 'e10', source: 'agent-executor',           target: 'agent-review',             label: 'draft' },
  { id: 'e11', source: 'agent-review',             target: 'ready-to-post',            label: 'approved' },
  { id: 'e12', source: 'agent-review',             target: 'ai-context-builder',       label: 'rejected: rebuild brief' },
]

export const sampleFlowEdges: Edge[] = EDGE_SPECS.map((spec) => ({
  ...workflowEdgeDefaults,
  ...workflowEdgeLabelDefaults,
  id: spec.id,
  source: spec.source,
  target: spec.target,
  sourceHandle: WORKFLOW_SOURCE_HANDLE,
  targetHandle: WORKFLOW_TARGET_HANDLE,
  label: spec.label,
}))
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/workflow/demo/sample-data.ts
git commit -m "feat(workflow): add demo sample data (12 nodes, 12 edges)"
```

---

## Task 11: Build the demo gallery + wired flow tabs

**Files:**
- Create: `packages/frontend/src/components/workflow/demo/gallery.tsx`
- Create: `packages/frontend/src/components/workflow/demo/wired-flow.tsx`
- Create: `packages/frontend/src/components/workflow/demo/workflow-demo-page.tsx`

- [ ] **Step 1: Create `gallery.tsx`** — renders each node type once in a standalone container

```tsx
// packages/frontend/src/components/workflow/demo/gallery.tsx
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { workflowNodeTypes } from '../node-types'
import { sampleNodeData } from './sample-data'

interface GalleryItem {
  label: string
  node: Node
}

const ITEMS: GalleryItem[] = [
  { label: 'InstagramPostNode',  node: { id: 'g-ig',     type: 'instagramPost',  position: { x: 0, y: 0 }, data: sampleNodeData.instagramPost } },
  { label: 'TransformerNode (media)', node: { id: 'g-tm', type: 'transformer',  position: { x: 0, y: 0 }, data: sampleNodeData.mediaOutputTransformer } },
  { label: 'TransformerNode (brief)', node: { id: 'g-tb', type: 'transformer',  position: { x: 0, y: 0 }, data: sampleNodeData.briefOutputTransformer } },
  { label: 'TextNode',           node: { id: 'g-tx',    type: 'textBlock',      position: { x: 0, y: 0 }, data: sampleNodeData.postCrawler } },
  { label: 'TableNode',          node: { id: 'g-tb2',   type: 'referenceTable', position: { x: 0, y: 0 }, data: sampleNodeData.knowledgeBase } },
  { label: 'SearchNode',         node: { id: 'g-sr',    type: 'contextSearch',  position: { x: 0, y: 0 }, data: sampleNodeData.similarityContext } },
  { label: 'ContextBuilderNode', node: { id: 'g-cb',    type: 'contextBuilder', position: { x: 0, y: 0 }, data: sampleNodeData.aiContextBuilder } },
  { label: 'AIAgentNode',        node: { id: 'g-ag',    type: 'aiAgent',        position: { x: 0, y: 0 }, data: sampleNodeData.agentExecutor } },
  { label: 'AgentReviewNode',    node: { id: 'g-ar',    type: 'agentReview',    position: { x: 0, y: 0 }, data: sampleNodeData.agentReview } },
  { label: 'FinalContentNode',   node: { id: 'g-fc',    type: 'finalContent',   position: { x: 0, y: 0 }, data: sampleNodeData.readyToPost } },
]

export function WorkflowGallery() {
  return (
    <div className='grid gap-6 p-6 md:grid-cols-2 xl:grid-cols-3'>
      {ITEMS.map((item) => (
        <div key={item.label} className='space-y-2'>
          <p className='text-xs uppercase tracking-[0.18em] text-muted-foreground'>{item.label}</p>
          <div className='h-[420px] rounded-2xl border border-border bg-[#0b0b0c]'>
            <ReactFlowProvider>
              <ReactFlow
                nodes={[item.node]}
                edges={[]}
                nodeTypes={workflowNodeTypes}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                panOnDrag={false}
                panOnScroll={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                nodesDraggable={false}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
              />
            </ReactFlowProvider>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `wired-flow.tsx`** — renders the 12-node Anubis pipeline

```tsx
// packages/frontend/src/components/workflow/demo/wired-flow.tsx
import { useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { applyVisualEdgeRouting } from '../separated-edge'
import { workflowEdgeTypes } from '../edge-types'
import { workflowNodeTypes } from '../node-types'
import { sampleFlowEdges, sampleFlowNodes } from './sample-data'

function WorkflowWiredFlowInner() {
  const [nodes, , onNodesChange] = useNodesState(sampleFlowNodes)
  const [edges, , onEdgesChange] = useEdgesState(sampleFlowEdges)

  const routedEdges = useMemo(() => applyVisualEdgeRouting(edges), [edges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={routedEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={workflowNodeTypes}
      edgeTypes={workflowEdgeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.2}
      maxZoom={1.3}
      defaultViewport={{ x: 20, y: 20, zoom: 0.55 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color='rgba(253, 85, 29, 0.16)' />
      <Controls className='!border-[#fd551d]/20 !bg-[#161617]/90 !text-white' />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        className='!border !border-[#fd551d]/20 !bg-[#161617]/90'
        maskColor='rgba(0,0,0,0.55)'
      />
    </ReactFlow>
  )
}

export function WorkflowWiredFlow() {
  return (
    <div className='relative h-full w-full bg-[#0b0b0c]'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,85,29,0.18),transparent_36%),radial-gradient(circle_at_72%_18%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(to_bottom,rgba(255,255,255,0.035),transparent)]' />
      <div className='relative h-full w-full'>
        <ReactFlowProvider>
          <WorkflowWiredFlowInner />
        </ReactFlowProvider>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `workflow-demo-page.tsx`** — wraps both tabs in the page layout

```tsx
// packages/frontend/src/components/workflow/demo/workflow-demo-page.tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { WorkflowGallery } from './gallery'
import { WorkflowWiredFlow } from './wired-flow'

export function WorkflowDemoPage() {
  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-4'>
        <p className='text-xs uppercase tracking-[0.3em] text-[#fd551d]'>Workflow node library</p>
        <h1 className='mt-2 text-2xl font-semibold tracking-tight'>Components + wired demo</h1>
        <p className='mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground'>
          Gallery shows each node rendered standalone with realistic data. Wired flow renders the full
          Anubis content workflow (competitor post → crawler → transformers → context builder →
          executor → review → ready) using SeparatedEdge for multi-source fan-in.
        </p>
      </div>
      <div className='min-h-0 flex-1'>
        <Tabs defaultValue='gallery' className='flex h-full min-h-0 flex-col'>
          <TabsList className='mx-6 mt-4 self-start'>
            <TabsTrigger value='gallery'>Gallery</TabsTrigger>
            <TabsTrigger value='wired'>Wired flow</TabsTrigger>
          </TabsList>
          <TabsContent value='gallery' className='min-h-0 flex-1 overflow-auto'>
            <WorkflowGallery />
          </TabsContent>
          <TabsContent value='wired' className='min-h-0 flex-1'>
            <WorkflowWiredFlow />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-export the page from `index.ts`**

Append:

```ts
export { WorkflowDemoPage } from './demo/workflow-demo-page'
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/workflow/demo/gallery.tsx \
        packages/frontend/src/components/workflow/demo/wired-flow.tsx \
        packages/frontend/src/components/workflow/demo/workflow-demo-page.tsx \
        packages/frontend/src/components/workflow/index.ts
git commit -m "feat(workflow): add demo gallery + wired flow + page wrapper"
```

---

## Task 12: Wire the `workflow-demo` route into navigation + dashboard

**Files:**
- Modify: `packages/frontend/src/lib/navigation.tsx`
- Modify: `packages/frontend/src/components/dashboard/index.tsx`

- [ ] **Step 1: Extend the `Route` union**

Open `packages/frontend/src/lib/navigation.tsx` and update the `Route` type. The full new type is:

```ts
export type Route =
  | { page: 'home' }
  | { page: 'conversations'; selectedId?: string }
  | { page: 'active-conversation'; conversationId?: string }
  | { page: 'content' }
  | { page: 'profiles' }
  | { page: 'profile-editor'; profileId: string }
  | { page: 'skills' }
  | { page: 'competitors' }
  | { page: 'scheduled' }
  | { page: 'settings' }
  | { page: 'workflow-demo' }
```

- [ ] **Step 2: Add the breadcrumb + page case in `dashboard/index.tsx`**

In `packages/frontend/src/components/dashboard/index.tsx`:

1. Add the import alongside the other page imports:

   ```ts
   import { WorkflowDemoPage } from '@/components/workflow'
   ```

2. Add the breadcrumb entry inside the `BREADCRUMBS` literal:

   ```ts
   'workflow-demo': 'Workflow demo',
   ```

3. Add a case inside the `switch (route.page)` block in `CurrentPage`, right before the `default:` branch:

   ```ts
   case 'workflow-demo':
     return <WorkflowDemoPage />
   ```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS. (TypeScript's exhaustiveness check on `Record<PageKey, string>` ensures the breadcrumb entry is present; the switch is non-exhaustive by design — `default` catches misses.)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/lib/navigation.tsx \
        packages/frontend/src/components/dashboard/index.tsx
git commit -m "feat(workflow): wire workflow-demo route into dashboard"
```

---

## Task 13: Final verification — typecheck, tests, manual smoke

**Files:** none modified

- [ ] **Step 1: Run typecheck across the workspace**

Run: `pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Run the full vitest suite**

Run: `pnpm --filter @anubis/frontend test`
Expected: PASS — includes the 4 `applyVisualEdgeRouting` tests added in Task 4.

- [ ] **Step 3: Manual smoke (desktop dev loop)**

Run: `pnpm dev` (from repo root)

Expected:
- Electron window opens.
- In the renderer devtools console, run: `window.__navigate?.({ page: 'workflow-demo' })` if exposed; otherwise temporarily open the React devtools and call `useNavigation().navigate({ page: 'workflow-demo' })` from a node, or add a one-time button in `dashboard` for verification (then remove before committing — not part of the deliverable).
- A simpler verification path: temporarily set the `NavigationProvider` `initial` prop in `App.tsx` to `{ page: 'workflow-demo' }`, reload, verify, then revert to the original `{ page: 'home' }` default and `git checkout -- packages/frontend/src/App.tsx`.

Verify:
- **Gallery tab**: every one of the nine node types renders inside its own ReactFlow tile; each shows the orange IN handle on the left and OUT handle on the right with the badge text.
- **Wired flow tab**:
  - All 12 sample nodes are visible (fitView centers them).
  - 4 edges fan into `ai-context-builder` from `brief-output-transformer`, `brand-guideline`, `knowledge-base`, `similarity-context` — visually separated, not overlapping at the target.
  - 2 edges fan out from `agent-review`: `approved` → `ready-to-post`, `rejected: rebuild brief` → loops back to `ai-context-builder`.
  - MiniMap and Controls panels render in the bottom corners. Background dot grid uses the orange tint.

- [ ] **Step 4: Commit nothing (verification only)**

If any temporary changes were made to `App.tsx` for smoke testing, ensure they are reverted: `git status` should show no modified files.

---

## Self-review checklist

The plan was reviewed against the spec after writing:

- **Spec coverage** — every Goal 1–9 maps to a task: file layout (Task 1, 2, 3, 5, 9, 10, 11), `NodeShell` API (Task 3), nine specialized nodes (Tasks 6, 7, 8), `SeparatedEdge` + `applyVisualEdgeRouting` (Tasks 4, 5), shared sub-primitives (Task 2), lucide icons (used in every node task), demo route (Tasks 10, 11, 12), shared sample data (Task 10), exported data types (every node task re-exports its `*Data` type from `index.ts`).
- **No placeholders** — every step has the exact code or command.
- **Type consistency** — `WORKFLOW_SOURCE_HANDLE` / `WORKFLOW_TARGET_HANDLE` are declared once in Task 2 and referenced by Task 10. `workflowEdgeDefaults` / `workflowEdgeLabelDefaults` are declared in Task 5 and consumed in Task 10. `workflowNodeTypes` keys (`instagramPost`, `transformer`, `textBlock`, `referenceTable`, `contextSearch`, `contextBuilder`, `aiAgent`, `agentReview`, `finalContent`) are stable across Tasks 9, 10, and 11.
