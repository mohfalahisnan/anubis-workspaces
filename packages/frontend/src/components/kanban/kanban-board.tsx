import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface KanbanColumn<TStatus extends string, TItem> {
  id: TStatus
  label: string
  items: TItem[]
  count?: number
  dotClassName?: string
  emptyLabel?: string
}

export interface KanbanBoardProps<TStatus extends string, TItem> {
  columns: KanbanColumn<TStatus, TItem>[]
  getItemId: (item: TItem) => string
  renderItem: (item: TItem) => ReactNode
  onMove: (itemId: string, status: TStatus) => void | Promise<void>
  className?: string
  columnClassName?: string
  emptyClassName?: string
}

export function KanbanBoard<TStatus extends string, TItem>({
  columns,
  getItemId,
  renderItem,
  onMove,
  className,
  columnClassName,
  emptyClassName,
}: KanbanBoardProps<TStatus, TItem>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-background p-6', className)}>
      <div className='flex h-full min-w-max items-start gap-4 pb-4'>
        {columns.map((column) => (
          <section
            key={column.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const itemId = e.dataTransfer.getData('text/plain')
              if (itemId) void onMove(itemId, column.id)
            }}
            className={cn(
              'flex h-full w-[300px] shrink-0 flex-col rounded-md border border-border bg-card/20 p-3 transition-colors hover:bg-card/30',
              columnClassName,
            )}
          >
            <div className='flex items-center justify-between border-b border-border pb-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <span className={cn('size-2 rounded-full bg-[var(--anubis-gold)]', column.dotClassName)} />
                <h2 className='truncate text-xs font-semibold uppercase tracking-wider text-foreground'>
                  {column.label}
                </h2>
              </div>
              <span className='rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground'>
                {column.count ?? column.items.length}
              </span>
            </div>

            <div className='mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1'>
              {column.items.length === 0 ? (
                <div
                  className={cn(
                    'flex h-24 items-center justify-center rounded-md border border-dashed border-border/60 p-4 text-center text-[11px] text-muted-foreground',
                    emptyClassName,
                  )}
                >
                  {column.emptyLabel ?? 'Empty'}
                </div>
              ) : column.items.map((item) => (
                <div
                  key={getItemId(item)}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', getItemId(item))}
                >
                  {renderItem(item)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
