import { useCallback } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useEditorStore } from '../editor-store'

export function serializeSelection(nodes: Node[], edges: Edge[], selectedIds: string[]): string {
  const set = new Set(selectedIds)
  const selectedNodes = nodes.filter((n) => set.has(n.id))
  const selectedEdges = edges.filter((e) => set.has(e.source) && set.has(e.target))
  return JSON.stringify({ nodes: selectedNodes, edges: selectedEdges })
}

export function deserializeSelection(
  json: string,
  newId: () => string,
  offset: { dx: number; dy: number },
): { nodes: Node[]; edges: Edge[] } {
  const parsed = JSON.parse(json) as { nodes: Node[]; edges: Edge[] }
  const idMap = new Map<string, string>()
  const nodes: Node[] = parsed.nodes.map((n) => {
    const id = newId()
    idMap.set(n.id, id)
    return { ...n, id, position: { x: n.position.x + offset.dx, y: n.position.y + offset.dy }, selected: true }
  })
  const edges: Edge[] = parsed.edges.map((e) => ({
    ...e, id: newId(),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }))
  return { nodes, edges }
}

export function useEditorClipboard() {
  const draft = useEditorStore((s) => s.draft)
  const selection = useEditorStore((s) => s.selection)
  const setClipboard = useEditorStore((s) => s.setClipboard)
  const clipboard = useEditorStore((s) => s.clipboard)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const setNodes = useEditorStore((s) => s.setNodes)
  const setEdges = useEditorStore((s) => s.setEdges)

  const copy = useCallback(() => {
    if (selection.length === 0) return
    const serialized = serializeSelection(draft.nodes, draft.edges, selection)
    setClipboard(serialized)
    void navigator.clipboard?.writeText(serialized).catch(() => {})
  }, [draft, selection, setClipboard])

  const paste = useCallback(async () => {
    let src = clipboard
    if (!src) {
      try { src = await navigator.clipboard.readText() } catch { return }
      if (!src.startsWith('{')) return
    }
    let counter = Date.now()
    const newId = () => `n${counter++}`
    const { nodes: pastedNodes, edges: pastedEdges } = deserializeSelection(src, newId, { dx: 20, dy: 20 })
    pushHistory()
    setNodes([...draft.nodes, ...pastedNodes])
    setEdges([...draft.edges, ...pastedEdges])
  }, [clipboard, draft, pushHistory, setNodes, setEdges])

  return { copy, paste }
}
