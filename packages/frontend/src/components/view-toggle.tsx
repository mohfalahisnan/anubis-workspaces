import { GalleryVerticalEndIcon, Table2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ViewMode = 'grid' | 'table'

/** Grid / table switch, shared by the Content and Competitors pages. */
export function ViewToggle({
  view,
  onChange,
  className,
}: {
  view: ViewMode
  onChange: (view: ViewMode) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex gap-0.5 rounded-md border border-border bg-background p-[3px]', className)}>
      <button
        type='button'
        onClick={() => onChange('grid')}
        aria-pressed={view === 'grid'}
        className={cn(
          'flex size-8 items-center justify-center rounded-[5px] transition-colors',
          view === 'grid'
            ? 'bg-card text-[var(--anubis-gold)] shadow-[inset_0_-2px_0_var(--anubis-gold)]'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-label='Grid view'
      >
        <GalleryVerticalEndIcon className='size-[15px]' strokeWidth={2} />
      </button>
      <button
        type='button'
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
        className={cn(
          'flex size-8 items-center justify-center rounded-[5px] transition-colors',
          view === 'table'
            ? 'bg-card text-[var(--anubis-gold)] shadow-[inset_0_-2px_0_var(--anubis-gold)]'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-label='Table view'
      >
        <Table2Icon className='size-[15px]' strokeWidth={2} />
      </button>
    </div>
  )
}
