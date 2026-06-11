import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CandidateLevelBadge } from '@/components/research/candidate-level-badge'

describe('<CandidateLevelBadge>', () => {
  it('renders the level label and exposes the level via data attribute', () => {
    render(<CandidateLevelBadge level='green' score={20} />)
    const badge = screen.getByText(/high priority/i)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[data-level]')?.getAttribute('data-level')).toBe('green')
  })

  it('shows the score multiplier when provided', () => {
    render(<CandidateLevelBadge level='neutral' score={1} />)
    expect(screen.getByText('1.0×')).toBeInTheDocument()
  })
})
