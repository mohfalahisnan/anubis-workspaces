import { useEffect } from 'react'
import { useEditorStore } from './editor-store'
import { useEditorClipboard } from './clipboard/use-editor-clipboard'
import { workflowsApi } from '@/api/workflows'

export function useEditorKeymap() {
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const selection = useEditorStore((s) => s.selection)
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const setEdges = useEditorStore((s) => s.setEdges)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const workflowId = useEditorStore((s) => s.workflowId)
  const markSaved = useEditorStore((s) => s.markSaved)
  const markPublished = useEditorStore((s) => s.markPublished)
  const name = useEditorStore((s) => s.name)
  const { copy, paste } = useEditorClipboard()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const inFormInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const cmd = e.ctrlKey || e.metaKey

      // Ctrl+S (save) and Ctrl+Shift+S (publish) always work — even from inside form inputs,
      // otherwise the browser's "save page" action fires.
      if (cmd && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault()
        if (!workflowId) return
        workflowsApi.saveDraft(workflowId, JSON.stringify(draft))
          .then(() => workflowsApi.patchMeta(workflowId, { name }))
          .then(() => markSaved(Date.now())).catch(console.error)
        return
      }
      if (cmd && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!workflowId) return
        workflowsApi.publish(workflowId).then((wf) => {
          if (wf.publishedAt) markPublished(wf.publishedAt, JSON.parse(wf.publishedGraph ?? '{"nodes":[],"edges":[]}'))
        }).catch(console.error)
        return
      }

      // The remaining shortcuts (undo/redo/copy/paste/delete) should not fire while
      // typing into a form field — those keys belong to the input.
      if (inFormInput) return

      if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((cmd && e.key.toLowerCase() === 'y') || (cmd && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); return }
      if (cmd && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); return }
      if (cmd && e.key.toLowerCase() === 'v') { e.preventDefault(); void paste(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.length === 0) return
        e.preventDefault()
        pushHistory()
        setNodes(draft.nodes.filter((n) => !selection.includes(n.id)))
        setEdges(draft.edges.filter((edge) => !selection.includes(edge.source) && !selection.includes(edge.target)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, copy, paste, selection, draft, setNodes, setEdges, pushHistory, workflowId, markSaved, markPublished, name])
}
