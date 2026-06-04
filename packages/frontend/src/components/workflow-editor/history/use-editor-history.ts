import { useEditorStore } from '../editor-store'

export function useEditorHistory() {
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.history.past.length > 0)
  const canRedo = useEditorStore((s) => s.history.future.length > 0)
  return { pushHistory, undo, redo, canUndo, canRedo }
}
