import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineChart } from '@/components/mdx/components/LineChart'

const DATA = [
  { day: 'Mon', likes: 100 },
  { day: 'Tue', likes: 240 },
  { day: 'Wed', likes: 180 },
  { day: 'Thu', likes: 320 },
]

describe('<LineChart>', () => {
  it('renders an svg with a polyline for the data', () => {
    const { container } = render(<LineChart data={DATA} xKey='day' yKey='likes' />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const polyline = container.querySelector('polyline')
    expect(polyline).not.toBeNull()
    expect(polyline!.getAttribute('points')!.split(' ')).toHaveLength(DATA.length)
  })

  it('renders the title when provided', () => {
    render(<LineChart data={DATA} xKey='day' yKey='likes' title='Likes per day' />)
    expect(screen.getByText('Likes per day')).toBeInTheDocument()
  })

  it('renders an empty-state message when data is empty', () => {
    render(<LineChart data={[]} xKey='day' yKey='likes' />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
