import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MdxMarkdown } from '@/components/mdx/markdown'

describe('MdxMarkdown', () => {
  it('renders markdown bold', () => {
    const { container } = render(<MdxMarkdown source='hello **world**' />)
    const strong = container.querySelector('[data-streamdown="strong"]')
    expect(strong?.textContent).toBe('world')
  })

  it('renders fenced code', () => {
    const { container } = render(<MdxMarkdown source={'```\nfoo\n```'} />)
    expect(container.querySelector('code')?.textContent).toContain('foo')
  })

  it('strips <script> from inline HTML', () => {
    const { container } = render(<MdxMarkdown source={'a <script>alert(1)</script> b'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).not.toContain('alert(1)')
  })

  it('blocks javascript: URLs in links (no <a href> emitted)', () => {
    const { container } = render(<MdxMarkdown source={'[click](javascript:alert(1))'} />)
    const anchor = container.querySelector('a[href^="javascript:"]')
    expect(anchor).toBeNull()
    expect(container.textContent).toContain('blocked')
  })
})
