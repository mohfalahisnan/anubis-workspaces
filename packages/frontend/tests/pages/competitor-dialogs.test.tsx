import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  createCompetitor: vi.fn(),
  discoverCompetitorsAsync: vi.fn(),
  listCompetitors: vi.fn(),
}))

vi.mock('@/api', () => ({
  createCompetitor: mocks.createCompetitor,
  discoverCompetitorsAsync: mocks.discoverCompetitorsAsync,
  listCompetitors: mocks.listCompetitors,
  openInstagramLoginChrome: vi.fn(),
}))

vi.mock('@/lib/use-project', () => ({
  useProject: () => ({
    activeProject: { id: 'default', name: 'Default Project' },
  }),
}))

import { FindCompetitorsDialog } from '@/pages/competitor-dialogs'

describe('<FindCompetitorsDialog>', () => {
  beforeEach(() => {
    mocks.createCompetitor.mockReset()
    mocks.discoverCompetitorsAsync.mockReset()
    mocks.listCompetitors.mockReset()
  })

  it('enqueues a background discovery job scoped to the active project and notifies onStarted', async () => {
    const onStarted = vi.fn()
    mocks.listCompetitors.mockResolvedValue([])
    mocks.discoverCompetitorsAsync.mockResolvedValue({ jobId: 'job-1' })

    render(<FindCompetitorsDialog open onClose={() => {}} onStarted={onStarted} />)

    // Default source is "explore", so Discover is enabled immediately.
    await userEvent.click(screen.getByRole('button', { name: /discover/i }))

    await waitFor(() => {
      expect(mocks.discoverCompetitorsAsync).toHaveBeenCalledTimes(1)
    })
    const arg = mocks.discoverCompetitorsAsync.mock.calls[0][0]
    expect(arg).toMatchObject({
      source: 'explore',
      profile: 'login',
      projectId: 'default',
    })
    await waitFor(() => expect(onStarted).toHaveBeenCalled())
    // No synchronous candidate creation happens from the dialog anymore.
    expect(mocks.createCompetitor).not.toHaveBeenCalled()
  })

  it('passes the trimmed hashtag through when source is hashtag', async () => {
    const onStarted = vi.fn()
    mocks.listCompetitors.mockResolvedValue([])
    mocks.discoverCompetitorsAsync.mockResolvedValue({ jobId: 'job-2' })

    render(<FindCompetitorsDialog open onClose={() => {}} onStarted={onStarted} />)

    await userEvent.click(screen.getByRole('button', { name: /hashtag/i }))
    await userEvent.type(screen.getByPlaceholderText('productivity'), '#growth')
    await userEvent.click(screen.getByRole('button', { name: /discover/i }))

    await waitFor(() => {
      expect(mocks.discoverCompetitorsAsync).toHaveBeenCalledTimes(1)
    })
    const arg = mocks.discoverCompetitorsAsync.mock.calls[0][0]
    expect(arg).toMatchObject({ source: 'hashtag', hashtag: 'growth' })
  })
})
