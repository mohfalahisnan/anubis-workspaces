import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MdxContent } from '@/components/mdx'

vi.mock('@/api', () => ({
  sendMessage: vi.fn().mockResolvedValue({ msgId: 'm1', messageId: 'id1' }),
}))

describe('<MdxContent>', () => {
  it('renders interleaved markdown and components', () => {
    const source = [
      'Here are some options:',
      '',
      '<Buttons><Button send="yes">Yes</Button><Button send="no" style="danger">No</Button></Buttons>',
      '',
      'And data:',
      '',
      '<KeyValueList items={{"followers":120,"region":"ID"}} />',
    ].join('\n')

    render(<MdxContent source={source} conversationId='c1' />)

    expect(screen.getByText(/Here are some options/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
    expect(screen.getByText('followers')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('falls back to a <pre> when a component has malformed props', () => {
    const { container } = render(
      <MdxContent source={'<DataTable columns={[1,2,}/>'} conversationId='c1' />,
    )
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('renders an unclosed whitelisted tag at end of input as plain text (streaming-safe)', () => {
    const { container } = render(
      <MdxContent source={'leading text <Buttons><Button send="hi'} conversationId='c1' />,
    )
    expect(container.querySelector('button')).toBeNull()
    expect(screen.getByText(/leading text/)).toBeInTheDocument()
  })
})
