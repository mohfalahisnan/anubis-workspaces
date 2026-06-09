import { useMemo } from 'react'
import { ReactFlow, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PreviewNode } from './preview-node'

interface WorkflowGraph {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: unknown }>
  edges: Array<{ id: string; source: string; target: string }>
}

const previewNodeTypes: NodeTypes = {
  instagramPost: PreviewNode as never,
  imageVideo: PreviewNode as never,
  jsonTransformer: PreviewNode as never,
  transformerMedia: PreviewNode as never,
  transformerBrief: PreviewNode as never,
  ocrExtractor: PreviewNode as never,
  table: PreviewNode as never,
  aiAgentConversation: PreviewNode as never,
  markdownDisplay: PreviewNode as never,
  instagramDraftPreview: PreviewNode as never,
  humanApproval: PreviewNode as never,
  lessonWriter: PreviewNode as never,
  originalCopy: PreviewNode as never,
  savePlanner: PreviewNode as never,
  outputCapturer: PreviewNode as never,
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
    data: { ...(typeof n.data === 'object' && n.data ? n.data : {}), type: n.type },
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
        nodeTypes={previewNodeTypes}
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
