import { useCallback } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow,
  type Connection, type Edge, type Node, type OnConnect, type OnEdgesChange, type OnNodesChange,
  applyEdgeChanges, applyNodeChanges, addEdge, useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { workflowEdgeTypes, applyVisualEdgeRouting } from '@/components/workflow'
import { executableNodeTypes } from './executable-nodes'
import { useEditorStore } from './editor-store'

function wouldCreateCycle(nodes: Node[], edges: Edge[], candidate: Connection): boolean {
  if (!candidate.source || !candidate.target) return false
  if (candidate.source === candidate.target) return true
  const next = [...edges, { id: 'tmp', source: candidate.source, target: candidate.target } as Edge]
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of next) (adj.get(e.source) ?? []).push(e.target)
  const queue: string[] = [candidate.target]
  const seen = new Set<string>()
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === candidate.source) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    queue.push(...(adj.get(cur) ?? []))
  }
  return false
}

export function EditorCanvas() {
  const nodes = useEditorStore((s) => s.draft.nodes)
  const edges = useEditorStore((s) => s.draft.edges)
  const setNodes = useEditorStore((s) => s.setNodes)
  const setEdges = useEditorStore((s) => s.setEdges)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const setSelection = useEditorStore((s) => s.setSelection)
  const { screenToFlowPosition } = useReactFlow()

  const onNodesChange: OnNodesChange = useCallback((changes) => {
    const next = applyNodeChanges(changes, nodes)
    setNodes(next)
    setSelection(next.filter((n) => n.selected).map((n) => n.id))
  }, [nodes, setNodes, setSelection])

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEdges(applyEdgeChanges(changes, edges))
  }, [edges, setEdges])

  const onConnect: OnConnect = useCallback((conn) => {
    if (wouldCreateCycle(nodes, edges, conn)) return
    pushHistory()
    setEdges(addEdge({ ...conn, id: `e-${Date.now()}`, type: 'separated' }, edges))
  }, [nodes, edges, setEdges, pushHistory])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-anubis-node')) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-anubis-node')
    if (!type) return
    e.preventDefault()
    pushHistory()
    const id = `n-${Date.now()}`
    const newNode: Node = {
      id, type,
      position: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      data: {},
    }
    setNodes([...nodes, newNode])
  }, [nodes, setNodes, pushHistory, screenToFlowPosition])

  const routedEdges = applyVisualEdgeRouting(edges)

  return (
    <div className='relative h-full w-full bg-[#0b0b0c]' onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={routedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={executableNodeTypes}
        edgeTypes={workflowEdgeTypes}
        selectionOnDrag
        panOnDrag={[1, 2]}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color='rgba(253, 85, 29, 0.16)' />
        <Controls className='!border-[#fd551d]/20 !bg-[#161617]/90 !text-white' />
        <MiniMap pannable zoomable nodeStrokeWidth={3}
          className='!border !border-[#fd551d]/20 !bg-[#161617]/90' maskColor='rgba(0,0,0,0.55)' />
      </ReactFlow>
    </div>
  )
}
