import { create } from 'zustand'
import type {
  KnowledgeBaseDocument,
  KnowledgeBaseStats,
} from '@anubis/shared'
import {
  getKnowledgeBaseStats,
  listKnowledgeBaseDocuments,
} from '@/api'

interface KbLoaderState {
  loading: boolean
  progressText: string
  error: string | null

  kbStats: Record<string, KnowledgeBaseStats | null>
  kbDocs: Record<string, KnowledgeBaseDocument[] | null>

  loadProjectData: (projectId: string, force?: boolean) => Promise<void>
  clearProjectData: (projectId: string) => void
}

export const useKbLoader = create<KbLoaderState>((set, get) => ({
  loading: false,
  progressText: '',
  error: null,
  kbStats: {},
  kbDocs: {},

  loadProjectData: async (projectId: string, force = false) => {
    const state = get()
    const isLoaded = state.kbStats[projectId] !== undefined
    if (isLoaded && !force) return

    set({ loading: true, error: null, progressText: 'Connecting to engine...' })

    try {
      // Fetch stats and document list in parallel
      set({ progressText: 'Fetching index stats...' })
      const [statsRes, docsRes] = await Promise.allSettled([
        getKnowledgeBaseStats(projectId),
        listKnowledgeBaseDocuments(projectId),
      ])

      const stats = statsRes.status === 'fulfilled' ? statsRes.value : null
      const docs = docsRes.status === 'fulfilled' ? docsRes.value : null

      set((s) => ({
        kbStats: { ...s.kbStats, [projectId]: stats },
        kbDocs: { ...s.kbDocs, [projectId]: docs },
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
      const kbDocs = { ...s.kbDocs }

      delete kbStats[projectId]
      delete kbDocs[projectId]

      return { kbStats, kbDocs }
    })
  },
}))
