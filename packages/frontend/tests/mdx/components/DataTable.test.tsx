import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTable } from '@/components/mdx/components/DataTable'

describe('<DataTable>', () => {
  it('renders headers and rows', () => {
    render(<DataTable columns={['A', 'B']} rows={[[1, 'x'], [2, 'y']]} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('y')).toBeInTheDocument()
  })

  it('renders null cells as a dash', () => {
    render(<DataTable columns={['X']} rows={[[null]]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders nothing when rows is empty', () => {
    const { container } = render(<DataTable columns={['X']} rows={[]} />)
    expect(container.querySelector('table')).toBeNull()
  })
})
