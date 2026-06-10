import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelect } from '@/components/model-select'
import type { ModelInfo } from '@/api'

const MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-7', category: 'recommended', description: 'Opus.' },
  { id: 'claude-sonnet-4-6', category: 'recommended', description: 'Sonnet.' },
]

/** Controlled-component harness: feeds onChange back into value like the page does. */
function Harness({ initial, onChange }: { initial: string; onChange?: (m: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <ModelSelect
      models={MODELS}
      value={value}
      onChange={(m) => {
        setValue(m)
        onChange?.(m)
      }}
    />
  )
}

describe('<ModelSelect>', () => {
  it('renders catalog models plus a Custom option, no text input for known models', () => {
    render(<ModelSelect models={MODELS} value='claude-sonnet-4-6' onChange={() => {}} />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('claude-sonnet-4-6')
    expect(screen.getByRole('option', { name: /custom model/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows a text input prefilled with the current model when Custom is chosen', async () => {
    const onChange = vi.fn()
    render(<Harness initial='claude-sonnet-4-6' onChange={onChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox'), '__custom__')

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('claude-sonnet-4-6')

    await userEvent.clear(input)
    await userEvent.type(input, 'claude-fable-5')
    expect(input).toHaveValue('claude-fable-5')
    expect(onChange).toHaveBeenLastCalledWith('claude-fable-5')
  })

  it('starts in custom mode when the value is not in the catalog', () => {
    render(<ModelSelect models={MODELS} value='my-custom-model' onChange={() => {}} />)
    expect(screen.getByRole('combobox')).toHaveValue('__custom__')
    expect(screen.getByRole('textbox')).toHaveValue('my-custom-model')
  })

  it('leaves custom mode when a catalog model is selected', async () => {
    const onChange = vi.fn()
    render(<Harness initial='my-custom-model' onChange={onChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox'), 'claude-opus-4-7')

    expect(onChange).toHaveBeenLastCalledWith('claude-opus-4-7')
    expect(screen.getByRole('combobox')).toHaveValue('claude-opus-4-7')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
