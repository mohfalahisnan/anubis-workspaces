import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '@/components/workflow-editor/editor-store'

beforeEach(() => {
  useEditorStore.setState({
    workflowId: 'w1', name: 'W', draft: { nodes: [], edges: [] }, published: null,
    draftUpdatedAt: 0, publishedAt: null, isDirty: false, selection: [],
    history: { past: [], future: [] }, clipboard: null, activeRun: null, inspectorMode: 'config',
  })
})

describe('editor history', () => {
  it('undo restores the previous snapshot', () => {
    const s = useEditorStore.getState()
    s.pushHistory()
    s.setNodes([{ id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    expect(useEditorStore.getState().draft.nodes.length).toBe(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().draft.nodes.length).toBe(0)
  })

  it('redo restores the undone snapshot', () => {
    const s = useEditorStore.getState()
    s.pushHistory()
    s.setNodes([{ id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    s.undo()
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().draft.nodes.length).toBe(1)
  })

  it('pushing history after an undo clears the future', () => {
    const s = useEditorStore.getState()
    s.pushHistory()
    s.setNodes([{ id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    s.undo()
    useEditorStore.getState().pushHistory()
    useEditorStore.getState().setNodes([{ id: 'b', position: { x: 0, y: 0 }, data: {}, type: 'table' } as never])
    expect(useEditorStore.getState().history.future.length).toBe(0)
  })
})
