import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  createCompetitor: vi.fn(),
  discoverCompetitors: vi.fn(),
  listCompetitors: vi.fn(),
}))

vi.mock('@/api', () => ({
  createCompetitor: mocks.createCompetitor,
  discoverCompetitors: mocks.discoverCompetitors,
  listCompetitors: mocks.listCompetitors,
  openInstagramLoginChrome: vi.fn(),
}))

import { FindCompetitorsDialog } from '@/pages/competitor-dialogs'

describe('<FindCompetitorsDialog>', () => {
  it('preserves discovered bio and followers when adding selected candidates', async () => {
    const onComplete = vi.fn()
    mocks.listCompetitors.mockResolvedValue([])
    mocks.discoverCompetitors.mockResolvedValue([
      {
        username: 'claye.ai',
        fullName: 'Claye AI',
        bio: 'Creating the future with AI',
        followers: 143_100,
      },
    ])
    mocks.createCompetitor.mockResolvedValue({ id: 'c1' })

    render(
      <FindCompetitorsDialog
        open
        onClose={() => {}}
        onComplete={onComplete}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /discover/i }))
    expect(await screen.findByText('@claye.ai')).toBeInTheDocument()
    expect(screen.getByText('143.1K followers')).toBeInTheDocument()
    expect(screen.getByText('Creating the future with AI')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /add 1/i }))

    await waitFor(() => {
      expect(mocks.createCompetitor).toHaveBeenCalledWith({
        handle: 'claye.ai',
        displayName: 'Claye AI',
        followers: 143_100,
        bio: 'Creating the future with AI',
      })
    })
    expect(onComplete).toHaveBeenCalledWith(1)
  })

  it('filters discovered competitors by follower bands and search', async () => {
    mocks.listCompetitors.mockResolvedValue([])
    mocks.discoverCompetitors.mockResolvedValue([
      {
        username: 'small.creator',
        fullName: 'Small Creator',
        bio: 'Niche content systems',
        followers: 24_000,
      },
      {
        username: 'mid.creator',
        fullName: 'Mid Creator',
        bio: 'Growth proof',
        followers: 75_000,
      },
      {
        username: 'large.creator',
        fullName: 'Large Creator',
        bio: 'Enterprise AI workflows',
        followers: 180_000,
      },
    ])

    render(
      <FindCompetitorsDialog
        open
        onClose={() => {}}
        onComplete={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /discover/i }))
    expect(await screen.findByText('@small.creator')).toBeInTheDocument()
    expect(screen.getByText('@mid.creator')).toBeInTheDocument()
    expect(screen.getByText('@large.creator')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '<50K' }))
    expect(screen.getByText('@small.creator')).toBeInTheDocument()
    expect(screen.queryByText('@mid.creator')).not.toBeInTheDocument()
    expect(screen.queryByText('@large.creator')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '50K+' }))
    expect(screen.queryByText('@small.creator')).not.toBeInTheDocument()
    expect(screen.getByText('@mid.creator')).toBeInTheDocument()
    expect(screen.getByText('@large.creator')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '100K+' }))
    expect(screen.queryByText('@small.creator')).not.toBeInTheDocument()
    expect(screen.queryByText('@mid.creator')).not.toBeInTheDocument()
    expect(screen.getByText('@large.creator')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Filter handle, name, bio...'), 'enterprise')
    expect(screen.getByText('@large.creator')).toBeInTheDocument()
  })
})
