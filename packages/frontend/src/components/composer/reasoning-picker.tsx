import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { ReasoningEffort } from '@/api'
import { cn } from '@/lib/utils'

interface ReasoningPickerProps {
  efforts: readonly ReasoningEffort[]
  value: ReasoningEffort
  isOverride: boolean
  onChange: (next: ReasoningEffort) => void
  disabled?: boolean
}

export function ReasoningPicker({
  efforts,
  value,
  isOverride,
  onChange,
  disabled,
}: ReasoningPickerProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          data-modified={isOverride}
          aria-haspopup='listbox'
          aria-expanded={open}
          title={isOverride ? 'Overrides profile default' : undefined}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 font-mono text-[12px] text-foreground',
            disabled && 'cursor-not-allowed opacity-60',
            !disabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
        >
          <span className='text-muted-foreground'>effort:</span>
          <span>{value}</span>
          {isOverride && (
            <span
              aria-label='Overridden'
              className='ml-0.5 inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]'
            />
          )}
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[160px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          {efforts.map((e) => (
            <button
              key={e}
              type='button'
              onClick={() => { onChange(e); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors',
                e === value ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
              )}
            >
              {e}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
