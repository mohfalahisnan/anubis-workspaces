import { useEffect, useRef } from 'react'
import { workflowsApi } from '@/api/workflows'
import { useEditorStore, type Snapshot } from './editor-store'

const DEBOUNCE_MS = 800

interface PendingSave {
  workflowId: string
  draft: Snapshot
  name: string
}

export function useAutosaveDraft() {
  const workflowId = useEditorStore((s) => s.workflowId)
  const draft = useEditorStore((s) => s.draft)
  const name = useEditorStore((s) => s.name)
  const isDirty = useEditorStore((s) => s.isDirty)
  const markSaved = useEditorStore((s) => s.markSaved)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<PendingSave | null>(null)

  // Mirror the latest dirty snapshot for the on-unmount flush. Kept in a ref so
  // it doesn't itself trigger re-renders.
  pending.current = isDirty && workflowId ? { workflowId, draft, name } : null

  useEffect(() => {
    if (!workflowId || !isDirty) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void (async () => {
        try {
          await workflowsApi.saveDraft(workflowId, JSON.stringify(draft))
          await workflowsApi.patchMeta(workflowId, { name })
          markSaved(Date.now())
        } catch (e) {
          console.error('autosave failed', e)
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [draft, name, workflowId, isDirty, markSaved])

  // Flush on unmount — fire-and-forget so navigating away mid-debounce doesn't
  // lose changes. The fetch stays in flight even after the component goes away.
  useEffect(() => {
    return () => {
      const p = pending.current
      if (!p) return
      void workflowsApi
        .saveDraft(p.workflowId, JSON.stringify(p.draft))
        .then(() => workflowsApi.patchMeta(p.workflowId, { name: p.name }))
        .catch((e) => console.error('autosave flush on unmount failed', e))
    }
  }, [])
}
