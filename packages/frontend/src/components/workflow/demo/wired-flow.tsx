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
