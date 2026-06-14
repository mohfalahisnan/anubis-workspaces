import { useMemo } from 'react'
import { Settings2 } from 'lucide-react'
import type { PipelineStepProfileConfig, ProfileSummary } from '@anubis/shared'
import { ProfilePicker } from '@/components/composer/profile-picker'

interface StepProfilePickerProps {
  profiles: ProfileSummary[]
  stepProfiles: PipelineStepProfileConfig
  onChange: (next: PipelineStepProfileConfig) => void
}

const STEP_LABELS: { key: keyof PipelineStepProfileConfig; label: string }[] = [
  { key: 'brief',     label: 'Breakdown' },
  { key: 'refine',    label: 'Refine' },
  { key: 'ai_review', label: 'AI Review' },
]

function resolveProfile(profiles: ProfileSummary[], id: string | undefined): ProfileSummary | null {
  if (!id) return null
  return profiles.find((p) => p.id === id) ?? null
}

export function StepProfilePicker({ profiles, stepProfiles, onChange }: StepProfilePickerProps) {
  // Any agent can run a pipeline step except the web agents (gpt-web / qwen-web),
  // which drive a browser session and can't run headless.
  const selectableProfiles = useMemo(
    () => profiles.filter((p) => p.config.agent !== 'gpt-web' && p.config.agent !== 'qwen-web'),
    [profiles],
  )

  function handlePick(key: keyof PipelineStepProfileConfig, profile: ProfileSummary) {
    onChange({ ...stepProfiles, [key]: profile.id })
  }

  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-card/50 px-3 py-2'>
      <span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
        <Settings2 className='size-3.5' />
        Step AI Profiles
      </span>
      {STEP_LABELS.map(({ key, label }) => (
        <div key={key} className='flex items-center gap-2'>
          <span className='text-[11.5px] text-muted-foreground'>{label}</span>
          <ProfilePicker
            profiles={selectableProfiles}
            value={resolveProfile(selectableProfiles, stepProfiles[key])}
            onChange={(p) => handlePick(key, p)}
          />
        </div>
      ))}
    </div>
  )
}
