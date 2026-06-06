import { assertAcyclicExceptLoops, isLoopEdge } from './graph.js'
import type {
  Executor, ExecutorContext, RunStatus, StepStatus, WorkflowGraph,
} from './types.js'

export interface RunResult {
  status: RunStatus
  outputs: Record<string, unknown>
  stepStatuses: Record<string, StepStatus>
  error?: string
}

type EdgeState = 'pending' | 'active' | 'dead'
const MAX_STEPS = 1000

/** Which outgoing sourceHandle a finished node activates. null = activate all outgoing edges. */
function selectedBranch(output: unknown): string | null {
  if (output && typeof output === 'object' && (output as { kind?: string }).kind === 'approval') {
    const d = (output as { decision?: string }).decision
    if (d === 'approved' || d === 'rejected') return d
  }
  return null
}

/**
 * Frontier scheduler. A node runs once every incoming non-loop edge is settled
 * (active or dead): if at least one is active it runs, if all are dead it is
 * skipped (and its outgoing edges go dead, cascading). A finished node activates
 * its outgoing edges — all of them, or only the branch matching an approval
 * decision (`sourceHandle === decision`). Loop edges (`data.loop`) do not gate
 * readiness; they only feed context (re-arm logic is layered on in a later task).
 */
export async function runWorkflow(
  graph: WorkflowGraph,
  registry: Record<string, Executor<unknown>>,
  ctx: ExecutorContext,
  opts?: { seed?: Record<string, unknown> },
): Promise<RunResult> {
  assertAcyclicExceptLoops(graph)
  for (const node of graph.nodes) {
    if (!registry[node.type]) throw new Error(`unknown node type: ${node.type}`)
    registry[node.type]!.validateConfig(node.data)
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const forward = graph.edges.filter((e) => !isLoopEdge(e))
  const loops = graph.edges.filter(isLoopEdge)
  const inForward = (id: string) => forward.filter((e) => e.target === id)
  const outForward = (id: string) => forward.filter((e) => e.source === id)

  const edgeState = new Map<string, EdgeState>()
  for (const e of forward) edgeState.set(e.id, 'pending')

  const outputs: Record<string, unknown> = {}
  const stepStatuses: Record<string, StepStatus> = {}
  for (const n of graph.nodes) stepStatuses[n.id] = 'pending'

  function markOutgoing(nodeId: string, branch: string | null): void {
    for (const e of outForward(nodeId)) {
      const take = branch === null || (e.sourceHandle ?? null) === branch
      edgeState.set(e.id, take ? 'active' : 'dead')
    }
  }

  function readyNodes(): string[] {
    const out: string[] = []
    for (const n of graph.nodes) {
      if (stepStatuses[n.id] !== 'pending') continue
      if (inForward(n.id).every((e) => edgeState.get(e.id) !== 'pending')) out.push(n.id)
    }
    return out
  }

  function cancel(): RunResult {
    for (const n of graph.nodes) if (stepStatuses[n.id] === 'pending') stepStatuses[n.id] = 'skipped'
    return { status: 'cancelled', outputs, stepStatuses }
  }

  let stepCount = 0
  while (true) {
    if (ctx.signal.aborted) return cancel()
    const ready = readyNodes()
    if (ready.length === 0) break

    let didWork = false
    for (const nodeId of ready) {
      if (ctx.signal.aborted) return cancel()
      if (stepStatuses[nodeId] !== 'pending') continue

      const inc = inForward(nodeId)
      const hasActive = inc.length === 0 || inc.some((e) => edgeState.get(e.id) === 'active')
      if (!hasActive) {                       // all inputs dead → skip + dead-cascade
        stepStatuses[nodeId] = 'skipped'
        for (const e of outForward(nodeId)) edgeState.set(e.id, 'dead')
        didWork = true
        continue
      }

      if (++stepCount > MAX_STEPS) {
        return { status: 'failed', outputs, stepStatuses, error: 'workflow exceeded max steps (unbounded loop?)' }
      }

      const failure = await runNode(nodeId)
      if (failure) return failure
      didWork = true
    }
    if (!didWork) break
  }

  return { status: 'succeeded', outputs, stepStatuses }

  async function runNode(nodeId: string): Promise<RunResult | null> {
    if (opts?.seed && Object.prototype.hasOwnProperty.call(opts.seed, nodeId)) {
      const seeded = opts.seed[nodeId]
      outputs[nodeId] = seeded
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output: seeded })
      markOutgoing(nodeId, null)
      return null
    }

    const node = nodeById.get(nodeId)!
    const upstream: Record<string, unknown> = {}
    for (const e of inForward(nodeId)) if (edgeState.get(e.id) === 'active') upstream[e.source] = outputs[e.source]
    for (const e of loops) if (e.target === nodeId && outputs[e.source] !== undefined) upstream[e.source] = outputs[e.source]

    const downstream = [...outForward(nodeId), ...loops.filter((e) => e.source === nodeId)]
      .map((e) => ({ nodeId: e.target, type: nodeById.get(e.target)!.type }))

    stepStatuses[nodeId] = 'running'
    ctx.emit({ kind: 'node-started', nodeId, at: Date.now() })
    try {
      const output = await registry[node.type]!.run({ nodeId, config: node.data as never, upstream, downstream }, ctx)
      outputs[nodeId] = output
      stepStatuses[nodeId] = 'succeeded'
      ctx.emit({ kind: 'node-succeeded', nodeId, at: Date.now(), output })
      markOutgoing(nodeId, selectedBranch(output))
      return null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stepStatuses[nodeId] = 'failed'
      ctx.emit({ kind: 'node-failed', nodeId, at: Date.now(), error: message })
      for (const n of graph.nodes) if (stepStatuses[n.id] === 'pending') stepStatuses[n.id] = 'skipped'
      return { status: 'failed', outputs, stepStatuses, error: message }
    }
  }
}
