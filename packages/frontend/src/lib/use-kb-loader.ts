import { create } from 'zustand'
import type {
  KnowledgeBaseDocument,
  KnowledgeBaseStats,
  KnowledgeBaseGraph,
} from '@anubis/shared'
import {
  getKnowledgeBaseStats,
  listKnowledgeBaseDocuments,
  getKnowledgeBaseIgnoreFile,
  getKnowledgeBaseGraph,
} from '@/api'

interface KbLoaderState {
  loading: boolean
  progressText: string
  error: string | null

  kbStats: Record<string, KnowledgeBaseStats | null>
  kbDocs: Record<string, KnowledgeBaseDocument[] | null>
  kbIgnoreFiles: Record<string, { exists: boolean; path: string; content: string } | null>
  graphs: Record<string, KnowledgeBaseGraph | null>

  loadProjectData: (projectId: string, force?: boolean) => Promise<void>
  clearProjectData: (projectId: string) => void
}

export const useKbLoader = create<KbLoaderState>((set, get) => ({
  loading: false,
  progressText: '',
  error: null,
  kbStats: {},
  kbDocs: {},
  kbIgnoreFiles: {},
  graphs: {},

  loadProjectData: async (projectId: string, force = false) => {
    const state = get()
    const isLoaded = state.kbStats[projectId] && state.graphs[projectId]
    if (isLoaded && !force) return

    set({ loading: true, error: null, progressText: 'Connecting to engine...' })

    try {
      // 1. Fetch Ignore File (cheap, disk-only)
      set({ progressText: 'Loading ignore rules...' })
      const ignore = await getKnowledgeBaseIgnoreFile(projectId).catch(() => null)
      set((s) => ({
        kbIgnoreFiles: { ...s.kbIgnoreFiles, [projectId]: ignore },
      }))

      // 2. Fetch stats and document list in parallel
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
      }))

      // 3. Fetch Graph Overview (limit: 250 by default)
      set({ progressText: 'Mapping knowledge graph...' })
      const graph = await getKnowledgeBaseGraph(projectId, 250).catch(() => null)
      set((s) => ({
        graphs: { ...s.graphs, [projectId]: graph },
        progressText: 'Done',
        loading: false,
      }))
    } catch (e) {
      console.error('Failed to background load project KB/graph:', e)
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
      const kbIgnoreFiles = { ...s.kbIgnoreFiles }
      const graphs = { ...s.graphs }

      delete kbStats[projectId]
      delete kbDocs[projectId]
      delete kbIgnoreFiles[projectId]
      delete graphs[projectId]

      return { kbStats, kbDocs, kbIgnoreFiles, graphs }
    })
  },
}))
