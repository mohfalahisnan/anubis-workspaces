import type { CompetitorLevel } from '@anubis/shared'
import { cn } from '@/lib/utils'

export type LevelFilter = CompetitorLevel | 'all'

interface Option {
  value: LevelFilter
  label: string
  dot: string | null
}

const OPTIONS: Option[] = [
  { value: 'all', label: 'All', dot: null },
  { value: 'green', label: 'Green', dot: '#5E8F55' },
  { value: 'yellow', label: 'Yellow', dot: '#C9A645' },
  { value: 'red', label: 'Red', dot: '#B5483E' },
  { value: 'black', label: 'Black', dot: '#1B1D22' },
  { value: 'unknown', label: 'Unknown', dot: '#6B6F78' },
]

interface Props {
  value: LevelFilter
  onChange: (next: LevelFilter) => void
  className?: string
}

export function CompetitorLevelFilter({ value, onChange, className }: Props) {
  return (
    <div
      role='radiogroup'
      aria-label='Filter by level'
      className={cn('inline-flex flex-wrap items-center gap-1.5', className)}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
              active
                ? 'border-[var(--anubis-gold)] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {opt.dot && (
              <span
                aria-hidden
                className='size-2 rounded-full ring-1 ring-black/20'
                style={{ background: opt.dot }}
              />
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function matchesLevelFilter(level: CompetitorLevel, filter: LevelFilter): boolean {
  return filter === 'all' || filter === level
}
