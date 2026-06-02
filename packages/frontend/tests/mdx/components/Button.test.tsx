import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Button as MdxButton } from '@/components/mdx/components/Button'
import { Buttons as MdxButtons } from '@/components/mdx/components/Buttons'
import { MdxConversationProvider } from '@/components/mdx/conversation-context'

vi.mock('@/api', () => ({
  sendMessage: vi.fn().mockResolvedValue({ msgId: 'm1', messageId: 'id1' }),
}))

import { sendMessage } from '@/api'

function renderInContext(node: ReactNode) {
  return render(
    <MdxConversationProvider value={{ conversationId: 'conv-1' }}>
      {node}
    </MdxConversationProvider>,
  )
}

beforeEach(() => {
  vi.mocked(sendMessage).mockClear()
  vi.mocked(sendMessage).mockResolvedValue({ msgId: 'm1', messageId: 'id1' })
})

describe('<Buttons>', () => {
  it('renders children in a row container', () => {
    const { container } = renderInContext(
      <MdxButtons>
        <MdxButton send='a'>A</MdxButton>
        <MdxButton send='b'>B</MdxButton>
      </MdxButtons>,
    )
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })
})

describe('<Button>', () => {
  it('calls sendMessage with conversationId and send payload on click', async () => {
    renderInContext(<MdxButton send='approve plan'>Approve</MdxButton>)
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(sendMessage).toHaveBeenCalledWith('conv-1', 'approve plan')
  })

  it('disables after successful send', async () => {
    renderInContext(<MdxButton send='ok'>OK</MdxButton>)
    const btn = screen.getByRole('button', { name: 'OK' })
    await userEvent.click(btn)
    expect(btn).toBeDisabled()
  })

  it('shows an inline error on failure', async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('boom'))
    renderInContext(<MdxButton send='ok'>OK</MdxButton>)
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })
})
