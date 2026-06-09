import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  type Edge as RfEdge,
  type Node as RfNode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  NetworkIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import type {
  KnowledgeBaseGraph,
  KnowledgeBaseGraphEdge,
  KnowledgeBaseGraphNode,
} from '@anubis/shared'
import { getKnowledgeBaseGraph, getKnowledgeBaseNeighborhood } from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }
type ViewMode = 'overview' | 'neighborhood'

const NODE_RADIUS = 38
const MAX_LIMIT = 1000

export function KnowledgeGraphPage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id

  const [graph, setGraph] = useState<KnowledgeBaseGraph | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('overview')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [limit, setLimit] = useState(250)
  const [depth, setDepth] = useState(2)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    // Clear when project changes; never auto-fetch the engine.
    setGraph(null); setSelectedId(null); setViewMode('overview'); setBanner(null)
  }, [projectId])

  const loadOverview = useCallback(async () => {
    if (!projectId) return
    setBusy(true); setBanner(null)
    try {
      const g = await getKnowledgeBaseGraph(projectId, limit)
      setGraph(g); setViewMode('overview'); setSelectedId(null)
      setBanner({ kind: 'success', message: `Loaded ${g.nodes.length} nodes, ${g.edges.length} edges.` })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load graph.' })
    } finally {
      setBusy(false)
    }
  }, [projectId, limit])

  const loadNeighborhood = useCallback(async (chunkId: string) => {
    if (!projectId) return
    setBusy(true); setBanner(null)
    try {
      const g = await getKnowledgeBaseNeighborhood({ projectId, chunkId, depth, limit })
      setGraph(g); setViewMode('neighborhood'); setSelectedId(chunkId)
      setBanner({ kind: 'success', message: `Loaded neighborhood of ${chunkId.slice(0, 8)}: ${g.nodes.length} nodes.` })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load neighborhood.' })
    } finally {
      setBusy(false)
    }
  }, [projectId, depth, limit])

  const { rfNodes, rfEdges } = useMemo(() => layoutGraph(graph, selectedId), [graph, selectedId])

  const selectedNode = useMemo<KnowledgeBaseGraphNode | null>(() => {
    if (!graph || !selectedId) return null
    return graph.nodes.find((n) => n.id === selectedId) ?? null
  }, [graph, selectedId])

  const selectedEdges = useMemo<KnowledgeBaseGraphEdge[]>(() => {
    if (!graph || !selectedId) return []
    return graph.edges.filter((e) => e.src === selectedId || e.dst === selectedId)
  }, [graph, selectedId])

  if (!projectId) {
    return (
      <EmptyState
        title='Pick a project to view its Knowledge Graph'
        body='The graph is scoped to the active project. Create or select a project from the top bar.'
      />
    )
  }

  if (!graph) {
    return (
      <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
        <div className='mx-auto w-full max-w-[860px] px-7 pb-16'>
          <div className='flex flex-col gap-4 pt-7'>
            <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>Knowledge Graph</h1>
            <p className='max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground'>
              Visualise the relations engine across indexed chunks. Opening this page is free — Anubis does not auto-query the engine. Pick a node limit and load the overview.
            </p>
          </div>

          {banner && <BannerBlock banner={banner} />}

          <section className='mt-8 rounded-lg border border-dashed border-border bg-card/60 p-8'>
            <div className='flex flex-col items-center gap-4 text-center'>
              <NetworkIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
              <h2 className='text-[16px] font-semibold'>Graph not loaded</h2>
              <div className='flex flex-col gap-2 text-[12.5px] text-muted-foreground'>
                <label className='flex items-center gap-2'>
                  Node limit:
                  <input
                    type='number'
                    min={1}
                    max={MAX_LIMIT}
                    value={limit}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setLimit(Number.isFinite(n) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(n))) : 250)
                    }}
                    className='h-8 w-24 rounded-md border border-border bg-background px-2 font-mono text-foreground'
                  />
                </label>
              </div>
              <button
                type='button'
                onClick={() => void loadOverview()}
                disabled={busy}
                className='mt-1 inline-flex h-10 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
              >
                <RefreshCwIcon className={cn('size-[15px]', busy && 'animate-spin')} strokeWidth={1.8} />
                {busy ? 'Loading…' : 'Load graph overview'}
              </button>
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-1 flex-col bg-background'>
      <header className='flex items-center justify-between gap-3 border-b border-border px-7 py-4'>
        <div className='flex items-baseline gap-3'>
          <h1 className='text-[20px] font-semibold leading-tight tracking-tight'>Knowledge Graph</h1>
          <span className='font-mono text-[11.5px] text-muted-foreground'>
            {viewMode === 'overview' ? 'Overview' : `Neighborhood (depth ${depth})`} · {graph.nodes.length} nodes · {graph.edges.length} edges
          </span>
        </div>
        <div className='flex items-center gap-2'>
          <label className='flex items-center gap-1.5 text-[12px] text-muted-foreground'>
            Limit
            <input
              type='number'
              min={1}
              max={MAX_LIMIT}
              value={limit}
              onChange={(e) => {
                const n = Number(e.target.value)
                setLimit(Number.isFinite(n) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(n))) : 250)
              }}
              className='h-8 w-20 rounded-md border border-border bg-card px-2 font-mono text-[12px] text-foreground'
            />
          </label>
          {viewMode === 'neighborhood' && (
            <label className='flex items-center gap-1.5 text-[12px] text-muted-foreground'>
              Depth
              <select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className='h-8 rounded-md border border-border bg-card px-2 text-[12px] text-foreground'
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
          )}
          <button
            type='button'
            onClick={() => void loadOverview()}
            disabled={busy}
            className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] text-foreground transition-colors hover:bg-card/70 disabled:opacity-50'
          >
            <RefreshCwIcon className={cn('size-[13px]', busy && 'animate-spin')} strokeWidth={1.8} />
            Overview
          </button>
          {selectedId && (
            <button
              type='button'
              onClick={() => void loadNeighborhood(selectedId)}
              disabled={busy}
              className='inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-3 text-[12.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
            >
              Neighborhood
            </button>
          )}
        </div>
      </header>

      {banner && (
        <div className='border-b border-border px-7 py-2'>
          <BannerBlock banner={banner} dense />
        </div>
      )}

      <div className='flex min-h-0 flex-1'>
        <div className='relative flex-1 bg-[color-mix(in_oklab,var(--background)_85%,#000)]'>
          {graph.nodes.length === 0 ? (
            <div className='flex h-full items-center justify-center text-[13px] text-muted-foreground'>
              No nodes in this view. Try a larger limit or re-index the project.
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              fitView
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable
              elementsSelectable
              minZoom={0.05}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={32} size={1} color='color-mix(in oklab, var(--foreground) 8%, transparent)' />
              <Controls showInteractive={false} />
              <Panel position='top-left' className='rounded-md border border-border bg-card/80 px-2.5 py-1.5 text-[11.5px] text-muted-foreground'>
                Click a node to inspect · drag to rearrange
              </Panel>
            </ReactFlow>
          )}
        </div>

        {selectedNode && (
          <aside className='flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card px-4 py-4'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>Chunk</div>
                <div className='truncate font-mono text-[12px] text-foreground'>{selectedNode.id}</div>
              </div>
              <button
                type='button'
                onClick={() => setSelectedId(null)}
                aria-label='Close panel'
                className='shrink-0 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground'
              >
                <XIcon className='size-4' strokeWidth={1.8} />
              </button>
            </div>

            <div className='space-y-1 text-[12.5px]'>
              <div className='flex items-baseline justify-between gap-2'>
                <span className='text-muted-foreground'>File</span>
                <span className='truncate text-right font-mono text-foreground/90'>{selectedNode.filename || '—'}</span>
              </div>
              <div className='flex items-baseline justify-between gap-2'>
                <span className='text-muted-foreground'>Document</span>
                <span className='truncate text-right font-mono text-[11px] text-foreground/80'>{selectedNode.docId || '—'}</span>
              </div>
              <div className='flex items-baseline justify-between gap-2'>
                <span className='text-muted-foreground'>Degree</span>
                <span className='font-mono tabular-nums text-foreground'>{selectedNode.degree}</span>
              </div>
              {selectedNode.page !== undefined && (
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-muted-foreground'>Page</span>
                  <span className='font-mono tabular-nums text-foreground'>{selectedNode.page}</span>
                </div>
              )}
              {selectedNode.docClass && (
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-muted-foreground'>Doc class</span>
                  <span className='font-mono text-foreground'>{selectedNode.docClass}</span>
                </div>
              )}
              {selectedNode.chunkSignal && (
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-muted-foreground'>Signal</span>
                  <span className='font-mono text-foreground'>{selectedNode.chunkSignal}</span>
                </div>
              )}
            </div>

            <div>
              <div className='mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>Content</div>
              <pre className='max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 text-[12px] text-foreground/90'>
                {selectedNode.content || '(empty)'}
              </pre>
            </div>

            {selectedEdges.length > 0 && (
              <div>
                <div className='mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>Edges ({selectedEdges.length})</div>
                <ul className='flex flex-col gap-1'>
                  {selectedEdges.map((e, i) => {
                    const other = e.src === selectedNode.id ? e.dst : e.src
                    return (
                      <li key={`${e.src}-${e.dst}-${i}`} className='rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px]'>
                        <div className='flex items-baseline justify-between gap-2'>
                          <button
                            type='button'
                            onClick={() => setSelectedId(other)}
                            className='truncate text-left text-foreground/90 hover:underline'
                          >
                            {other.slice(0, 16)}
                          </button>
                          <span className='shrink-0 text-muted-foreground'>{e.edgeType}{e.weight ? ` · w=${e.weight.toFixed(2)}` : ''}</span>
                        </div>
                        {e.reason && (
                          <div className='mt-0.5 truncate text-[10.5px] text-muted-foreground'>{e.reason}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            <button
              type='button'
              onClick={() => void loadNeighborhood(selectedNode.id)}
              disabled={busy}
              className='mt-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-3 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
            >
              Load neighborhood
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

function BannerBlock({ banner, dense }: { banner: Banner; dense?: boolean }) {
  return (
    <div role='status' className={cn(
      'rounded-md border px-3.5 text-[13px]',
      dense ? 'py-1.5 text-[12px]' : 'mt-5 py-2.5',
      banner.kind === 'error'
        ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
        : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
    )}>
      {banner.message}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex flex-1 items-center justify-center bg-background'>
      <div className='mx-auto flex max-w-md flex-col items-center gap-3 px-7 text-center'>
        <NetworkIcon className='size-8 text-muted-foreground' strokeWidth={1.5} />
        <h1 className='text-[20px] font-semibold leading-tight'>{title}</h1>
        <p className='text-[13px] leading-relaxed text-muted-foreground'>{body}</p>
      </div>
    </div>
  )
}

/* -----------------------------------------------------------
   Layout: place nodes on concentric rings ordered by degree.
   No physics — predictable, cheap, drag-tolerant. The first
   ring holds the few highest-degree nodes (god nodes); outer
   rings fan out the rest.
   ----------------------------------------------------------- */

function layoutGraph(
  graph: KnowledgeBaseGraph | null,
  selectedId: string | null,
): { rfNodes: RfNode[]; rfEdges: RfEdge[] } {
  if (!graph) return { rfNodes: [], rfEdges: [] }

  const sorted = [...graph.nodes].sort((a, b) => b.degree - a.degree)
  const total = sorted.length || 1

  // Ring count grows with sqrt(N); each outer ring has ~2x the
  // circumference of the one inside it.
  const ringCount = Math.max(1, Math.round(Math.sqrt(total / 3)))
  const ringSizes: number[] = []
  let remaining = total
  for (let r = 0; r < ringCount; r++) {
    const weight = r === 0 ? 1 : Math.pow(2, r)
    ringSizes.push(weight)
  }
  const weightSum = ringSizes.reduce((a, b) => a + b, 0)
  const ringCounts = ringSizes.map((w, i) => {
    if (i === ringSizes.length - 1) return remaining
    const n = Math.max(1, Math.round((w / weightSum) * total))
    remaining -= n
    return n
  })

  const rfNodes: RfNode[] = []
  let cursor = 0
  for (let r = 0; r < ringCounts.length; r++) {
    const ringRadius = 80 + r * 220
    const count = ringCounts[r]
    for (let i = 0; i < count; i++) {
      const node = sorted[cursor++]
      if (!node) break
      const angle = (i / count) * Math.PI * 2 + (r * 0.13)
      const x = Math.cos(angle) * ringRadius
      const y = Math.sin(angle) * ringRadius
      rfNodes.push({
        id: node.id,
        position: { x, y },
        data: { label: nodeLabel(node) },
        type: 'default',
        selected: node.id === selectedId,
        style: nodeStyle(node, node.id === selectedId),
        width: NODE_RADIUS * 2,
        height: NODE_RADIUS * 2,
      })
    }
  }

  const rfEdges: RfEdge[] = graph.edges.map((edge, i) => ({
    id: `${edge.src}->${edge.dst}-${i}`,
    source: edge.src,
    target: edge.dst,
    style: {
      stroke: edgeColor(edge),
      strokeWidth: Math.min(3, 0.4 + (edge.weight ?? 0) * 1.5),
      opacity: 0.55,
    },
    label: undefined,
  }))

  return { rfNodes, rfEdges }
}

function nodeLabel(node: KnowledgeBaseGraphNode): string {
  const base = node.filename ? truncMid(node.filename, 18) : node.id.slice(0, 8)
  return `${base}\n${node.id.slice(0, 6)}`
}

function nodeStyle(node: KnowledgeBaseGraphNode, selected: boolean): React.CSSProperties {
  const gold = 'var(--anubis-gold)'
  const surface = node.docClass === 'reference' ? '#3a312c' : 'var(--card)'
  return {
    borderRadius: '999px',
    border: selected ? `2px solid ${gold}` : '1px solid var(--border)',
    background: surface,
    color: 'var(--foreground)',
    fontSize: 9,
    fontFamily: 'var(--font-mono, monospace)',
    padding: 4,
    textAlign: 'center',
    whiteSpace: 'pre-line',
    lineHeight: 1.15,
    boxShadow: selected ? `0 0 0 4px color-mix(in oklab, ${gold} 25%, transparent)` : undefined,
  }
}

function edgeColor(edge: KnowledgeBaseGraphEdge): string {
  switch (edge.edgeType) {
    case 'anchor':   return '#C9A645'
    case 'proper':   return '#5E8F55'
    case 'same_doc': return '#6B6F78'
    case 'manifest': return '#B5483E'
    default:         return 'color-mix(in oklab, var(--foreground) 35%, transparent)'
  }
}

function truncMid(s: string, max: number): string {
  if (s.length <= max) return s
  const half = Math.floor((max - 1) / 2)
  return `${s.slice(0, half)}…${s.slice(-half)}`
}
