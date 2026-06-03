import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { workflowNodeTypes } from '../node-types'
import { sampleNodeData } from './sample-data'

interface GalleryItem {
  label: string
  node: Node
}

const ITEMS: GalleryItem[] = [
  { label: 'InstagramPostNode',       node: { id: 'g-ig',  type: 'instagramPost',  position: { x: 0, y: 0 }, data: { ...sampleNodeData.instagramPost } } },
  { label: 'TransformerNode (media)', node: { id: 'g-tm',  type: 'transformer',    position: { x: 0, y: 0 }, data: { ...sampleNodeData.mediaOutputTransformer } } },
  { label: 'TransformerNode (brief)', node: { id: 'g-tb',  type: 'transformer',    position: { x: 0, y: 0 }, data: { ...sampleNodeData.briefOutputTransformer } } },
  { label: 'TextNode',                node: { id: 'g-tx',  type: 'textBlock',      position: { x: 0, y: 0 }, data: { ...sampleNodeData.postCrawler } } },
  { label: 'TableNode',               node: { id: 'g-tb2', type: 'referenceTable', position: { x: 0, y: 0 }, data: { ...sampleNodeData.knowledgeBase } } },
  { label: 'SearchNode',              node: { id: 'g-sr',  type: 'contextSearch',  position: { x: 0, y: 0 }, data: { ...sampleNodeData.similarityContext } } },
  { label: 'ContextBuilderNode',      node: { id: 'g-cb',  type: 'contextBuilder', position: { x: 0, y: 0 }, data: { ...sampleNodeData.aiContextBuilder } } },
  { label: 'AIAgentNode',             node: { id: 'g-ag',  type: 'aiAgent',        position: { x: 0, y: 0 }, data: { ...sampleNodeData.agentExecutor } } },
  { label: 'AgentReviewNode',         node: { id: 'g-ar',  type: 'agentReview',    position: { x: 0, y: 0 }, data: { ...sampleNodeData.agentReview } } },
  { label: 'FinalContentNode',        node: { id: 'g-fc',  type: 'finalContent',   position: { x: 0, y: 0 }, data: { ...sampleNodeData.readyToPost } } },
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
