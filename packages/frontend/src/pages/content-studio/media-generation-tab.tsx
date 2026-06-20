import { RotateCcw, FileDown } from 'lucide-react'
import type { ProfileSummary } from '@anubis/shared'
import { MediaProfilePicker } from './generation-profile-picker'

const PLACEHOLDERS: Record<'image' | 'video', string> = {
  image: '{{concept}} · {{subject}} · {{style}} · {{mood}} · {{keyElements}} · {{slide}}',
  video: '{{videoScript}} · {{concept}}',
}

export function MediaGenerationTab({
  media, profiles, profileValue, onProfileChange, prompt, onPromptChange, defaultPrompt,
}: {
  media: 'image' | 'video'
  profiles: ProfileSummary[]
  profileValue: string | undefined
  onProfileChange: (id: string) => void
  prompt: string | undefined
  onPromptChange: (value: string | undefined) => void
  defaultPrompt: string
}) {
  const usingDefault = !prompt?.trim()
  return (
    <div className='space-y-4'>
      <div>
        <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Generation profile</span>
        <MediaProfilePicker media={media} profiles={profiles} value={profileValue} onChange={onProfileChange} />
        <p className='mt-1 text-[11px] text-muted-foreground'>Manual = prompt only (you generate it). Per-project override; unset inherits the global picker.</p>
      </div>
      <div>
        <div className='mb-1 flex items-center justify-between'>
          <span className='text-[12px] font-medium text-muted-foreground'>
            Generation prompt {usingDefault ? <span className='text-[11px]'>· using default</span> : <span className='text-[11px] text-[var(--anubis-gold)]'>· customized</span>}
          </span>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => onPromptChange(defaultPrompt)}
              className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
              title='Load the default template into the editor so you can tweak it'
            >
              <FileDown className='size-3' /> Edit from default
            </button>
            <button
              type='button'
              onClick={() => onPromptChange(undefined)}
              disabled={usingDefault}
              className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40'
              title='Discard the override and use the shipped default'
            >
              <RotateCcw className='size-3' /> Reset to default
            </button>
          </div>
        </div>
        <textarea
          value={prompt ?? ''}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={10}
          placeholder={defaultPrompt || '(loading default…)'}
          className='w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--anubis-gold)]/60'
        />
        <p className='mt-1 text-[11px] text-muted-foreground'>
          Placeholders: <span className='font-mono'>{PLACEHOLDERS[media]}</span>. Leave blank to use the default shown above.
        </p>
      </div>
    </div>
  )
}
