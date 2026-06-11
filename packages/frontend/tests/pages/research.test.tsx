import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CompetitorSummary, ResearchCandidateSummary, ResearchSessionSummary } from '@anubis/shared'

const mocks = vi.hoisted(() => ({
  listCompetitors: vi.fn(),
  createResearchSession: vi.fn(),
  updateResearchCandidate: vi.fn(),
  updateCompetitor: vi.fn(),
  captureCompetitorsBatch: vi.fn(),
  validateSessionNiche: vi.fn(),
}))

vi.mock('@/api', () => ({
  listCompetitors: mocks.listCompetitors,
  createResearchSession: mocks.createResearchSession,
  updateResearchCandidate: mocks.updateResearchCandidate,
  updateCompetitor: mocks.updateCompetitor,
  captureCompetitorsBatch: mocks.captureCompetitorsBatch,
  validateSessionNiche: mocks.validateSessionNiche,
}))

vi.mock('@/lib/use-project', () => ({
  useProject: () => ({ activeProject: { id: 'default', name: 'Default Project' } }),
}))

import { ResearchPage } from '@/pages/research'

function competitor(p: Partial<CompetitorSummary>): CompetitorSummary {
  return { id: 'c1', handle: '@creator', postCount: 5, addedAt: 0, updatedAt: 0, platform: 'instagram', status: 'active', favorite: false, baselineLikes: 50, followers: 25_000, ...p }
}
function candidate(p: Partial<ResearchCandidateSummary>): ResearchCandidateSummary {
  return { id: 'r1', sessionId: 's1', competitorId: 'c1', competitorLevel: 'green', postId: 'p1', candidateLevel: 'green', validationStatus: 'pending', validationFailures: [], decision: 'none', createdAt: 0, updatedAt: 0, likes: 1000, baselineLikes: 50, score: 20, postUrl: 'https://www.instagram.com/p/x/', postedAt: new Date().toISOString(), ...p }
}
const session: ResearchSessionSummary = {
  id: 's1', controls: {}, status: 'done',
  counts: { candidates: 1, valid: 0, green: 1, yellow: 0, neutral: 0 },
  createdAt: 0, updatedAt: 0,
}

describe('<ResearchPage>', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset())
    mocks.listCompetitors.mockResolvedValue([competitor({})])
  })

  it('runs research and renders scored candidates', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [candidate({})] })

    render(<ResearchPage />)
    await waitFor(() => expect(mocks.listCompetitors).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /run research/i }))

    await waitFor(() => expect(mocks.createResearchSession).toHaveBeenCalledTimes(1))
    // The viral candidate shows its 20× score and high-priority level.
    expect(await screen.findByText('20.0×')).toBeInTheDocument()
    expect(screen.getByText(/high priority/i)).toBeInTheDocument()
  })

  it('marks niche aligned from the detail drawer and reflects the new validation', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [candidate({})] })
    mocks.updateResearchCandidate.mockResolvedValue(candidate({ nicheAligned: true, validationStatus: 'valid' }))

    render(<ResearchPage />)
    await userEvent.click(screen.getByRole('button', { name: /run research/i }))
    await screen.findByText('20.0×')

    await userEvent.click(screen.getByRole('button', { name: /details/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^aligned$/i }))

    await waitFor(() => expect(mocks.updateResearchCandidate).toHaveBeenCalledWith('r1', { nicheAligned: true }))
  })

  it('runs the AI niche pass and merges the updated verdicts', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [candidate({})] })
    mocks.validateSessionNiche.mockResolvedValue({
      updated: 1,
      candidates: [candidate({ nicheAligned: true, validationStatus: 'valid' })],
    })

    render(<ResearchPage />)
    await userEvent.click(screen.getByRole('button', { name: /run research/i }))
    await screen.findByText('20.0×')

    await userEvent.click(screen.getByRole('button', { name: /validate niche/i }))

    await waitFor(() => expect(mocks.validateSessionNiche).toHaveBeenCalledWith('s1'))
    expect(await screen.findByText(/validated 1 candidate/i)).toBeInTheDocument()
  })

  it('passes the favorite-only and age controls through to the run', async () => {
    mocks.createResearchSession.mockResolvedValue({ session, candidates: [] })

    render(<ResearchPage />)
    await waitFor(() => expect(mocks.listCompetitors).toHaveBeenCalled())

    await userEvent.click(screen.getByLabelText(/favorite competitors only/i))
    await userEvent.click(screen.getByRole('button', { name: /run research/i }))

    await waitFor(() => expect(mocks.createResearchSession).toHaveBeenCalledTimes(1))
    const arg = mocks.createResearchSession.mock.calls[0][0]
    expect(arg.projectId).toBe('default')
    expect(arg.controls).toMatchObject({ favoriteOnly: true, maxPostsPerProfile: 20, maxContentAgeDays: 7 })
  })
})
