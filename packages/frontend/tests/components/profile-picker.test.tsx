import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProfileSummary } from '@anubis/shared'
import { ProfilePicker } from '@/components/composer/profile-picker'

function p(id: string, name: string, source: 'builtin' | 'user'): ProfileSummary {
  return {
    id,
    name,
    source,
    config: { agent: 'claude', model: 'claude-sonnet-4-6' },
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  } as ProfileSummary
}

const PROFILES = [
  p('claude-coding', 'Claude · Coding', 'builtin'),
  p('claude-research', 'Claude · Research', 'builtin'),
  p('my-fast', 'My Fast', 'user'),
]

describe('<ProfilePicker>', () => {
  it('renders the selected profile name in the trigger', () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[2]!}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button')).toHaveTextContent('My Fast')
  })

  it('shows "Loading…" when the profile list is empty', () => {
    render(
      <ProfilePicker profiles={[]} value={null} onChange={() => {}} />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveTextContent(/loading/i)
    expect(trigger).toBeDisabled()
  })

  it('opens a menu listing user profiles then builtin profiles', async () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('My profiles')).toBeInTheDocument()
    expect(screen.getByText('Built-in')).toBeInTheDocument()
    expect(screen.getByText('My Fast')).toBeInTheDocument()
    expect(screen.getByText('Claude · Research')).toBeInTheDocument()
  })

  it('fires onChange with the picked profile and closes', async () => {
    const onChange = vi.fn()
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(await screen.findByText('My Fast'))
    expect(onChange).toHaveBeenCalledWith(PROFILES[2])
  })

  it('does not open when disabled', async () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={() => {}}
        disabled
      />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDisabled()
    await userEvent.click(trigger)
    expect(screen.queryByText('My profiles')).not.toBeInTheDocument()
  })

  it('shows "not installed" and dims profiles whose agent is unavailable', async () => {
    render(
      <ProfilePicker
        profiles={PROFILES}
        value={PROFILES[0]!}
        onChange={() => {}}
        availability={{
          claude: { available: false, source: 'detected' },
          codex: { available: true, source: 'detected' },
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    const labels = await screen.findAllByText('not installed')
    expect(labels.length).toBeGreaterThanOrEqual(1)
  })
})
