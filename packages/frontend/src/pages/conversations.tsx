import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ArrowUpRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import type { ConversationSummary } from '@anubis/shared'

import { deleteConversation, listConversations } from '@/api'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'

type Row = {
  id: string
  title: string
  profile: string
  time: string
  status: 'idle' | 'running' | 'error'
}

const FALLBACK_ROWS: Row[] = [
  { id: 'mock-1', title: "Audit @kayla.studio's last 30 posts",        profile: 'Claude · Research', time: '2m',        status: 'running' },
  { id: 'mock-2', title: 'Draft June content calendar from brief',     profile: 'Claude · Writing',  time: '18m',       status: 'idle' },
  { id: 'mock-3', title: 'Refactor the StreamRelay flush logic',       profile: 'Codex · Coding',    time: '1h',        status: 'idle' },
  { id: 'mock-4', title: 'Compare top 5 productivity creators',        profile: 'Claude · Research', time: '3h',        status: 'idle' },
  { id: 'mock-5', title: 'Migrate auth to the new token schema',       profile: 'Codex · Coding',    time: '5h',        status: 'error' },
  { id: 'mock-6', title: 'Pull weekly research digest',                profile: 'Claude · Research', time: 'Yesterday', status: 'idle' },
  { id: 'mock-7', title: 'Spike: try Codex on the design system PR',   profile: 'Codex · Coding',    time: 'Yesterday', status: 'running' },
  { id: 'mock-8', title: 'Investigate the flaky stream-relay test',    profile: 'Codex · Coding',    time: '2d',        status: 'idle' },
]

function statusFromConversation(c: ConversationSummary): Row['status'] {
  if (c.status === 'running' || c.status === 'pending') return 'running'
  if (c.status === 'error') return 'error'
  return 'idle'
}

function shortRelative(updatedAt: number): string {
  const d = Date.now() - updatedAt
  const min = Math.round(d / 60_000)
  if (min < 60) return `${Math.max(1, min)}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d`
  return new Date(updatedAt).toLocaleDateString()
}

function rowFromSummary(c: ConversationSummary): Row {
  const profile = c.profileId ?? `${c.agent}`
  return {
    id: c.id,
    title: c.title,
    profile,
    time: shortRelative(c.updatedAt),
    status: statusFromConversation(c),
  }
}

export function ConversationsPage() {
  const { navigate } = useNavigation()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function openConversation(id: string) {
    setSelectedId(id)
    navigate({ page: 'active-conversation', conversationId: id.startsWith('mock-') ? undefined : id })
  }

  async function removeConversation(id: string, title: string) {
    const ok = window.confirm(`Delete "${title}"? This cannot be undone.`)
    if (!ok) return
    // Optimistic: drop locally first so the row vanishes immediately.
    setRows((prev) => (prev ?? FALLBACK_ROWS).filter((r) => r.id !== id))
    if (selectedId === id) setSelectedId(null)
    if (id.startsWith('mock-')) return
    try {
      await deleteConversation(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Re-fetch on failure so the UI matches server state.
      const items = await listConversations({ limit: 50 }).catch(() => [])
      if (items.length > 0) setRows(items.map(rowFromSummary))
    }
  }

  useEffect(() => {
    let active = true
    listConversations({ limit: 50 })
      .then((items) => {
        if (!active) return
        if (items.length === 0) {
          setRows(FALLBACK_ROWS)
        } else {
          setRows(items.map(rowFromSummary))
        }
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : String(e))
        setRows(FALLBACK_ROWS)
      })
    return () => {
      active = false
    }
  }, [])

  const displayRows = rows ?? FALLBACK_ROWS

  // Auto-pick the 4th row by default when first loaded (matches mockup)
  useEffect(() => {
    if (selectedId === null && displayRows.length >= 4) {
      setSelectedId(displayRows[3]!.id)
    } else if (selectedId === null && displayRows[0]) {
      setSelectedId(displayRows[0].id)
    }
  }, [displayRows, selectedId])

  const count = displayRows.length

  return (
    <div className='flex flex-1 overflow-hidden bg-background'>
      {/* Left list pane */}
      <aside className='flex w-80 shrink-0 flex-col border-r border-border'>
        <div className='flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-4'>
          <span className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
            Conversations
          </span>
          <span className='inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground'>
            {count}
          </span>
        </div>

        <div className='flex-1 overflow-y-auto overflow-x-hidden'>
          {error && (
            <div className='px-4 py-3 text-[11px] text-muted-foreground'>
              Backend offline — showing sample conversations.
            </div>
          )}
          {displayRows.map((row, i) => {
            const selected = row.id === selectedId
            return (
              <ConvRow
                key={row.id}
                row={row}
                selected={selected}
                showTopBorder={i > 0}
                onClick={() => openConversation(row.id)}
                onDelete={() => void removeConversation(row.id, row.title)}
              />
            )
          })}
        </div>
      </aside>

      {/* Right empty-state pane */}
      <main
        className='relative flex flex-1 items-center justify-center overflow-hidden px-10 py-10'
        style={{
          background:
            'radial-gradient(90% 60% at 50% 38%, color-mix(in oklab, var(--anubis-gold) 4%, transparent), transparent 62%)',
        }}
      >
        <div className='flex max-w-[680px] flex-col items-center text-center'>
          <AnubisMark size={48} />
          <h2 className='mt-5 text-[32px] font-semibold leading-[1.12] tracking-[-0.02em]'>
            Pick a conversation
          </h2>
          <p className='mt-2.5 text-[16px] leading-relaxed text-muted-foreground'>
            Or start a new one with any profile.
          </p>

          <button
            type='button'
            onClick={() => navigate({ page: 'active-conversation' })}
            className='mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-[18px] text-[14px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--anubis-gold-hi)] focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          >
            <PlusIcon className='size-[15px]' strokeWidth={2.4} />
            New conversation
          </button>

          <div className='mt-8 grid w-full grid-cols-1 gap-3.5 sm:grid-cols-3'>
            <SuggestionCard
              title='Audit competitor posts'
              hint='Instagram research with the Claude Research profile'
            />
            <SuggestionCard title='Draft a content calendar' hint='From a single brief' />
            <SuggestionCard
              title='Review the staging deploy'
              hint='Codex on workspace-write'
            />
          </div>
        </div>
      </main>
    </div>
  )
}

function ConvRow({
  row,
  selected,
  showTopBorder,
  onClick,
  onDelete,
}: {
  row: Row
  selected: boolean
  showTopBorder: boolean
  onClick: () => void
  onDelete: () => void
}) {
  function handleDeleteClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    onDelete()
  }

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-selected={selected || undefined}
      className={cn(
        'group/conv-row relative flex h-16 w-full cursor-pointer items-center gap-2.5 border-l-2 px-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--anubis-gold-hi)]',
        showTopBorder && 'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--border)_60%,transparent)]',
        selected
          ? 'border-l-[var(--anubis-gold)] bg-muted'
          : 'border-l-transparent hover:bg-muted/55',
      )}
    >
      <span className='flex min-w-0 flex-1 flex-col gap-[5px]'>
        <span className='truncate text-[14px] leading-tight tracking-[-0.01em] text-foreground'>
          {row.title}
        </span>
        <span className='inline-flex min-w-0 items-center font-mono text-[11px] leading-none text-muted-foreground'>
          <span className='mr-1.5 inline-block size-[5px] flex-shrink-0 rounded-full bg-[var(--anubis-gold)]' />
          <span className='truncate'>{row.profile}</span>
          <span className='mx-1.5 opacity-55'>·</span>
          <span className='shrink-0 opacity-80'>{row.time}</span>
        </span>
      </span>

      <button
        type='button'
        onClick={handleDeleteClick}
        aria-label={`Delete conversation ${row.title}`}
        title='Delete conversation'
        className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive group-hover/conv-row:opacity-100'
      >
        <Trash2Icon className='size-[14px]' strokeWidth={2} />
      </button>

      <StatusDot status={row.status} />
    </div>
  )
}

function StatusDot({ status }: { status: Row['status'] }) {
  return (
    <span
      aria-label={status}
      className={cn(
        'size-[7px] shrink-0 rounded-full',
        status === 'idle' && 'bg-muted-foreground opacity-50',
        status === 'error' && 'bg-destructive',
        status === 'running' &&
          'bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]',
      )}
    />
  )
}

function SuggestionCard({ title, hint }: { title: string; hint: string }) {
  return (
    <button
      type='button'
      className='group relative rounded-[13px] border border-border bg-card p-4 text-left transition-all hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted'
    >
      <ArrowUpRightIcon
        className='absolute right-3.5 top-3.5 size-[15px] text-[var(--anubis-gold)] transition-transform group-hover:translate-x-px group-hover:-translate-y-px'
        strokeWidth={2}
      />
      <h3 className='mr-6 text-[14px] font-semibold leading-tight tracking-[-0.01em] text-foreground'>
        {title}
      </h3>
      <p className='mt-1 text-[12.5px] leading-[1.45] text-muted-foreground'>{hint}</p>
    </button>
  )
}
