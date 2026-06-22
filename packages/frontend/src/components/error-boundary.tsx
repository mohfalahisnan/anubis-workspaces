import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * When this value changes, the boundary clears its error and re-renders its
   * children. Use a route key at the page level so navigating away recovers.
   */
  resetKey?: unknown
  /** Short label for the guarded area, used in the default fallback + log. */
  label?: string
  /** Custom fallback; receives the caught error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render/lifecycle errors in its subtree so one broken component cannot
 * white-screen the whole app. Place one at the root (last resort) and one around
 * the page content (so the shell stays usable and navigation recovers).
 *
 * The fallback uses native elements + design tokens only, so it still renders
 * even when a shared UI component is part of the failure.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console so it shows in dev and the packaged app's devtools.
    const tag = this.props.label ? `[ErrorBoundary ${this.props.label}]` : '[ErrorBoundary]'
    console.error(tag, error, info.componentStack)
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error !== null) {
      if (this.props.fallback) return this.props.fallback(error, this.reset)
      return <DefaultFallback error={error} reset={this.reset} label={this.props.label} />
    }
    return this.props.children
  }
}

function DefaultFallback({ error, reset, label }: { error: Error; reset: () => void; label?: string }) {
  return (
    <div className='flex h-full w-full flex-1 items-center justify-center p-6'>
      <div className='flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm'>
        <div className='flex flex-col gap-1'>
          <h2 className='text-lg font-semibold tracking-[-0.01em]'>Something went wrong</h2>
          <p className='text-sm text-muted-foreground'>
            {label ? `The ${label} hit an unexpected error.` : 'An unexpected error occurred.'} You can try again, or reload the app.
          </p>
        </div>
        <pre className='max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground'>
          {error.message || String(error)}
        </pre>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={reset}
            className='inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
          >
            Try again
          </button>
          <button
            type='button'
            onClick={() => window.location.reload()}
            className='inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground'
          >
            Reload app
          </button>
        </div>
      </div>
    </div>
  )
}
