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

// Node components are typed with their concrete `{ data: ... }` shape (cleaner ergonomics
// than the generic NodeProps<Node<T, K>>). React Flow passes additional props (id, position,
// etc.) that our components ignore, so the assignment is safe at runtime but needs an
// `unknown` cast to satisfy the strict NodeTypes signature.
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
} as unknown as NodeTypes

export type WorkflowNodeType = keyof typeof workflowNodeTypes
