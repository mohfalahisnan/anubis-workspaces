import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CapturedPostSummary, CompetitorSummary } from '@anubis/shared'

const mocks = vi.hoisted(() => ({
  captureCompetitorPreview: vi.fn(),
  importCapturedPosts: vi.fn(),
  listCompetitors: vi.fn(),
  listPosts: vi.fn(),
}))

vi.mock('@/api', () => ({
  captureCompetitorPreview: mocks.captureCompetitorPreview,
  deletePost: vi.fn(),
  importCapturedPosts: mocks.importCapturedPosts,
  listCompetitors: mocks.listCompetitors,
  listPosts: mocks.listPosts,
  updatePost: vi.fn(),
  openInstagramLoginChrome: vi.fn(),
}))

vi.mock('@/lib/navigation', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}))

vi.mock('@/hooks/use-competitor-levels', () => ({
  useCompetitorLevels: () => ({ config: undefined }),
}))

vi.mock('@/hooks/use-level-multipliers', () => ({
  useLevelMultipliers: () => undefined,
}))

import { ContentPage } from '@/pages/content'

const competitor: CompetitorSummary = {
  id: 'comp-1',
  handle: '@alpha',
  tint: '#565B63',
  postCount: 0,
  addedAt: 1,
  updatedAt: 1,
}

const candidate: CapturedPostSummary = {
  id: 'post-1',
  competitorId: 'comp-1',
  username: 'alpha',
  postUrl: 'https://instagram.com/p/1',
  caption: 'A strong hook',
  likes: 1200,
  comments: 45,
  mediaKind: 'image',
  mediaUrl: 'https://example.com/post.jpg',
  capturedAt: 123,
  competitorHandle: '@alpha',
  competitorTint: '#565B63',
}

describe('<ContentPage> capture preview flow', () => {
  it('previews target posts and imports only the selected posts', async () => {
    mocks.listPosts.mockResolvedValue([])
    mocks.listCompetitors.mockResolvedValue([competitor])
    mocks.captureCompetitorPreview.mockResolvedValue({
      competitor,
      posts: [candidate],
      warnings: [],
    })
    mocks.importCapturedPosts.mockResolvedValue({ importedCount: 1 })

    render(<ContentPage />)

    await userEvent.click(await screen.findByRole('button', { name: /capture posts/i }))

    const captureDialog = await screen.findByRole('dialog', { name: 'Capture posts' })
    await userEvent.click(within(captureDialog).getByRole('button', { name: /@alpha/i }))
    const targetInput = within(captureDialog).getByLabelText('Target posts per profile')
    fireEvent.change(targetInput, { target: { value: '3' } })
    await userEvent.click(within(captureDialog).getByRole('button', { name: /capture 1/i }))

    await waitFor(() => {
      expect(mocks.captureCompetitorPreview).toHaveBeenCalledWith('comp-1', {
        profile: 'public',
        headless: true,
        forceHeadless: false,
        targetPosts: 3,
      })
    })

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review captured posts' })
    expect(within(reviewDialog).getByText('A strong hook')).toBeInTheDocument()

    await userEvent.click(within(reviewDialog).getByRole('button', { name: /add 1/i }))

    await waitFor(() => {
      expect(mocks.importCapturedPosts).toHaveBeenCalledWith({
        posts: [{
          id: 'post-1',
          competitorId: 'comp-1',
          username: 'alpha',
          postUrl: 'https://instagram.com/p/1',
          caption: 'A strong hook',
          likes: 1200,
          comments: 45,
          postedAt: undefined,
          mediaKind: 'image',
          mediaUrl: 'https://example.com/post.jpg',
          carouselCount: undefined,
          capturedAt: 123,
        }],
      })
    })
  })

  it('dedupes preview candidates before review and import', async () => {
    const duplicate: CapturedPostSummary = {
      ...candidate,
      id: 'post-duplicate',
      postUrl: 'https://instagram.com/p/1/?igsh=duplicate',
      likes: 999,
    }
    mocks.listPosts.mockResolvedValue([])
    mocks.listCompetitors.mockResolvedValue([competitor])
    mocks.captureCompetitorPreview.mockResolvedValue({
      competitor,
      posts: [candidate, duplicate],
      warnings: [],
    })
    mocks.importCapturedPosts.mockResolvedValue({ importedCount: 1 })

    render(<ContentPage />)

    await userEvent.click(await screen.findByRole('button', { name: /capture posts/i }))
    const captureDialog = await screen.findByRole('dialog', { name: 'Capture posts' })
    await userEvent.click(within(captureDialog).getByRole('button', { name: /@alpha/i }))
    await userEvent.click(within(captureDialog).getByRole('button', { name: /capture 1/i }))

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review captured posts' })
    await userEvent.click(within(reviewDialog).getByRole('button', { name: /add 1/i }))

    await waitFor(() => {
      expect(mocks.importCapturedPosts).toHaveBeenCalledWith({
        posts: [expect.objectContaining({ id: 'post-1', postUrl: 'https://instagram.com/p/1' })],
      })
    })
  })

  it('filters preview candidates by search and recent date windows', async () => {
    const now = Date.now()
    const freshPost: CapturedPostSummary = {
      ...candidate,
      id: 'post-fresh',
      postUrl: 'https://instagram.com/p/fresh',
      caption: 'Fresh weekly angle',
      capturedAt: now - 3 * 24 * 60 * 60 * 1000,
    }
    const tenDayPost: CapturedPostSummary = {
      ...candidate,
      id: 'post-ten-day',
      postUrl: 'https://instagram.com/p/ten-day',
      caption: 'Ten day product proof',
      capturedAt: now - 10 * 24 * 60 * 60 * 1000,
    }
    const oldPost: CapturedPostSummary = {
      ...candidate,
      id: 'post-old',
      postUrl: 'https://instagram.com/p/old',
      caption: 'Older launch idea',
      capturedAt: now - 40 * 24 * 60 * 60 * 1000,
    }

    mocks.listPosts.mockResolvedValue([])
    mocks.listCompetitors.mockResolvedValue([competitor])
    mocks.captureCompetitorPreview.mockResolvedValue({
      competitor,
      posts: [freshPost, tenDayPost, oldPost],
      warnings: [],
    })

    render(<ContentPage />)

    await userEvent.click(await screen.findByRole('button', { name: /capture posts/i }))
    const captureDialog = await screen.findByRole('dialog', { name: 'Capture posts' })
    await userEvent.click(within(captureDialog).getByRole('button', { name: /@alpha/i }))
    await userEvent.click(within(captureDialog).getByRole('button', { name: /capture 1/i }))

    const reviewDialog = await screen.findByRole('dialog', { name: 'Review captured posts' })
    expect(within(reviewDialog).getByText('Fresh weekly angle')).toBeInTheDocument()
    expect(within(reviewDialog).getByText('Ten day product proof')).toBeInTheDocument()
    expect(within(reviewDialog).getByText('Older launch idea')).toBeInTheDocument()

    await userEvent.click(within(reviewDialog).getByRole('button', { name: '1 week' }))
    expect(within(reviewDialog).getByText('Fresh weekly angle')).toBeInTheDocument()
    expect(within(reviewDialog).queryByText('Ten day product proof')).not.toBeInTheDocument()
    expect(within(reviewDialog).queryByText('Older launch idea')).not.toBeInTheDocument()

    await userEvent.click(within(reviewDialog).getByRole('button', { name: '1 month' }))
    expect(within(reviewDialog).getByText('Fresh weekly angle')).toBeInTheDocument()
    expect(within(reviewDialog).getByText('Ten day product proof')).toBeInTheDocument()
    expect(within(reviewDialog).queryByText('Older launch idea')).not.toBeInTheDocument()

    await userEvent.type(within(reviewDialog).getByPlaceholderText('Filter handle, caption, URL...'), 'proof')
    expect(within(reviewDialog).queryByText('Fresh weekly angle')).not.toBeInTheDocument()
    expect(within(reviewDialog).getByText('Ten day product proof')).toBeInTheDocument()
  })
})
