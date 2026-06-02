import { ArrowUpRightIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { actions, type Action, type ActionLiveKey } from './actions'

export type LiveCounts = Partial<Record<ActionLiveKey, number | undefined>>

export function ActionsGrid({
  counts,
  onActionClick,
}: {
  counts: LiveCounts
  onActionClick?: (action: Action) => void
}) {
  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
      {actions.map((action) => (
        <ActionCard
          key={action.id}
          action={action}
          count={action.live ? counts[action.live] : undefined}
          onClick={() => onActionClick?.(action)}
        />
      ))}
    </div>
  )
}

function ActionCard({
  action,
  count,
  onClick,
}: {
  action: Action
  count: number | undefined
  onClick: () => void
}) {
  const Icon = action.icon
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-stretch gap-3 rounded-md border bg-card p-5 text-left transition-colors',
        'hover:bg-muted',
        action.primary
          ? 'border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'
          : 'border-border',
      )}
    >
      {action.primary && (
        <span
          aria-hidden
          className='absolute inset-y-3 left-0 w-[2px] rounded-r-full bg-[var(--anubis-gold)]'
        />
      )}

      <div className='flex items-start justify-between gap-3'>
        <div
          className={cn(
            'flex size-9 items-center justify-center rounded-md border border-border bg-background',
            action.primary && 'text-[var(--anubis-gold)]',
          )}
        >
          <Icon className='size-[18px]' strokeWidth={1.5} />
        </div>
        <ArrowUpRightIcon
          className='size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-[var(--anubis-gold)]'
          strokeWidth={1.5}
        />
      </div>

      <div className='flex flex-col gap-1'>
        <h3 className='text-[15px] font-semibold tracking-[-0.01em] text-foreground'>
          {action.title}
        </h3>
        <p className='text-[13px] leading-relaxed text-muted-foreground'>
          {action.description}
        </p>
      </div>

      {action.live && (
        <div className='mt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground tabular-nums'>
          {count === undefined ? (
            <span className='opacity-60'>—</span>
          ) : (
            <>
              <span className='font-medium text-foreground'>{count}</span>
              {action.liveLabel ? ` ${action.liveLabel}` : ''}
            </>
          )}
        </div>
      )}
    </button>
  )
}
