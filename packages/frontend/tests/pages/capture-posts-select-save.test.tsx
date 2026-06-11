import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CapturedPostSummary, JobSummary } from '@anubis/shared'

const mocks = vi.hoisted(() => ({
  listBatchCandidates: vi.fn(),
  importCapturedPosts: vi.fn(),
  listCompetitors: vi.fn(),
  captureCompetitorsBatch: vi.fn(),
}))

vi.mock('@/api', () => ({
  listBatchCandidates: mocks.listBatchCandidates,
  importCapturedPosts: mocks.importCapturedPosts,
  listCompetitors: mocks.listCompetitors,
  captureCompetitorsBatch: mocks.captureCompetitorsBatch,
}))

vi.mock('@/lib/navigation', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }))
vi.mock('@/lib/use-project', () => ({ useProject: () => ({ activeProject: { id: 'default' } }) }))
vi.mock('@/hooks/use-competitor-levels', () => ({
  useCompetitorLevels: () => ({ config: {}, levelFor: () => 'green' }),
}))

const finishedJob: JobSummary = {
  id: 'job-1', kind: 'capture-posts-batch', label: 'Capture', state: 'succeeded',
  progress: { profilesCompleted: 1, totalProfiles: 1 }, warnings: [],
  projectId: 'default', createdAt: 1, startedAt: 1, finishedAt: 2,
  result: { totalProfiles: 1, profilesCompleted: 1, candidateCount: 1, stopped: false, perCompetitor: [] },
} as unknown as JobSummary

vi.mock('@/lib/use-jobs', () => ({
  useJobs: (sel: (s: { jobs: JobSummary[]; stop: () => void }) => unknown) =>
    sel({ jobs: [finishedJob], stop: vi.fn() }),
}))

const candidate: CapturedPostSummary = {
  id: 'p1', competitorId: 'c1', username: 'creator',
  postUrl: 'https://www.instagram.com/p/p1/', caption: 'Hook', likes: 100, comments: 4,
  competitorHandle: '@creator', capturedAt: 1,
}

import { CapturePostsPage } from '@/pages/capture-posts'

describe('CapturePostsPage results — select & save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listCompetitors.mockResolvedValue([])
    mocks.listBatchCandidates.mockResolvedValue({ candidates: [candidate], running: false })
    mocks.importCapturedPosts.mockResolvedValue({ importedCount: 1 })
  })

  it('renders candidates from the job, selects, and saves to Content', async () => {
    render(<CapturePostsPage jobId="job-1" />)

    // Candidate appears from the polled endpoint.
    await waitFor(() => expect(mocks.listBatchCandidates).toHaveBeenCalledWith('job-1'))
    const tile = await screen.findByTestId('candidate-p1')
    fireEvent.click(tile)

    const saveBtn = await screen.findByRole('button', { name: /save 1 to content/i })
    fireEvent.click(saveBtn)

    await waitFor(() =>
      expect(mocks.importCapturedPosts).toHaveBeenCalledWith({
        posts: [expect.objectContaining({ id: 'p1', competitorId: 'c1', postUrl: 'https://www.instagram.com/p/p1/' })],
      }),
    )
  })
})
