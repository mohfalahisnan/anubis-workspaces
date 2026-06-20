import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  getPipelineSettings: vi.fn(),
  updatePipelineSettings: vi.fn(async () => ({ projectId: 'p1', steps: {}, updatedAt: 1 })),
}))
vi.mock('@/api', () => ({
  getPipelineSettings: mocks.getPipelineSettings,
  updatePipelineSettings: mocks.updatePipelineSettings,
}))

import { PipelineSettingsDialog } from '@/pages/content-studio/pipeline-settings-dialog'

const PROFILES = [
  { id: 'codex-coding', name: 'Codex · Coding', source: 'builtin', config: { agent: 'codex' }, sortOrder: 0, createdAt: 0, updatedAt: 0 },
]

describe('<PipelineSettingsDialog> media generation', () => {
  it('shows Image/Video tabs and saves the generation profile + prompt', async () => {
    mocks.getPipelineSettings.mockResolvedValue({
      settings: { projectId: 'p1', steps: {}, generationProfiles: { image: 'google-flow' }, generationPrompts: {}, updatedAt: 1 },
      defaults: { brief: 'B', refine: 'R', ai_review: 'A' },
      generationDefaults: { image: 'IMG {{concept}}', video: 'VID {{videoScript}}' },
    })
    render(<PipelineSettingsDialog open projectId='p1' profiles={PROFILES as never} onClose={() => {}} />)

    // Switch to the Image tab
    await userEvent.click(await screen.findByRole('button', { name: 'Image' }))
    // The loaded image profile shows in the picker
    expect(await screen.findByText('Google Flow (browser)')).toBeInTheDocument()
    // Type a custom generation prompt. NOTE: avoid `{`/`}` here — user-event's
    // type() treats `{{` as an escape. Placeholder rendering is covered by the
    // backend unit tests; here we only verify the typed prompt is saved.
    const textarea = screen.getByPlaceholderText('IMG {{concept}}')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Make it pop')

    await userEvent.click(screen.getByText('Save'))
    expect(mocks.updatePipelineSettings).toHaveBeenCalledWith('p1', {}, { image: 'google-flow' }, { image: 'Make it pop' })
  })
})
