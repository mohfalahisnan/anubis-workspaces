import { useMemo, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { AgentAvailability, AgentKind, ProfileSummary } from '@anubis/shared'
import { cn } from '@/lib/utils'

interface ProfilePickerProps {
  profiles: ProfileSummary[]
  value: ProfileSummary | null
  onChange: (next: ProfileSummary) => void
  disabled?: boolean
  /** Per-agent availability. When the selected profile's agent is
   *  unavailable the picker dims the corresponding rows. */
  availability?: Record<AgentKind, AgentAvailability>
}

export function ProfilePicker({ profiles, value, onChange, disabled, availability }: ProfilePickerProps) {
  const [open, setOpen] = useState(false)
  const empty = profiles.length === 0
  const isDisabled = disabled || empty

  const grouped = useMemo(() => {
    const user: ProfileSummary[] = []
    const builtin: ProfileSummary[] = []
    for (const p of profiles) {
      ;(p.source === 'user' ? user : builtin).push(p)
    }
    return { user, builtin }
  }, [profiles])

  const label = empty ? 'Loading…' : value?.name ?? 'Pick a profile'

  return (
    <Popover.Root open={open && !isDisabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={isDisabled}
          className={cn(
            'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 pl-2.5 font-mono text-[12px] text-foreground',
            isDisabled && 'cursor-not-allowed opacity-60',
            !isDisabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
          aria-haspopup='listbox'
          aria-expanded={open}
        >
          <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
          <span className='truncate'>{label}</span>
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[280px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          {grouped.user.length > 0 && (
            <Group
              title='My profiles'
              profiles={grouped.user}
              valueId={value?.id}
              onPick={(p) => { onChange(p); setOpen(false) }}
              availability={availability}
            />
          )}
          {grouped.builtin.length > 0 && (
            <Group
              title='Built-in'
              profiles={grouped.builtin}
              valueId={value?.id}
              onPick={(p) => { onChange(p); setOpen(false) }}
              availability={availability}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Group({
  title,
  profiles,
  valueId,
  onPick,
  availability,
}: {
  title: string
  profiles: ProfileSummary[]
  valueId: string | undefined
  onPick: (p: ProfileSummary) => void
  availability?: Record<AgentKind, AgentAvailability>
}) {
  return (
    <div className='py-1'>
      <div className='px-2 pb-1 pt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/70'>
        {title}
      </div>
      {profiles.map((p) => {
        const model = typeof p.config.model === 'string' ? p.config.model : ''
        const selected = p.id === valueId
        const agent = p.config.agent as AgentKind
        const unavailable = availability ? !availability[agent].available : false
        return (
          <button
            key={p.id}
            type='button'
            onClick={() => onPick(p)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
              selected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
              unavailable && 'opacity-60',
            )}
          >
            <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
            <span className='min-w-0 flex-1 truncate'>{p.name}</span>
            {unavailable ? (
              <span className='font-mono text-[10.5px] text-muted-foreground'>not installed</span>
            ) : (
              model && <span className='font-mono text-[10.5px] text-muted-foreground'>{model}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
