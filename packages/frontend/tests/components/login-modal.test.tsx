import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoginModal } from '@/components/login-modal'

vi.mock('@/api', () => ({
  getApiBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:3000'),
  NoCredentialsError: class extends Error {},
  openLoginTerminal: vi.fn().mockResolvedValue(undefined),
  getProfile: vi.fn().mockResolvedValue({
    id: 'p1',
    name: 'P1',
    config: { agent: 'claude' },
    home: { hasCredentials: false, exists: true, path: '/fake/path' }
  }),
}))

describe('<LoginModal>', () => {
  it('renders the terminal container when open', async () => {
    render(<LoginModal profileId='p1' open onClose={() => {}} onSuccess={() => {}} />)
    expect(await screen.findByTestId('login-terminal')).toBeInTheDocument()
  })

  it('shows the connecting status before terminal opens', () => {
    render(<LoginModal profileId='p1' open onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText(/Launching/i)).toBeInTheDocument()
  })

  it('does not render anything when closed', () => {
    const { container } = render(
      <LoginModal profileId='p1' open={false} onClose={() => {}} onSuccess={() => {}} />,
    )
    expect(container.querySelector('[data-testid="login-terminal"]')).toBeNull()
  })
})
