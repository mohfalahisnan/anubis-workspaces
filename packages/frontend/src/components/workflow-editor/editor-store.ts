import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'
import type { NodeRunEvent } from '@/api/workflows'

export type StepState = {
  status: 'pending' | 'running' | 'awaiting' | 'succeeded' | 'failed' | 'skipped'
  startedAt?: number
  finishedAt?: number
  output?: unknown
  error?: string
  /** Set while status === 'awaiting' — the human-approval prompt. */
  title?: string
  instructions?: string
}

export type ActiveRun = {
  runId: string
  steps: Record<string, StepState>
  status: 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled'
  error?: string
}

export interface Snapshot { nodes: Node[]; edges: Edge[] }

interface EditorState {
  workflowId: string | null
  projectId: string | null
  name: string
  description?: string
  draft: Snapshot
  published: Snapshot | null
  draftUpdatedAt: number | null
  publishedAt: number | null
  isDirty: boolean

  selection: string[]
  history: { past: Snapshot[]; future: Snapshot[] }
  clipboard: string | null
  activeRun: ActiveRun | null
  inspectorMode: 'config' | 'run'

  hydrate(args: {
    workflowId: string; projectId?: string; name: string; description?: string
    draft: Snapshot; published: Snapshot | null
    draftUpdatedAt: number; publishedAt: number | null
  }): void
  setNodes(nodes: Node[]): void
  setEdges(edges: Edge[]): void
  setName(name: string): void
  pushHistory(): void
  undo(): void
  redo(): void
  setSelection(ids: string[]): void
  markSaved(at: number): void
  markPublished(at: number, snapshot: Snapshot): void
  setClipboard(serialized: string | null): void
  setActiveRun(run: ActiveRun | null): void
  applyRunEvent(event: NodeRunEvent): void
  setInspectorMode(mode: 'config' | 'run'): void
}

function clone(snap: Snapshot): Snapshot {
  return { nodes: snap.nodes.map((n) => ({ ...n })), edges: snap.edges.map((e) => ({ ...e })) }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  workflowId: null,
  projectId: null,
  name: '',
  description: undefined,
  draft: { nodes: [], edges: [] },
  published: null,
  draftUpdatedAt: null,
  publishedAt: null,
  isDirty: false,

  selection: [],
  history: { past: [], future: [] },
  clipboard: null,
  activeRun: null,
  inspectorMode: 'config',

  hydrate(a) {
    set({
      workflowId: a.workflowId,
      projectId: a.projectId ?? 'default',
      name: a.name, description: a.description,
      draft: a.draft, published: a.published,
      draftUpdatedAt: a.draftUpdatedAt, publishedAt: a.publishedAt,
      isDirty: false, selection: [], history: { past: [], future: [] }, clipboard: null,
      activeRun: null, inspectorMode: 'config',
    })
  },
  setNodes(nodes) { set((s) => ({ draft: { ...s.draft, nodes }, isDirty: true })) },
  setEdges(edges) { set((s) => ({ draft: { ...s.draft, edges }, isDirty: true })) },
  setName(name) { set({ name, isDirty: true }) },
  pushHistory() {
    set((s) => ({ history: { past: [...s.history.past, clone(s.draft)], future: [] } }))
  },
  undo() {
    const s = get()
    if (s.history.past.length === 0) return
    const prev = s.history.past[s.history.past.length - 1]!
    set({
      draft: prev,
      history: {
        past: s.history.past.slice(0, -1),
        future: [clone(s.draft), ...s.history.future],
      },
      isDirty: true,
    })
  },
  redo() {
    const s = get()
    if (s.history.future.length === 0) return
    const next = s.history.future[0]!
    set({
      draft: next,
      history: {
        past: [...s.history.past, clone(s.draft)],
        future: s.history.future.slice(1),
      },
      isDirty: true,
    })
  },
  setSelection(ids) { set({ selection: ids }) },
  markSaved(at) { set({ draftUpdatedAt: at, isDirty: false }) },
  markPublished(at, snapshot) { set({ publishedAt: at, published: snapshot }) },
  setClipboard(s) { set({ clipboard: s }) },
  setActiveRun(run) { set({ activeRun: run, inspectorMode: run ? 'run' : 'config' }) },
  applyRunEvent(event) {
    const s = get()
    if (!s.activeRun) return
    const steps = { ...s.activeRun.steps }
    if (event.kind === 'node-started') {
      steps[event.nodeId] = { status: 'running', startedAt: event.at }
    } else if (event.kind === 'node-succeeded') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'succeeded', finishedAt: event.at, output: event.output }
    } else if (event.kind === 'node-failed') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'failed', finishedAt: event.at, error: event.error }
    } else if (event.kind === 'node-awaiting') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'awaiting', title: event.title, instructions: event.instructions }
      set({ activeRun: { ...s.activeRun, status: 'awaiting_approval', steps } })
      return
    } else if (event.kind === 'node-decided') {
      steps[event.nodeId] = { ...steps[event.nodeId], status: 'running' }
      set({ activeRun: { ...s.activeRun, status: 'running', steps } })
      return
    } else if (event.kind === 'run-finished') {
      set({
        activeRun: {
          ...s.activeRun,
          status: event.status as ActiveRun['status'],
          error: event.error,
          steps,
        },
      })
      return
    }
    set({ activeRun: { ...s.activeRun, steps } })
  },
  setInspectorMode(mode) { set({ inspectorMode: mode }) },
}))
