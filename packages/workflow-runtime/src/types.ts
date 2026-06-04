import { z } from 'zod'

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: NodePositionSchema,
  /** Node config payload. Named `data` to match React Flow's wire shape. */
  data: z.unknown(),
})

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
})

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
})

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface ExecutorInput<TConfig> {
  nodeId: string
  config: TConfig
  upstream: Record<string, unknown>
  /** Outgoing nodes — used by AI-aware executors to tailor their output. */
  downstream: Array<{ nodeId: string; type: string }>
}

export interface Executor<TConfig = unknown> {
  type: string
  validateConfig(raw: unknown): TConfig
  run(input: ExecutorInput<TConfig>, ctx: ExecutorContext): Promise<unknown>
}

export interface CapturedPost {
  id: string
  caption?: string
  mediaUrls: string[]
  metrics?: { likes?: number; comments?: number }
  [key: string]: unknown
}

export interface ExecutorContext {
  crawler: { captureProfile: (url: string) => Promise<CapturedPost> }
  ocr:     { extractFromImage: (path: string) => Promise<string> }
  db:      { getCapturedPost: (id: string) => Promise<CapturedPost> }
  fs:      { writeRunArtifact: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string> }
  conversations: {
    createAndAwaitFirstTurn(input: {
      title: string
      profileId: string
      reasoning?: 'minimal' | 'low' | 'medium' | 'high'
      content: string
    }): Promise<{ conversationId: string; messageId: string; text: string }>
    cancel(conversationId: string): Promise<void>
  }
  runId:   string
  signal:  AbortSignal
  emit:    (event: NodeRunEvent) => void
}

export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }

export type RunLifecycleEvent =
  | { kind: 'run-started';  runId: string; at: number }
  | { kind: 'run-finished'; runId: string; at: number; status: RunStatus; error?: string }

export type RunEvent = NodeRunEvent | RunLifecycleEvent
