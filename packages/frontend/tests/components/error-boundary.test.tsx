import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/error-boundary'

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message)
}

describe('<ErrorBoundary>', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>safe content</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })

  it('renders the default fallback with the error message when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary label='page'>
        <Boom message='render failed' />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('render failed')).toBeInTheDocument()
    expect(screen.getByText(/the page hit an unexpected error/i)).toBeInTheDocument()
  })

  it('uses a custom fallback when provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary fallback={(err) => <div>custom: {err.message}</div>}>
        <Boom message='x' />
      </ErrorBoundary>,
    )
    expect(screen.getByText('custom: x')).toBeInTheDocument()
  })

  it('recovers and re-renders children when resetKey changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey='a'>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Same key + a now-safe child: the boundary should NOT reset on its own.
    rerender(
      <ErrorBoundary resetKey='a'>
        <div>recovered</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Key change (e.g. navigation) clears the error and renders the child.
    rerender(
      <ErrorBoundary resetKey='b'>
        <div>recovered</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })
})
