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
  it('loads, displays, and saves the per-project generation profiles', async () => {
    mocks.getPipelineSettings.mockResolvedValue({
      settings: { projectId: 'p1', steps: {}, generationProfiles: { image: 'google-flow' }, updatedAt: 1 },
      defaults: { brief: 'B', refine: 'R', ai_review: 'A' },
    })
    render(<PipelineSettingsDialog open projectId='p1' profiles={PROFILES as never} onClose={() => {}} />)

    expect(await screen.findByText('Generation AI Profiles')).toBeInTheDocument()
    expect(screen.getByText('Google Flow (browser)')).toBeInTheDocument() // image picker shows loaded value

    await userEvent.click(screen.getByText('Save'))
    expect(mocks.updatePipelineSettings).toHaveBeenCalledWith('p1', {}, { image: 'google-flow' })
  })
})
