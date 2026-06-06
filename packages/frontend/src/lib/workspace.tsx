import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import type { BrandWorkspaceSummary } from '@anubis/shared'
import {
  listBrandWorkspaces, createBrandWorkspace, updateBrandWorkspace,
} from '@/api'

const STORAGE_KEY = 'anubis.activeWorkspaceId'
const DEFAULT_ID = 'default-workspace'

interface WorkspaceState {
  workspaces: BrandWorkspaceSummary[]
  activeWorkspaceId: string
  activeWorkspace: BrandWorkspaceSummary | undefined
  setActiveWorkspace: (id: string) => void
  refetch: () => void
  create: (input: { name: string; brandSummary?: string }) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  archive: (id: string) => Promise<void>
}

const Ctx = createContext<WorkspaceState | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<BrandWorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveId] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_ID
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ID
  })

  const refetch = useCallback(() => {
    listBrandWorkspaces().then(setWorkspaces).catch(() => {})
  }, [])

  useEffect(() => { refetch() }, [refetch])

  // Fall back to default if the persisted id is gone (archived/deleted).
  useEffect(() => {
    if (workspaces.length === 0) return
    if (!workspaces.some((w) => w.id === activeWorkspaceId)) {
      setActiveId(DEFAULT_ID)
      localStorage.setItem(STORAGE_KEY, DEFAULT_ID)
    }
  }, [workspaces, activeWorkspaceId])

  const setActiveWorkspace = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setActiveId(id)
  }, [])

  const create = useCallback(async (input: { name: string; brandSummary?: string }) => {
    const ws = await createBrandWorkspace(input)
    setWorkspaces((prev) => [...prev, ws])
    setActiveWorkspace(ws.id)
  }, [setActiveWorkspace])

  const rename = useCallback(async (id: string, name: string) => {
    const ws = await updateBrandWorkspace(id, { name })
    setWorkspaces((prev) => prev.map((w) => (w.id === id ? ws : w)))
  }, [])

  const archive = useCallback(async (id: string) => {
    await updateBrandWorkspace(id, { status: 'archived' })
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
    if (id === activeWorkspaceId) setActiveWorkspace(DEFAULT_ID)
  }, [activeWorkspaceId, setActiveWorkspace])

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  )

  const value = useMemo<WorkspaceState>(() => ({
    workspaces, activeWorkspaceId, activeWorkspace,
    setActiveWorkspace, refetch, create, rename, archive,
  }), [workspaces, activeWorkspaceId, activeWorkspace, setActiveWorkspace, refetch, create, rename, archive])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActiveWorkspace(): WorkspaceState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useActiveWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}

export const DEFAULT_WORKSPACE_ID = DEFAULT_ID
