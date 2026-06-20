import { useMemo } from 'react'
import { ImageIcon, VideoIcon } from 'lucide-react'
import type { GenerationProfileConfig, ProfileSummary } from '@anubis/shared'
import { ProfilePicker } from '@/components/composer/profile-picker'

/** Must match FLOW_IMAGE_PROFILE_ID in the backend agent-generators module. */
const FLOW_IMAGE_PROFILE_ID = 'google-flow'

interface GenerationProfilePickerProps {
  profiles: ProfileSummary[]
  generationProfiles: GenerationProfileConfig
  onChange: (next: GenerationProfileConfig) => void
}

const FLOW_OPTION: ProfileSummary = {
  id: FLOW_IMAGE_PROFILE_ID,
  name: 'Google Flow (browser)',
  description: 'Generate images via Google Flow browser automation.',
  source: 'builtin',
  config: { agent: 'gpt-web' },
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
}

/** Must match MANUAL_PROFILE_ID in the backend derive-tasks module. */
const MANUAL_PROFILE_ID = 'manual'

const MANUAL_OPTION: ProfileSummary = {
  id: MANUAL_PROFILE_ID,
  name: "Manual (I'll generate it)",
  description: 'Produce the prompt only — generate the media yourself, no agent run.',
  source: 'builtin',
  config: { agent: 'codex' },
  sortOrder: -1,
  createdAt: 0,
  updatedAt: 0,
}

function resolveProfile(profiles: ProfileSummary[], id: string | undefined): ProfileSummary | null {
  if (!id) return profiles.find((p) => p.id === MANUAL_PROFILE_ID) ?? null
  return profiles.find((p) => p.id === id) ?? null
}

export function GenerationProfilePicker({ profiles, generationProfiles, onChange }: GenerationProfilePickerProps) {
  // Agent profiles that can run headless generation (exclude web agents).
  const agentProfiles = useMemo(
    () => profiles.filter((p) => p.config.agent !== 'gpt-web' && p.config.agent !== 'qwen-web'),
    [profiles],
  )
  const imageProfiles = useMemo(() => [MANUAL_OPTION, FLOW_OPTION, ...agentProfiles], [agentProfiles])
  const videoProfiles = useMemo(() => [MANUAL_OPTION, ...agentProfiles], [agentProfiles])

  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-card/50 px-3 py-2'>
      <span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
        Generation AI Profiles
      </span>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-[11.5px] text-muted-foreground'><ImageIcon className='size-3.5' /> Image</span>
        <ProfilePicker
          profiles={imageProfiles}
          value={resolveProfile(imageProfiles, generationProfiles.image)}
          onChange={(p) => onChange({ ...generationProfiles, image: p.id })}
        />
      </div>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-[11.5px] text-muted-foreground'><VideoIcon className='size-3.5' /> Video</span>
        <ProfilePicker
          profiles={videoProfiles}
          value={resolveProfile(videoProfiles, generationProfiles.video)}
          onChange={(p) => onChange({ ...generationProfiles, video: p.id })}
        />
      </div>
    </div>
  )
}
