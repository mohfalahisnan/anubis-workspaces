import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoginModal } from '@/components/login-modal'

// xterm.js needs canvas APIs jsdom doesn't fully provide; stub the
// constructor surface to a minimal shape and verify mount-time behavior
// only. Full IO is verified manually.
vi.mock('@xterm/xterm', () => {
  class Terminal {
    loadAddon() {}
    open() {}
    write() {}
    onData() { return { dispose() {} } }
    dispose() {}
  }
  return { Terminal }
})
vi.mock('@xterm/addon-fit', () => {
  class FitAddon { fit() {} }
  return { FitAddon }
})
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class FakeWS {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) {}
  send() {}
  close() { this.onclose?.() }
}
vi.stubGlobal('WebSocket', FakeWS)

vi.mock('@/api', () => ({
  getApiBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:3000'),
  NoCredentialsError: class extends Error {},
}))

describe('<LoginModal>', () => {
  it('renders the terminal container when open', async () => {
    render(<LoginModal profileId='p1' open onClose={() => {}} onSuccess={() => {}} />)
    expect(await screen.findByTestId('login-terminal')).toBeInTheDocument()
  })

  it('shows the connecting status before the WS opens', () => {
    render(<LoginModal profileId='p1' open onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText(/Connecting/i)).toBeInTheDocument()
  })

  it('does not render anything when closed', () => {
    const { container } = render(
      <LoginModal profileId='p1' open={false} onClose={() => {}} onSuccess={() => {}} />,
    )
    expect(container.querySelector('[data-testid="login-terminal"]')).toBeNull()
  })
})
