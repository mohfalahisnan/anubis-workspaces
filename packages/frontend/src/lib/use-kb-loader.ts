import { create } from 'zustand'
import type { KnowledgeBaseStats } from '@anubis/shared'
import { getKnowledgeBaseStats } from '@/api'

interface KbLoaderState {
  loading: boolean
  progressText: string
  error: string | null

  kbStats: Record<string, KnowledgeBaseStats | null>

  loadProjectData: (projectId: string, force?: boolean) => Promise<void>
  clearProjectData: (projectId: string) => void
}

export const useKbLoader = create<KbLoaderState>((set, get) => ({
  loading: false,
  progressText: '',
  error: null,
  kbStats: {},

  loadProjectData: async (projectId: string, force = false) => {
    const state = get()
    const isLoaded = state.kbStats[projectId] !== undefined
    if (isLoaded && !force) return

    set({ loading: true, error: null, progressText: 'Fetching index stats...' })

    try {
      const stats = await getKnowledgeBaseStats(projectId)
      set((s) => ({
        kbStats: { ...s.kbStats, [projectId]: stats },
        progressText: 'Done',
        loading: false,
      }))
    } catch (e) {
      console.error('Failed to background load project KB:', e)
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load database.',
        progressText: 'Error loading engine',
      })
    }
  },

  clearProjectData: (projectId: string) => {
    set((s) => {
      const kbStats = { ...s.kbStats }
      delete kbStats[projectId]
      return { kbStats }
    })
  },
}))
