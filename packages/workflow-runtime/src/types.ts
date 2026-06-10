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
  /** Outgoing port the edge leaves from. Branch-aware nodes (humanApproval) use 'approved' | 'rejected'. */
  sourceHandle: z.string().optional(),
  /** `loop: true` marks a back-edge that re-arms a loop body; exempt from cycle checks. */
  data: z.object({ loop: z.boolean().optional() }).optional(),
})

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
})

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>

export type RunStatus = 'pending' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'awaiting' | 'succeeded' | 'failed' | 'skipped'

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
  postUrl?: string
  [key: string]: unknown
}

export interface TranscribeNodeOptions {
  language?: string
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  force?: boolean
}

export interface TranscribeNodeResult {
  text: string
  segments: Array<{ startMs: number; endMs: number; text: string }>
  language?: string
  sidecarPath?: string
  cacheHit?: boolean
}

export type FlowImageRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
export type FlowImageVariations = 1 | 2 | 3 | 4

export interface FlowImageNodeOptions {
  prompt: string
  /** A Flow project URL (…/tools/flow/project/<id>) to open before generating. */
  projectUrl?: string
  ratio?: FlowImageRatio
  variations?: FlowImageVariations
  model?: string
  downloadDir?: string
}

export interface FlowImageNodeResult {
  resultEditUrls: string[]
  downloadedImagePaths?: string[]
  model: string
  ratio: FlowImageRatio
  variations: FlowImageVariations
  tabUrl: string
}

export interface ExecutorContext {
  crawler: { captureProfile: (url: string) => Promise<CapturedPost> }
  ocr:     { extractFromImage: (path: string) => Promise<string> }
  transcribe: { fromMedia: (path: string, opts?: TranscribeNodeOptions) => Promise<TranscribeNodeResult> }
  flow:    { generate: (input: FlowImageNodeOptions) => Promise<FlowImageNodeResult> }
  db:      { getCapturedPost: (id: string) => Promise<CapturedPost> }
  fs:      { writeRunArtifact: (runId: string, nodeId: string, ext: string, data: Buffer) => Promise<string> }
  conversations: {
    createAndAwaitFirstTurn(input: {
      title: string
      profileId: string
      reasoning?: 'minimal' | 'low' | 'medium' | 'high'
      content: string
      source?: 'workflow'
      workflow?: { runId: string; nodeId: string }
    }): Promise<{ conversationId: string; messageId: string; text: string }>
    cancel(conversationId: string): Promise<void>
  }
  approvals: {
    waitFor(nodeId: string, opts: { title?: string; instructions?: string; upstream: unknown }): Promise<{ decision: 'approved' | 'rejected'; notes?: string }>
  }
  planner?: {
    save(input: {
      projectId?: string
      referencePostId?: string
      referenceUrl?: string
      title: string
      status?: 'idea' | 'review' | 'scheduled' | 'published' | 'rejected'
      rawBrief?: string
      improvedDraft?: string
    }): Promise<{ id: string }>
  }
  /** Persistent store of workflow lessons, written as markdown and injected into agent prompts. */
  lessons: {
    write(input: { nodeId: string; lessonType: 'mistake' | 'lesson'; text: string; profileId?: string }): Promise<{ path: string }>
  }
  runId:   string
  signal:  AbortSignal
  emit:    (event: NodeRunEvent) => void
  workspacePath?: string
}

export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }
  | { kind: 'node-awaiting';  nodeId: string; at: number; title?: string; instructions?: string }
  | { kind: 'node-decided';   nodeId: string; at: number; decision: 'approved' | 'rejected'; notes?: string }

export type RunLifecycleEvent =
  | { kind: 'run-started';  runId: string; at: number }
  | { kind: 'run-finished'; runId: string; at: number; status: RunStatus; error?: string }

export type RunEvent = NodeRunEvent | RunLifecycleEvent
