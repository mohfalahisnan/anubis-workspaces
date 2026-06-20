import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GenerationTask } from '@anubis/shared'
import { GenerationQueueSection } from '@/pages/content-studio/generation-sections'

function task(over: Partial<GenerationTask>): GenerationTask {
  return {
    id: 't1', contentId: 'c1', projectId: 'p', type: 'image', capability: 'image',
    generator: '', inputPrompt: 'FULL PROMPT TEXT', status: 'manual',
    retryCount: 0, createdAt: 0, updatedAt: 0, ...over,
  }
}

function renderQueue(tasks: GenerationTask[]) {
  render(
    <GenerationQueueSection
      tasks={tasks} busy={false}
      onStart={() => {}} onRetry={() => {}} onCancel={() => {}} onOpenConversation={() => {}}
    />,
  )
}

describe('<GenerationQueueSection> manual tasks', () => {
  it('shows the full prompt and a Copy prompt button that copies the prompt', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    renderQueue([task({})])
    expect(screen.getByText('FULL PROMPT TEXT')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    expect(writeText).toHaveBeenCalledWith('FULL PROMPT TEXT')
  })

  it('does not show a Copy prompt button for non-manual tasks', () => {
    renderQueue([task({ status: 'pending' })])
    expect(screen.queryByRole('button', { name: /copy prompt/i })).not.toBeInTheDocument()
  })
})
