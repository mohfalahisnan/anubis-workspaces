import { topologicalSort, incomingEdges } from './graph.js'
import type {
  Executor, ExecutorContext, RunStatus, StepStatus, WorkflowGraph,
} from './types.js'

export interface RunResult {
  status: RunStatus
  outputs: Record<string, unknown>
  stepStatuses: Record<string, StepStatus>
  error?: string
}

export async function runWorkflow(
  graph: WorkflowGraph,
  registry: Record<string, Executor<unknown>>,
  ctx: ExecutorContext,
): Promise<RunResult> {
  const order = topologicalSort(graph)
  for (const node of graph.nodes) {
    if (!registry[node.type]) throw new Error(`unknown node type: ${node.type}`)
    registry[node.type]!.validateConfig(node.data)
  }

  const outputs: Record<string, unknown> = {}
  const stepStatuses: Record<string, StepStatus> = {}
  for (const id of order) stepStatuses[id] = 'pending'

  for (const nodeId of order) {
    if (ctx.signal.aborted) {
      for (const id of order) if (stepStatuses[id] === 'pending') stepStatuses[id] = 'skipped'
      return { status: 'cancelled', outputs, stepStatuses }
    }

    const node = graph.nodes.find((n) => n.id === nodeId)!
    const executor = registry[node.type]!
    const upstream: Record<string, unknown> = {}
    for (const src of incomingEdges(graph, nodeId)) upstream[src] = outputs[src]

    stepStatuses[nodeId] = 'running'
    ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })

    try {
      const output = await executor.run(
        { nodeId, config: node.data as never, upstream },
        ctx,
      )
      outputs[nodeId] = output
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stepStatuses[nodeId] = 'failed'
      ctx.emit({ kind: 'node-failed', nodeId, at: Date.now(), error: message })
      for (const id of order) if (stepStatuses[id] === 'pending') stepStatuses[id] = 'skipped'
      return { status: 'failed', outputs, stepStatuses, error: message }
    }

    if (ctx.signal.aborted) {
      for (const id of order) if (stepStatuses[id] === 'pending') stepStatuses[id] = 'skipped'
      return { status: 'cancelled', outputs, stepStatuses }
    }
  }

  return { status: 'succeeded', outputs, stepStatuses }
}
