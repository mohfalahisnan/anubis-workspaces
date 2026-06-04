import { useEffect, useRef } from 'react'
import { workflowsApi } from '@/api/workflows'
import { useEditorStore } from './editor-store'

const DEBOUNCE_MS = 800

export function useAutosaveDraft() {
  const workflowId = useEditorStore((s) => s.workflowId)
  const draft = useEditorStore((s) => s.draft)
  const name = useEditorStore((s) => s.name)
  const isDirty = useEditorStore((s) => s.isDirty)
  const markSaved = useEditorStore((s) => s.markSaved)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!workflowId || !isDirty) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        await workflowsApi.saveDraft(workflowId, JSON.stringify(draft))
        await workflowsApi.patchMeta(workflowId, { name })
        markSaved(Date.now())
      } catch (e) {
        console.error('autosave failed', e)
      }
    }, DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [draft, name, workflowId, isDirty, markSaved])
}
