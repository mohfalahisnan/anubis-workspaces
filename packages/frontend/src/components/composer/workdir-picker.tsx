import { useState } from 'react'
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, XIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { WorkspaceSummary } from '@anubis/shared'
import { cn } from '@/lib/utils'

interface WorkdirPickerProps {
  /** Selected absolute path, or null for "new temp folder". */
  value: string | null
  onChange: (path: string | null) => void
  workspaces: WorkspaceSummary[]
  onRemove: (path: string) => void
  /** Called after a new folder is browsed, so the list can refresh. */
  onBrowsed?: (path: string) => void
  disabled?: boolean
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

async function pickFolder(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.anubis?.workspace) {
    return window.anubis.workspace.pick()
  }
  // Browser dev fallback: no native dialog available.
  const typed = window.prompt('Working directory (absolute path):')
  return typed && typed.trim() ? typed.trim() : null
}

export function WorkdirPicker({
  value, onChange, workspaces, onRemove, onBrowsed, disabled,
}: WorkdirPickerProps) {
  const [open, setOpen] = useState(false)
  const label = value ? basename(value) : 'New temp folder'

  async function onBrowse() {
    const picked = await pickFolder()
    if (!picked) return
    onChange(picked)
    onBrowsed?.(picked)
    setOpen(false)
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          title={value ?? 'New temp folder'}
          className={cn(
            'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 font-mono text-[12px] text-foreground',
            disabled && 'cursor-not-allowed opacity-60',
            !disabled && 'hover:bg-[color-mix(in_oklab,var(--anubis-gold)_8%,var(--muted))]',
          )}
          aria-haspopup='listbox'
          aria-expanded={open}
        >
          <FolderIcon className='size-3 text-[var(--anubis-gold)]' strokeWidth={2} />
          <span className='truncate'>{label}</span>
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          sideOffset={6}
          className='z-50 w-[320px] rounded-lg border border-border bg-popover p-1.5 shadow-lg outline-none'
        >
          <button
            type='button'
            onClick={() => { onChange(null); setOpen(false) }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
              value === null ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70',
            )}
          >
            <FolderPlusIcon className='size-3.5 text-muted-foreground' strokeWidth={2} />
            <span className='min-w-0 flex-1 truncate'>New temp folder</span>
          </button>

          {workspaces.length > 0 && (
            <div className='py-1'>
              <div className='px-2 pb-1 pt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/70'>
                Recent
              </div>
              {workspaces.map((w) => {
                const selected = w.path === value
                return (
                  <div
                    key={w.path}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                      selected ? 'bg-muted' : 'hover:bg-muted/70',
                    )}
                  >
                    <button
                      type='button'
                      onClick={() => { onChange(w.path); setOpen(false) }}
                      className='flex min-w-0 flex-1 flex-col items-start'
                    >
                      <span className='w-full truncate text-foreground'>{basename(w.path)}</span>
                      <span className='w-full truncate font-mono text-[10.5px] text-muted-foreground'>{w.path}</span>
                    </button>
                    <button
                      type='button'
                      aria-label='Forget this folder'
                      onClick={(e) => { e.stopPropagation(); onRemove(w.path) }}
                      className='flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100'
                    >
                      <XIcon className='size-3' strokeWidth={2} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <button
            type='button'
            onClick={() => void onBrowse()}
            className='mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-muted/70'
          >
            <FolderIcon className='size-3.5 text-muted-foreground' strokeWidth={2} />
            <span>Browse…</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
