import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasoningPicker } from '@/components/composer/reasoning-picker'
import type { ReasoningEffort } from '@/api'

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

describe('<ReasoningPicker>', () => {
  it('renders the current effort in the trigger', () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveTextContent('medium')
  })

  it('marks the trigger as overridden when isOverride is true', () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='high'
        isOverride
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveAttribute('data-modified', 'true')
  })

  it('does not mark the trigger when at profile default', () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveAttribute('data-modified', 'false')
  })

  it('opens a menu and fires onChange on pick', async () => {
    const onChange = vi.fn()
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(await screen.findByText('high'))
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('is disabled when the disabled prop is set', async () => {
    render(
      <ReasoningPicker
        efforts={EFFORTS}
        value='medium'
        isOverride={false}
        onChange={() => {}}
        disabled
      />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDisabled()
    await userEvent.click(trigger)
    expect(screen.queryByText('high')).not.toBeInTheDocument()
  })
})
