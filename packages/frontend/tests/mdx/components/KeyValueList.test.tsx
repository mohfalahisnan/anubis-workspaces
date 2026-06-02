import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeyValueList } from '@/components/mdx/components/KeyValueList'

describe('<KeyValueList>', () => {
  it('renders key/value pairs in document order', () => {
    render(<KeyValueList items={{ followers: 12000, region: 'US', verified: true }} />)
    expect(screen.getByText('followers')).toBeInTheDocument()
    expect(screen.getByText('12000')).toBeInTheDocument()
    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('US')).toBeInTheDocument()
    expect(screen.getByText('verified')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
  })

  it('renders null as a dash', () => {
    render(<KeyValueList items={{ foo: null }} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders nothing for an empty object', () => {
    const { container } = render(<KeyValueList items={{}} />)
    expect(container.querySelector('dl')).toBeNull()
  })
})
