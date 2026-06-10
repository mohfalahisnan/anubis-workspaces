import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  createCompetitor: vi.fn(),
  discoverCompetitorsAsync: vi.fn(),
  listCompetitors: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/api', () => ({
  createCompetitor: mocks.createCompetitor,
  discoverCompetitorsAsync: mocks.discoverCompetitorsAsync,
  listCompetitors: mocks.listCompetitors,
  openInstagramLoginChrome: vi.fn(),
  getAppConfig: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/use-project', () => ({
  useProject: () => ({
    activeProject: { id: 'default', name: 'Default Project' },
  }),
}))

vi.mock('@/lib/navigation', () => ({
  useNavigation: () => ({ navigate: mocks.navigate, route: { page: 'discover-competitors' } }),
}))

// Minimal zustand-style mock: the page reads `s.jobs` and `s.stop` via selectors.
vi.mock('@/lib/use-jobs', () => ({
  useJobs: (selector: (s: { jobs: unknown[]; stop: () => void }) => unknown) =>
    selector({ jobs: [], stop: vi.fn() }),
}))

vi.mock('@/hooks/use-competitor-levels', () => ({
  useCompetitorLevels: () => ({ config: {}, levelFor: () => 'green', reload: vi.fn() }),
}))

import { DiscoverCompetitorsPage } from '@/pages/discover-competitors'

describe('<DiscoverCompetitorsPage>', () => {
  beforeEach(() => {
    mocks.createCompetitor.mockReset()
    mocks.discoverCompetitorsAsync.mockReset()
    mocks.listCompetitors.mockReset()
    mocks.navigate.mockReset()
  })

  it('enqueues a discovery job scoped to the active project and navigates to its job', async () => {
    mocks.listCompetitors.mockResolvedValue([])
    mocks.discoverCompetitorsAsync.mockResolvedValue({ jobId: 'job-1' })

    render(<DiscoverCompetitorsPage />)

    // Default source is "explore", so Discover is enabled immediately.
    await userEvent.click(screen.getByRole('button', { name: /^discover$/i }))

    await waitFor(() => {
      expect(mocks.discoverCompetitorsAsync).toHaveBeenCalledTimes(1)
    })
    const arg = mocks.discoverCompetitorsAsync.mock.calls[0][0]
    expect(arg).toMatchObject({
      source: 'explore',
      profile: 'login',
      projectId: 'default',
    })
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ page: 'discover-competitors', jobId: 'job-1' }),
    )
    // The page only enqueues; it never creates competitors synchronously.
    expect(mocks.createCompetitor).not.toHaveBeenCalled()
  })

  it('passes the trimmed hashtag through when source is hashtag', async () => {
    mocks.listCompetitors.mockResolvedValue([])
    mocks.discoverCompetitorsAsync.mockResolvedValue({ jobId: 'job-2' })

    render(<DiscoverCompetitorsPage />)

    await userEvent.click(screen.getByRole('button', { name: /hashtag/i }))
    await userEvent.type(screen.getByPlaceholderText('productivity'), '#growth')
    await userEvent.click(screen.getByRole('button', { name: /^discover$/i }))

    await waitFor(() => {
      expect(mocks.discoverCompetitorsAsync).toHaveBeenCalledTimes(1)
    })
    const arg = mocks.discoverCompetitorsAsync.mock.calls[0][0]
    expect(arg).toMatchObject({ source: 'hashtag', hashtag: 'growth' })
  })
})
