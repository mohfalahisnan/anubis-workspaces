import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import {
  NetworkIcon,
  RefreshCwIcon,
  XIcon,
  SlidersHorizontalIcon,
  SearchIcon,
} from 'lucide-react'
import type {
  KnowledgeBaseGraph,
  KnowledgeBaseGraphEdge,
  KnowledgeBaseGraphNode,
} from '@anubis/shared'
import { getKnowledgeBaseNeighborhood } from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { useKbLoader } from '@/lib/use-kb-loader'

type Banner = { kind: 'success' | 'error'; message: string }
type ViewMode = 'overview' | 'neighborhood'

interface GraphCache {
  viewMode: ViewMode
  selectedId: string | null
  limit: number
  depth: number
  searchQuery: string
  linkDistance: number
  chargeStrength: number
  centerStrength: number
  alwaysShowLabels: boolean
  showArrows: boolean
  enableParticles: boolean
  viewType: 'chunk' | 'file'
}

const graphCacheMap = new Map<string, GraphCache>()

const MAX_LIMIT = 1000

export function KnowledgeGraphPage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id

  // Consume background store values
  const backgroundLoading = useKbLoader((s) => s.loading)
  const storeGraph = useKbLoader((s) => projectId ? s.graphs[projectId] : null) || null
  const loadProjectData = useKbLoader((s) => s.loadProjectData)

  const [localGraphOverride, setLocalGraphOverride] = useState<KnowledgeBaseGraph | null>(null)
  const graph = localGraphOverride || storeGraph

  // Load initial values from cache map
  const cached = projectId ? graphCacheMap.get(projectId) : null

  const [viewMode, setViewMode] = useState<ViewMode>(cached ? cached.viewMode : 'overview')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [limit, setLimit] = useState(cached ? cached.limit : 250)
  const [depth, setDepth] = useState(cached ? cached.depth : 2)
  const [selectedId, setSelectedId] = useState<string | null>(cached ? cached.selectedId : null)

  // Obsidian style settings states
  const [searchQuery, setSearchQuery] = useState(cached ? cached.searchQuery : '')
  const [linkDistance, setLinkDistance] = useState(cached ? cached.linkDistance : 70)
  const [chargeStrength, setChargeStrength] = useState(cached ? cached.chargeStrength : -150)
  const [centerStrength, setCenterStrength] = useState(cached ? cached.centerStrength : 0.4)
  const [alwaysShowLabels, setAlwaysShowLabels] = useState(cached ? cached.alwaysShowLabels : false)
  const [showArrows, setShowArrows] = useState(cached ? cached.showArrows : false)
  const [enableParticles, setEnableParticles] = useState(cached ? cached.enableParticles : true)
  const [viewType, setViewType] = useState<'chunk' | 'file'>(cached ? (cached.viewType || 'chunk') : 'chunk')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // ResizeObserver for canvas dimensions
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  useEffect(() => {
    if (!containerRef.current) return
    
    const updateSize = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth
        const height = containerRef.current.clientHeight
        if (width > 0 && height > 0) {
          setDimensions({ width, height })
        }
      }
    }

    updateSize()
    const timer = setTimeout(updateSize, 100)

    const resizeObserver = new ResizeObserver(() => {
      updateSize()
    })
    resizeObserver.observe(containerRef.current)
    
    return () => {
      clearTimeout(timer)
      resizeObserver.disconnect()
    }
  }, [graph])

  // Handle project change: restore cache or reset states
  useEffect(() => {
    const cached = projectId ? graphCacheMap.get(projectId) : null
    
    setLocalGraphOverride(null)
    setViewMode(cached ? cached.viewMode : 'overview')
    setSelectedId(cached ? cached.selectedId : null)
    setLimit(cached ? cached.limit : 250)
    setDepth(cached ? cached.depth : 2)
    setSearchQuery(cached ? cached.searchQuery : '')
    setLinkDistance(cached ? cached.linkDistance : 70)
    setChargeStrength(cached ? cached.chargeStrength : -150)
    setCenterStrength(cached ? cached.centerStrength : 0.4)
    setAlwaysShowLabels(cached ? cached.alwaysShowLabels : false)
    setShowArrows(cached ? cached.showArrows : false)
    setEnableParticles(cached ? cached.enableParticles : true)
    setViewType(cached ? (cached.viewType || 'chunk') : 'chunk')
    
    setBanner(null)
  }, [projectId])

  // Save cache on any state changes
  useEffect(() => {
    if (projectId) {
      graphCacheMap.set(projectId, {
        viewMode,
        selectedId,
        limit,
        depth,
        searchQuery,
        linkDistance,
        chargeStrength,
        centerStrength,
        alwaysShowLabels,
        showArrows,
        enableParticles,
        viewType,
      })
    }
  }, [
    projectId,
    viewMode,
    selectedId,
    limit,
    depth,
    searchQuery,
    linkDistance,
    chargeStrength,
    centerStrength,
    alwaysShowLabels,
    showArrows,
    enableParticles,
    viewType,
  ])

  const loadOverview = useCallback(async () => {
    setLocalGraphOverride(null)
    setViewMode('overview')
    setSelectedId(null)
  }, [])

  const loadNeighborhood = useCallback(async (chunkId: string) => {
    if (!projectId) return
    setBusy(true); setBanner(null)
    try {
      const g = await getKnowledgeBaseNeighborhood({ projectId, chunkId, depth, limit })
      setLocalGraphOverride(g)
      setViewMode('neighborhood')
      setSelectedId(chunkId)
      setBanner({ kind: 'success', message: `Loaded neighborhood of ${chunkId.slice(0, 8)}: ${g.nodes.length} nodes.` })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load neighborhood.' })
    } finally {
      setBusy(false)
    }
  }, [projectId, depth, limit])

  // Transform graph data for react-force-graph-2d
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] }
    
    if (viewType === 'chunk') {
      // Map nodes and edges directly
      const nodes = graph.nodes.map((n) => ({ ...n }))
      const links = graph.edges.map((e) => ({
        source: e.src,
        target: e.dst,
        edgeType: e.edgeType,
        weight: e.weight,
        reason: e.reason,
      }))
      return { nodes, links }
    }

    // --- File-Level Aggregation ---
    const fileNodesMap = new Map<string, any>()
    const chunkToDocMap = new Map<string, string>()

    // 1. Group chunks into file nodes
    graph.nodes.forEach((node) => {
      const docId = node.docId || node.filename || node.id
      chunkToDocMap.set(node.id, docId)

      if (!fileNodesMap.has(docId)) {
        fileNodesMap.set(docId, {
          id: docId,
          filename: node.filename || docId,
          docId: docId,
          docClass: node.docClass,
          degree: 0,
          content: `File: ${node.filename || docId}\n\nContains consolidated chunk associations.`,
        })
      }
    })

    // 2. Map edges between chunk IDs to edges between file IDs
    const fileEdgesMap = new Map<string, any>()

    graph.edges.forEach((edge) => {
      if (edge.edgeType === 'same_doc') return // Skip internal file connections

      const srcDoc = chunkToDocMap.get(edge.src)
      const dstDoc = chunkToDocMap.get(edge.dst)

      if (srcDoc && dstDoc && srcDoc !== dstDoc) {
        const edgeKey = `${srcDoc}->${dstDoc}`
        const existing = fileEdgesMap.get(edgeKey)

        if (existing) {
          existing.weight += edge.weight
          if (edge.reason && !existing.reasons.includes(edge.reason)) {
            existing.reasons.push(edge.reason)
          }
        } else {
          fileEdgesMap.set(edgeKey, {
            source: srcDoc,
            target: dstDoc,
            edgeType: edge.edgeType,
            weight: edge.weight,
            reasons: edge.reason ? [edge.reason] : [],
          })
        }
      }
    })

    const links = Array.from(fileEdgesMap.values()).map((link) => ({
      ...link,
      reason: link.reasons.join('; '),
    }))

    // 3. Recompute node degrees for sizing
    links.forEach((link) => {
      const srcNode = fileNodesMap.get(link.source)
      const dstNode = fileNodesMap.get(link.target)
      if (srcNode) srcNode.degree++
      if (dstNode) dstNode.degree++
    })

    const nodes = Array.from(fileNodesMap.values())

    return { nodes, links }
  }, [graph, viewType])

  const selectedNode = useMemo<any | null>(() => {
    if (!selectedId) return null
    return graphData.nodes.find((n: any) => n.id === selectedId) ?? null
  }, [graphData.nodes, selectedId])

  const selectedEdges = useMemo<any[]>(() => {
    if (!selectedId) return []
    return graphData.links
      .filter((l: any) => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source
        const dstId = typeof l.target === 'object' ? l.target.id : l.target
        return srcId === selectedId || dstId === selectedId
      })
      .map((l: any) => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source
        const dstId = typeof l.target === 'object' ? l.target.id : l.target
        return {
          src: srcId,
          dst: dstId,
          edgeType: l.edgeType,
          weight: l.weight,
          reason: l.reason,
        }
      })
  }, [graphData.links, selectedId])

  // Interaction highlights
  const [hoveredNode, setHoveredNode] = useState<any | null>(null)

  const getLinkId = useCallback((link: any) => {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source
    const dstId = typeof link.target === 'object' ? link.target.id : link.target
    return `${srcId}->${dstId}`
  }, [])

  const { highlightNodes, highlightLinks } = useMemo(() => {
    const nodes = new Set<string>()
    const links = new Set<string>()
    
    const activeNodeId = hoveredNode?.id || selectedId
    
    if (activeNodeId && graph) {
      nodes.add(activeNodeId)
      graph.edges.forEach((edge) => {
        if (edge.src === activeNodeId) {
          nodes.add(edge.dst)
          links.add(`${edge.src}->${edge.dst}`)
        } else if (edge.dst === activeNodeId) {
          nodes.add(edge.src)
          links.add(`${edge.src}->${edge.dst}`)
        }
      })
    }
    
    return { highlightNodes: nodes, highlightLinks: links }
  }, [hoveredNode, selectedId, graph])

  const searchMatches = useMemo(() => {
    const matches = new Set<string>()
    if (!searchQuery.trim() || !graph) return matches

    const query = searchQuery.toLowerCase().trim()
    graphData.nodes.forEach((n: any) => {
      const idMatch = n.id.toLowerCase().includes(query)
      const fileMatch = n.filename?.toLowerCase().includes(query)
      const contentMatch = n.content?.toLowerCase().includes(query)
      if (idMatch || fileMatch || contentMatch) {
        matches.add(n.id)
      }
    })
    return matches
  }, [searchQuery, graphData.nodes])

  const hasActiveHighlight = highlightNodes.size > 0 || searchMatches.size > 0

  const isNodeHighlighted = useCallback((nodeId: string) => {
    if (!hasActiveHighlight) return true
    if (searchMatches.size > 0 && searchMatches.has(nodeId)) return true
    if (highlightNodes.size > 0 && highlightNodes.has(nodeId)) return true
    return false
  }, [hasActiveHighlight, searchMatches, highlightNodes])

  const fgRef = useRef<any>(null)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)

  const handleNodeClick = useCallback((node: any) => {
    const now = Date.now()
    const lastClick = lastClickRef.current
    if (viewType === 'chunk' && lastClick && lastClick.id === node.id && now - lastClick.time < 300) {
      void loadNeighborhood(node.id)
      lastClickRef.current = null
    } else {
      setSelectedId(node.id)
      lastClickRef.current = { id: node.id, time: now }
    }
  }, [loadNeighborhood, viewType])

  // Refresh force graph display when selections or queries change
  useEffect(() => {
    if (fgRef.current && typeof fgRef.current.refresh === 'function') {
      fgRef.current.refresh()
    }
  }, [selectedId, hoveredNode, searchQuery, highlightNodes, highlightLinks, alwaysShowLabels])

  // Center & zoom on load
  useEffect(() => {
    if (fgRef.current && graphData.nodes.length > 0) {
      setTimeout(() => {
        fgRef.current.zoomToFit(400, 50)
      }, 500)
    }
  }, [graphData])

  // Configure simulation forces dynamically
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(chargeStrength)
      fgRef.current.d3Force('link').distance(linkDistance)
      fgRef.current.d3Force('center').strength(centerStrength)
      fgRef.current.d3ReheatSimulation()
    }
  }, [chargeStrength, linkDistance, centerStrength, graphData])

  const updateHighlight = useCallback((node: any) => {
    setHoveredNode(node || null)
  }, [])

  // Custom node rendering on HTML5 canvas (Obsidian-style)
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const id = node.id
    const isSelected = id === selectedId
    const isHovered = hoveredNode && id === hoveredNode.id
    const isActive = isSelected || isHovered
    
    const isHighlighted = isNodeHighlighted(id)
    
    let opacity = 1
    if (hasActiveHighlight && !isHighlighted) {
      opacity = 0.15
    }

    const baseRadius = Math.sqrt(node.degree || 1) * 1.5 + 3
    const radius = isActive ? baseRadius * 1.25 : baseRadius

    // Color mapping based on node properties
    let color = '#a1a1aa' // default Zinc-400
    if (node.docClass === 'reference') {
      color = '#c084fc' // Purple-400
    } else if (node.docClass === 'anchor') {
      color = '#f59e0b' // Amber-500
    } else if (node.docClass === 'manifest') {
      color = '#f43f5e' // Rose-500
    }

    if (searchMatches.has(id)) {
      color = '#3b82f6' // Bright Blue for search matches
    }
    
    if (isSelected) {
      color = '#C9A645' // Anubis Gold
    } else if (isHovered) {
      color = '#E9C46A' // Light Gold
    }

    // Paint node circle
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false)
    ctx.fillStyle = hexToRgba(color, opacity)
    ctx.fill()

    // Highlight border for hovered/selected nodes
    if (isActive) {
      ctx.strokeStyle = hexToRgba('#ffffff', opacity)
      ctx.lineWidth = 1.5 / globalScale
      ctx.stroke()
      
      if (isSelected) {
        ctx.strokeStyle = hexToRgba('#C9A645', 0.4 * opacity)
        ctx.lineWidth = 4 / globalScale
        ctx.stroke()
      }
    }

    // Node label drawing (Obsidian-style: reveal landmarks and zoomed-in tags)
    const isLandmark = (node.degree || 0) >= 12
    const isSearchMatch = searchMatches.has(id)
    const shouldShowLabel =
      alwaysShowLabels ||
      isActive ||
      isSearchMatch ||
      (hasActiveHighlight ? isHighlighted && (globalScale > 1.2 || isLandmark) : (globalScale > 0.8 || isLandmark))

    if (shouldShowLabel) {
      const label = node.filename ? truncMid(node.filename, 20) : id.slice(0, 8)
      const fontSize = Math.max(4, Math.min(11, 9 / globalScale))
      ctx.font = `${isActive ? 'bold' : 'normal'} ${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      
      let textColor = '#e4e4e7' // Zinc-200
      if (isSelected) {
        textColor = '#C9A645'
      } else if (isSearchMatch) {
        textColor = '#60a5fa'
      } else if (hasActiveHighlight && !isHighlighted) {
        textColor = '#52525b' // Zinc-600 (faded)
      }
      
      ctx.fillStyle = hexToRgba(textColor, opacity)
      ctx.fillText(label, node.x, node.y + radius + 3)
    }
  }, [selectedId, hoveredNode, searchMatches, hasActiveHighlight, isNodeHighlighted, alwaysShowLabels])

  // Custom link colors (Obsidian-style)
  const getLinkColor = useCallback((link: any) => {
    const linkId = getLinkId(link)
    const isHighlighted = highlightLinks.has(linkId)
    
    let opacity = 0.2
    if (hasActiveHighlight) {
      opacity = isHighlighted ? 0.75 : 0.02
    }

    let color = '#71717a' // default zinc-500
    switch (link.edgeType) {
      case 'anchor':
        color = '#C9A645'
        break
      case 'proper':
        color = '#22c55e'
        break
      case 'same_doc':
        color = '#71717a'
        break
      case 'manifest':
        color = '#ef4444'
        break
    }

    return hexToRgba(color, opacity)
  }, [highlightLinks, hasActiveHighlight, getLinkId])

  // Custom link widths
  const getLinkWidth = useCallback((link: any) => {
    const linkId = getLinkId(link)
    const isHighlighted = highlightLinks.has(linkId)
    const baseWidth = Math.min(3, 0.4 + (link.weight || 0) * 1.5)
    return hasActiveHighlight ? (isHighlighted ? baseWidth * 1.5 : baseWidth * 0.4) : baseWidth
  }, [highlightLinks, hasActiveHighlight, getLinkId])

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
              <NetworkIcon className={cn('size-8 text-muted-foreground', backgroundLoading && 'animate-pulse text-[var(--anubis-gold)]')} strokeWidth={1.5} />
              <h2 className='text-[16px] font-semibold'>
                {backgroundLoading ? 'Connecting to engine in background...' : 'Graph not loaded'}
              </h2>
              <p className='max-w-md text-[13px] text-muted-foreground'>
                {backgroundLoading
                  ? 'Anubis is mapping the project connections and generating the graph overview in the background. Please wait.'
                  : 'Opening this page is free — Anubis does not auto-query the engine. Pick a node limit and load the overview.'}
              </p>
              {!backgroundLoading && (
                <>
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
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
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

      <div className='flex min-h-0 flex-1 overflow-hidden relative'>
        <div className='relative flex-1 bg-[color-mix(in_oklab,var(--background)_85%,#000)] h-full w-full' ref={containerRef}>
          {graph.nodes.length === 0 ? (
            <div className='flex h-full items-center justify-center text-[13px] text-muted-foreground'>
              No nodes in this view. Try a larger limit or re-index the project.
            </div>
          ) : (
            <>
              {/* Obsidian-Style Floating Settings Overlays */}
              <div className='absolute top-4 right-4 z-10 flex flex-col items-end gap-2'>
                <button
                  type='button'
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md border border-border bg-card/85 text-foreground shadow-md backdrop-blur-sm transition-all hover:bg-card',
                    isSettingsOpen && 'border-[var(--anubis-gold)] bg-card text-[var(--anubis-gold)]'
                  )}
                  title='Graph settings'
                >
                  <SlidersHorizontalIcon className='size-[15px]' />
                </button>
                
                {isSettingsOpen && (
                  <div className='flex w-72 flex-col rounded-md border border-border bg-card/90 p-4 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150'>
                    <div className='mb-3 flex items-center justify-between border-b border-border/60 pb-2'>
                      <h3 className='text-[13px] font-semibold text-foreground'>Graph Settings</h3>
                      <button
                        type='button'
                        onClick={() => setIsSettingsOpen(false)}
                        className='rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground'
                      >
                        <XIcon className='size-3.5' />
                      </button>
                    </div>

                    <div className='space-y-4 text-[12px]'>
                      {/* Search */}
                      <div className='space-y-1.5'>
                        <label className='font-medium text-muted-foreground'>Search nodes</label>
                        <div className='relative'>
                          <SearchIcon className='absolute left-2.5 top-2 size-3.5 text-muted-foreground' />
                          <input
                            type='text'
                            placeholder='Search by name/content...'
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className='h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-[12px] focus:border-[var(--anubis-gold)] focus:outline-none'
                          />
                          {searchQuery && (
                            <button
                              type='button'
                              onClick={() => setSearchQuery('')}
                              className='absolute right-2 top-1.5 text-muted-foreground hover:text-foreground'
                            >
                              <XIcon className='size-3.5' />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* View Mode Toggle */}
                      <div className='space-y-1.5 border-t border-border/40 pt-3'>
                        <label className='font-medium text-muted-foreground'>View Mode</label>
                        <div className='grid grid-cols-2 gap-1 rounded-md bg-background p-0.5 border border-border'>
                          <button
                            type='button'
                            onClick={() => setViewType('chunk')}
                            className={cn(
                              'h-7 rounded text-[11.5px] font-medium transition-all',
                              viewType === 'chunk'
                                ? 'bg-card text-[var(--anubis-gold)] font-semibold shadow-sm border border-border/40'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            Chunks
                          </button>
                          <button
                            type='button'
                            onClick={() => setViewType('file')}
                            className={cn(
                              'h-7 rounded text-[11.5px] font-medium transition-all',
                              viewType === 'file'
                                ? 'bg-card text-[var(--anubis-gold)] font-semibold shadow-sm border border-border/40'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            Files
                          </button>
                        </div>
                      </div>

                      {/* Sliders */}
                      <div className='space-y-3 border-t border-border/40 pt-3'>
                        <div className='space-y-1'>
                          <div className='flex items-center justify-between text-muted-foreground text-[11px]'>
                            <span>Repulsion (Charge)</span>
                            <span className='font-mono font-bold'>{chargeStrength}</span>
                          </div>
                          <input
                            type='range'
                            min='-300'
                            max='-30'
                            step='10'
                            value={chargeStrength}
                            onChange={(e) => setChargeStrength(Number(e.target.value))}
                            className='h-1 w-full cursor-pointer appearance-none rounded-lg bg-border accent-[var(--anubis-gold)]'
                          />
                        </div>

                        <div className='space-y-1'>
                          <div className='flex items-center justify-between text-muted-foreground text-[11px]'>
                            <span>Link Distance</span>
                            <span className='font-mono font-bold'>{linkDistance}px</span>
                          </div>
                          <input
                            type='range'
                            min='20'
                            max='200'
                            step='5'
                            value={linkDistance}
                            onChange={(e) => setLinkDistance(Number(e.target.value))}
                            className='h-1 w-full cursor-pointer appearance-none rounded-lg bg-border accent-[var(--anubis-gold)]'
                          />
                        </div>

                        <div className='space-y-1'>
                          <div className='flex items-center justify-between text-muted-foreground text-[11px]'>
                            <span>Gravity Strength</span>
                            <span className='font-mono font-bold'>{centerStrength.toFixed(2)}</span>
                          </div>
                          <input
                            type='range'
                            min='0'
                            max='1.5'
                            step='0.05'
                            value={centerStrength}
                            onChange={(e) => setCenterStrength(Number(e.target.value))}
                            className='h-1 w-full cursor-pointer appearance-none rounded-lg bg-border accent-[var(--anubis-gold)]'
                          />
                        </div>
                      </div>

                      {/* Toggles */}
                      <div className='space-y-2.5 border-t border-border/40 pt-3'>
                        <label className='flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground'>
                          <input
                            type='checkbox'
                            checked={alwaysShowLabels}
                            onChange={(e) => setAlwaysShowLabels(e.target.checked)}
                            className='rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)]'
                          />
                          <span>Always show labels</span>
                        </label>

                        <label className='flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground'>
                          <input
                            type='checkbox'
                            checked={showArrows}
                            onChange={(e) => setShowArrows(e.target.checked)}
                            className='rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)]'
                          />
                          <span>Show link arrows</span>
                        </label>

                        <label className='flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground'>
                          <input
                            type='checkbox'
                            checked={enableParticles}
                            onChange={(e) => setEnableParticles(e.target.checked)}
                            className='rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)]'
                          />
                          <span>Active particle flow</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Force Graph Canvas Component */}
              <div className='absolute inset-0 overflow-hidden'>
                <ForceGraph2D
                  ref={fgRef}
                  graphData={graphData}
                  width={dimensions.width}
                  height={dimensions.height}
                  backgroundColor='transparent'
                  nodeCanvasObject={nodeCanvasObject}
                  nodePointerAreaPaint={(node: any, color, ctx) => {
                    const baseRadius = Math.sqrt(node.degree || 1) * 1.5 + 3
                    const radius = baseRadius + 3
                    ctx.beginPath()
                    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false)
                    ctx.fillStyle = color
                    ctx.fill()
                  }}
                  nodeLabel={() => ''}
                  onNodeClick={handleNodeClick}
                  onNodeDragEnd={(node: any) => {
                    // Lock node coordinates post-dragging like advanced graph layouts
                    node.fx = node.x
                    node.fy = node.y
                  }}
                  onNodeDrag={(node: any) => {
                    node.fx = node.x
                    node.fy = node.y
                  }}
                  onBackgroundClick={() => setSelectedId(null)}
                  linkColor={getLinkColor}
                  linkWidth={getLinkWidth}
                  linkDirectionalArrowLength={showArrows ? 4 : 0}
                  linkDirectionalArrowRelPos={0.5}
                  linkDirectionalParticles={(link) => (enableParticles && highlightLinks.has(getLinkId(link))) ? 4 : 0}
                  linkDirectionalParticleWidth={1.5}
                  linkDirectionalParticleSpeed={0.008}
                  linkDirectionalParticleColor={() => '#C9A645'}
                  onNodeHover={updateHighlight}
                  cooldownTicks={100}
                />
              </div>
            </>
          )}
        </div>

        {selectedNode && (
          <aside className='flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card px-4 py-4'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
                  {viewType === 'chunk' ? 'Chunk' : 'File'}
                </div>
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
              {viewType === 'chunk' && selectedNode.page !== undefined && (
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
              {viewType === 'chunk' && selectedNode.chunkSignal && (
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
                            className='truncate text-left text-foreground/90 hover:underline font-mono'
                            title={other}
                          >
                            {viewType === 'chunk' ? other.slice(0, 16) : truncMid(other, 24)}
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

            {viewType === 'chunk' && (
              <button
                type='button'
                onClick={() => void loadNeighborhood(selectedNode.id)}
                disabled={busy}
                className='mt-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-3 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
              >
                Load neighborhood
              </button>
            )}
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

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('var(') || hex.startsWith('rgba') || hex.startsWith('rgb')) {
    return hex
  }
  const cleanHex = hex.replace('#', '')
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function truncMid(s: string | undefined | null, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  const half = Math.floor((max - 1) / 2)
  return `${s.slice(0, half)}…${s.slice(-half)}`
}

