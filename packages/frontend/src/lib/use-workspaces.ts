import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceSummary } from '@anubis/shared'
import { listWorkspaces, removeWorkspace } from '@/api'

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])

  const refetch = useCallback(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => {})
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const remove = useCallback(
    async (path: string) => {
      try { await removeWorkspace(path) } catch { /* ignore */ }
      setWorkspaces((prev) => prev.filter((w) => w.path !== path))
    },
    [],
  )

  return { workspaces, refetch, remove }
}
