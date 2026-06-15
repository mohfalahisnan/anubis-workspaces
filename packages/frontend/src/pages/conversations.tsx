import { useEffect, useState, type MouseEvent } from 'react'
import { ArrowUpRightIcon, PlusIcon, Trash2Icon, CheckIcon } from 'lucide-react'

import type { ConversationSummary } from '@anubis/shared'

import { deleteConversation, listConversations } from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'

type Row = {
  id: string
  title: string
  profile: string
  time: string
  status: 'idle' | 'running' | 'error'
  source: 'manual' | 'workflow' | 'content-generation'
}

type ConversationFilter = 'all' | 'manual' | 'workflow' | 'content-generation'

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
  const source = c.extra.source ?? 'manual'
  const label = source === 'workflow' ? `Workflow · ${profile}`
    : source === 'content-generation' ? `Generation · ${profile}`
    : profile
  return {
    id: c.id,
    title: c.title,
    profile: label,
    time: shortRelative(c.updatedAt),
    status: statusFromConversation(c),
    source,
  }
}

export function ConversationsPage() {
  const { navigate } = useNavigation()
  const { activeProject } = useProject()
  const [rows, setRows] = useState<Row[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all')

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function openConversation(id: string) {
    setSelectedId(id)
    navigate({ page: 'active-conversation', conversationId: id })
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === displayRows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(displayRows.map((r) => r.id)))
    }
  }

  // Clear selections when the filter changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [conversationFilter])

  async function removeConversation(id: string, title: string) {
    const ok = window.confirm(`Delete "${title}"? This cannot be undone.`)
    if (!ok) return
    // Optimistic: drop locally first so the row vanishes immediately.
    setRows((prev) => prev.filter((r) => r.id !== id))
    if (selectedId === id) setSelectedId(null)
    try {
      await deleteConversation(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Re-fetch on failure so the UI matches server state.
      const source = conversationFilter === 'all' ? undefined : conversationFilter
      const items = await listConversations({ limit: 50, source, projectId: activeProject?.id || undefined }).catch(() => [])
      if (items.length > 0) setRows(items.map(rowFromSummary))
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const ok = window.confirm(`Delete ${ids.length} selected conversation${ids.length === 1 ? '' : 's'}? This cannot be undone.`)
    if (!ok) return

    // Optimistically filter rows
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)))

    if (selectedId && selectedIds.has(selectedId)) {
      setSelectedId(null)
    }

    setSelectMode(false)
    setSelectedIds(new Set())

    try {
      await Promise.all(
        ids.map(async (id) => {
          await deleteConversation(id)
        })
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      // Re-fetch state
      const source = conversationFilter === 'all' ? undefined : conversationFilter
      const items = await listConversations({ limit: 50, source, projectId: activeProject?.id || undefined }).catch(() => [])
      if (items.length > 0) {
        setRows(items.map(rowFromSummary))
      } else {
        setRows([])
      }
    }
  }

  useEffect(() => {
    let active = true
    setError(null)
    const source = conversationFilter === 'all' ? undefined : conversationFilter
    listConversations({ limit: 50, source, projectId: activeProject?.id || undefined })
      .then((items) => {
        if (!active) return
        setRows(items.map(rowFromSummary))
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : String(e))
        setRows([])
      })
    return () => {
      active = false
    }
  }, [conversationFilter, activeProject?.id])

  const displayRows = rows

  // Auto-pick the first row by default when first loaded
  useEffect(() => {
    if (displayRows.length === 0) {
      setSelectedId(null)
    } else if (selectedId && displayRows.some((row) => row.id === selectedId)) {
      return
    } else if (displayRows[0]) {
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
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-semibold"
                >
                  {selectedIds.size === displayRows.length ? 'None' : 'All'}
                </button>
                <span className="text-muted-foreground/30">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode(false)
                    setSelectedIds(new Set())
                  }}
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-semibold"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSelectMode(true)}
                className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-semibold"
              >
                Select
              </button>
            )}
            <span className='inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground'>
              {count}
            </span>
          </div>
        </div>
        <div className='flex h-10 flex-shrink-0 items-center border-b border-border px-3'>
          <div className='grid h-7 w-full grid-cols-4 rounded-md border border-border bg-muted/45 p-0.5'>
            {(['all', 'manual', 'workflow', 'content-generation'] as const).map((filter) => (
              <button
                key={filter}
                type='button'
                onClick={() => setConversationFilter(filter)}
                className={cn(
                  'rounded-[5px] px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--anubis-gold-hi)]',
                  conversationFilter === filter &&
                    'bg-background text-foreground shadow-[0_1px_0_rgba(0,0,0,0.05)]',
                )}
              >
                {filter === 'workflow' ? 'Workflows' : filter === 'content-generation' ? 'Generation' : filter}
              </button>
            ))}
          </div>
        </div>

        <div className='flex-1 overflow-y-auto overflow-x-hidden'>
          {error && (
            <div className='px-4 py-3 text-[11px] text-muted-foreground'>
              Failed to load conversations.
            </div>
          )}
          {displayRows.map((row, i) => {
            const selected = row.id === selectedId
            return (
              <ConvRow
                key={row.id}
                row={row}
                selected={selected}
                selectMode={selectMode}
                checked={selectedIds.has(row.id)}
                showTopBorder={i > 0}
                onClick={() => openConversation(row.id)}
                onDelete={() => void removeConversation(row.id, row.title)}
                onToggleSelect={() => toggleSelect(row.id)}
              />
            )
          })}
          {displayRows.length === 0 && (
            <div className='px-4 py-8 text-center text-[12px] leading-relaxed text-muted-foreground'>
              No conversations match this filter.
            </div>
          )}
        </div>

        {selectMode && selectedIds.size > 0 && (
          <div className="flex-shrink-0 border-t border-border bg-muted/30 p-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground font-mono">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex h-7 items-center gap-1 rounded bg-destructive px-3 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2Icon className="size-3.5" />
              Delete {selectedIds.size}
            </button>
          </div>
        )}
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
  selectMode,
  checked,
  showTopBorder,
  onClick,
  onDelete,
  onToggleSelect,
}: {
  row: Row
  selected: boolean
  selectMode: boolean
  checked: boolean
  showTopBorder: boolean
  onClick: () => void
  onDelete: () => void
  onToggleSelect: () => void
}) {
  function handleDeleteClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    onDelete()
  }

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={selectMode ? onToggleSelect : onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (selectMode) onToggleSelect()
          else onClick()
        }
      }}
      aria-selected={selected || undefined}
      className={cn(
        'group/conv-row relative flex h-16 w-full cursor-pointer items-center gap-2.5 border-l-2 px-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--anubis-gold-hi)]',
        showTopBorder && 'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--border)_60%,transparent)]',
        selected && !selectMode
          ? 'border-l-[var(--anubis-gold)] bg-muted'
          : 'border-l-transparent hover:bg-muted/55',
        checked && selectMode && 'bg-muted/30 border-l-[var(--anubis-gold)]',
      )}
    >
      {selectMode && (
        <span
          aria-hidden
          className={cn(
            'flex size-[15px] shrink-0 items-center justify-center rounded border transition-colors',
            checked
              ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
              : 'border-border bg-background text-transparent',
          )}
        >
          <CheckIcon className='size-2.5' strokeWidth={3.5} />
        </span>
      )}

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

      {!selectMode && (
        <button
          type='button'
          onClick={handleDeleteClick}
          aria-label={`Delete conversation ${row.title}`}
          title='Delete conversation'
          className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive group-hover/conv-row:opacity-100'
        >
          <Trash2Icon className='size-[14px]' strokeWidth={2} />
        </button>
      )}

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
