import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WorkflowGraphSchema } from '../src/types.js'
import { assertAcyclicExceptLoops } from '../src/graph.js'
import { executorRegistry } from '../src/executors/index.js'

const FILE = fileURLToPath(new URL('../../../workflows/content-studio.workflow.json', import.meta.url))
const doc = JSON.parse(readFileSync(FILE, 'utf-8')) as {
  anubisWorkflowExport: number
  name: string
  graph: unknown
}

describe('content-studio.workflow.json', () => {
  it('is a versioned export with a name', () => {
    expect(doc.anubisWorkflowExport).toBe(1)
    expect(doc.name).toBe('Content Studio')
  })

  it('is a schema-valid, acyclic-except-loops graph', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    expect(() => assertAcyclicExceptLoops(graph)).not.toThrow()
  })

  it('uses only registered node types', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    for (const node of graph.nodes) {
      expect(executorRegistry[node.type], `missing executor: ${node.type}`).toBeDefined()
    }
  })

  it('includes the markdown viewer, media viewer, and transcript nodes', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    const types = graph.nodes.map((n) => n.type)
    expect(types).toContain('markdownDisplay')
    expect(types).toContain('mediaDisplay')
    expect(types).toContain('transcriber')
  })

  it('feeds the transcript into breakdown via an imageVideo bridge', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    const transcriber = graph.nodes.find((n) => n.type === 'transcriber')!
    expect(transcriber).toBeDefined()
    // transcriber is fed by an imageVideo bridge (instagramPost envelope → file)
    const intoTranscriber = graph.edges.find((e) => e.target === transcriber.id)!
    expect(graph.nodes.find((n) => n.id === intoTranscriber.source)!.type).toBe('imageVideo')
    // transcript output flows into the breakdown agent
    const outOfTranscriber = graph.edges.find((e) => e.source === transcriber.id)!
    expect(graph.nodes.find((n) => n.id === outOfTranscriber.target)!.type).toBe('aiAgentConversation')
  })

  it('wires the AI review gate, its loop, and its branches correctly', () => {
    const graph = WorkflowGraphSchema.parse(doc.graph)
    const gates = graph.nodes.filter((n) => n.type === 'aiReviewGate')
    expect(gates).toHaveLength(1)
    expect((gates[0]!.data as { maxIterations?: number }).maxIterations).toBe(3)

    const gateId = gates[0]!.id
    const approved = graph.edges.find((e) => e.source === gateId && e.sourceHandle === 'approved')
    const rejected = graph.edges.find((e) => e.source === gateId && e.sourceHandle === 'rejected')
    expect(approved, 'approved branch edge').toBeDefined()
    expect(rejected, 'rejected branch edge').toBeDefined()

    // rejected → lessonWriter → loop-back
    const lessonId = rejected!.target
    expect(graph.nodes.find((n) => n.id === lessonId)!.type).toBe('lessonWriter')
    const loop = graph.edges.find((e) => e.source === lessonId && e.data?.loop === true)
    expect(loop, 'loop back-edge from lessonWriter').toBeDefined()
  })
})
