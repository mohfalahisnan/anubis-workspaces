import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import { cn } from '@/lib/utils'

interface BudgetPickerProps {
  value: number | undefined
  onChange: (next: number | undefined) => void
  disabled?: boolean
}

const BUDGET_OPTIONS = [
  { label: 'Auto', value: undefined },
  { label: '1k', value: 1000 },
  { label: '2k', value: 2000 },
  { label: '5k', value: 5000 },
  { label: '10k', value: 10000 },
  { label: '20k', value: 20000 },
  { label: '40k', value: 40000 },
]

export function BudgetPicker({
  value,
  onChange,
  disabled,
}: BudgetPickerProps) {
  const [open, setOpen] = useState(false)
  const selected = BUDGET_OPTIONS.find((o) => o.value === value) || BUDGET_OPTIONS[0]

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          aria-haspopup='listbox'
          aria-expanded={open}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 font-mono text-[12px] text-foreground',
            disabled && 'cursor-not-allowed opacity-60',
            !disabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
        >
          <span className='text-muted-foreground'>budget:</span>
          <span>{selected.label}</span>
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[140px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          {BUDGET_OPTIONS.map((o) => (
            <button
              key={o.label}
              type='button'
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors',
                o.value === value ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
              )}
            >
              {o.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
