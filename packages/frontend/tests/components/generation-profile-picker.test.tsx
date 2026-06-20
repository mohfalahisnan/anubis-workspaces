import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GenerationProfilePicker } from '@/pages/content-studio/generation-profile-picker'

describe('<GenerationProfilePicker>', () => {
  it('offers a Manual option on the Image picker and emits image=manual', async () => {
    const onChange = vi.fn()
    render(<GenerationProfilePicker profiles={[]} generationProfiles={{}} onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[0]!) // Image picker (rendered first)
    await userEvent.click(await screen.findByText("Manual (I'll generate it)"))
    expect(onChange).toHaveBeenCalledWith({ image: 'manual' })
  })

  it('offers a Manual option on the Video picker and emits video=manual', async () => {
    const onChange = vi.fn()
    render(<GenerationProfilePicker profiles={[]} generationProfiles={{}} onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[1]!) // Video picker (rendered second)
    await userEvent.click(await screen.findByText("Manual (I'll generate it)"))
    expect(onChange).toHaveBeenCalledWith({ video: 'manual' })
  })
})
