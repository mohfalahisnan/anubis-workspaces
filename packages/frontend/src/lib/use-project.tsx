import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  type ProjectSummary,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@anubis/shared'
import {
  listProjects,
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
} from '@/api'

interface ProjectState {
  projects: ProjectSummary[]
  activeProject: ProjectSummary | null
  setActiveProjectId: (id: string) => void
  createProject: (input: CreateProjectInput) => Promise<ProjectSummary>
  updateProject: (id: string, patch: UpdateProjectInput) => Promise<ProjectSummary>
  deleteProject: (id: string) => Promise<void>
  refresh: () => Promise<void>
  loading: boolean
}

const ProjectContext = createContext<ProjectState | undefined>(undefined)

const LOCAL_STORAGE_KEY = 'anubis:activeProjectId'

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() => {
    return localStorage.getItem(LOCAL_STORAGE_KEY)
  })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const items = await listProjects()
      setProjects(items)
    } catch (e) {
      console.error('Failed to list projects:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setActiveProjectId = useCallback((id: string) => {
    setActiveProjectIdState(id)
    localStorage.setItem(LOCAL_STORAGE_KEY, id)
  }, [])

  const createProject = useCallback(async (input: CreateProjectInput) => {
    const p = await apiCreateProject(input)
    setProjects((prev) => [...prev, p])
    // Auto-select the newly created project
    setActiveProjectId(p.id)
    return p
  }, [setActiveProjectId])

  const updateProject = useCallback(async (id: string, patch: UpdateProjectInput) => {
    const p = await apiUpdateProject(id, patch)
    setProjects((prev) => prev.map((item) => (item.id === id ? p : item)))
    return p
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await apiDeleteProject(id)
    setProjects((prev) => prev.filter((item) => item.id !== id))
    if (activeProjectId === id) {
      setActiveProjectId('default')
    }
  }, [activeProjectId, setActiveProjectId])

  // Determine active project based on activeProjectId state
  let activeProject = projects.find((p) => p.id === activeProjectId) || null
  if (!activeProject && projects.length > 0) {
    activeProject = projects.find((p) => p.id === 'default') || projects[0] || null
  }

  const value: ProjectState = {
    projects,
    activeProject,
    setActiveProjectId,
    createProject,
    updateProject,
    deleteProject,
    refresh,
    loading,
  }

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject() {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return context
}
