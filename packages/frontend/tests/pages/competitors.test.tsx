import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompetitorSummary } from '@anubis/shared'

const mocks = vi.hoisted(() => ({
  createCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
  exportProjectSnapshot: vi.fn(),
  importProjectSnapshot: vi.fn(),
  listCompetitors: vi.fn(),
  navigate: vi.fn(),
  updateCompetitor: vi.fn(),
}))

vi.mock('@/api', () => ({
  createCompetitor: mocks.createCompetitor,
  deleteCompetitor: mocks.deleteCompetitor,
  exportProjectSnapshot: mocks.exportProjectSnapshot,
  importProjectSnapshot: mocks.importProjectSnapshot,
  listCompetitors: mocks.listCompetitors,
  updateCompetitor: mocks.updateCompetitor,
}))

vi.mock('@/lib/navigation', () => ({
  useNavigation: () => ({ navigate: mocks.navigate }),
}))

vi.mock('@/lib/use-project', () => ({
  useProject: () => ({ activeProject: { id: 'default', name: 'Default Project' } }),
}))

vi.mock('@/lib/use-jobs', () => ({
  useJobs: () => [],
}))

vi.mock('@/hooks/use-competitor-levels', () => ({
  useCompetitorLevels: () => ({ config: undefined }),
}))

import { CompetitorsPage } from '@/pages/competitors'

function competitor(p: Partial<CompetitorSummary> = {}): CompetitorSummary {
  return {
    id: 'c1',
    handle: '@creator',
    postCount: 12,
    addedAt: 0,
    updatedAt: 0,
    platform: 'instagram',
    status: 'active',
    favorite: false,
    followers: 25_000,
    avgLikes: 1_200,
    baselineLikes: 4_321,
    ...p,
  }
}

describe('<CompetitorsPage>', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset())
    mocks.listCompetitors.mockResolvedValue([competitor()])
  })

  it('shows baseline likes for tracked competitors', async () => {
    render(<CompetitorsPage />)

    await waitFor(() => expect(mocks.listCompetitors).toHaveBeenCalledWith('default'))
    expect(await screen.findByText('Baseline')).toBeInTheDocument()
    expect(screen.getByText('4.3K')).toBeInTheDocument()
  })
})
