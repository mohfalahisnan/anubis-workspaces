import { useEffect, useState, type FormEvent } from 'react'
import {
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UserRoundIcon,
} from 'lucide-react'

import type { CompetitorSummary } from '@anubis/shared'

import {
  createCompetitor,
  deleteCompetitor,
  listCompetitors,
} from '@/api'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/* -----------------------------------------------------------
   Competitors
   -----------------------------------------------------------
   The list of Instagram profiles the user wants to keep tabs
   on. Add → enter handle → row appears in the grid with empty
   stats. Stats (followers, avgLikes, postCount) will fill in
   automatically once the research-crawler capture pipeline is
   wired; for now they're editable manually via the future
   editor.
   ----------------------------------------------------------- */

type Banner = { kind: 'error' | 'success'; message: string }

export function CompetitorsPage() {
  const [items, setItems] = useState<CompetitorSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  async function refresh() {
    try {
      setItems(await listCompetitors())
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load competitors.',
      })
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleDelete(c: CompetitorSummary) {
    const ok = window.confirm(`Stop tracking ${c.handle}?`)
    if (!ok) return
    setBusy(true)
    setBanner(null)
    try {
      await deleteCompetitor(c.id)
      await refresh()
      setBanner({ kind: 'success', message: `Removed ${c.handle}.` })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to remove.',
      })
    } finally {
      setBusy(false)
    }
  }

  const total = items?.length ?? 0

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-6 pt-7 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>
              Competitors
            </h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              {total === 0
                ? 'Add Instagram handles you want to keep an eye on. Posts from each one land in Content.'
                : `${total} handle${total === 1 ? '' : 's'} tracked. Posts from each one land in Content.`}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2.5'>
            <button
              type='button'
              onClick={() => void refresh()}
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
            <button
              type='button'
              onClick={() => setAddOpen(true)}
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              <PlusIcon className='size-[15px]' strokeWidth={2.4} />
              Add competitor
            </button>
          </div>
        </div>

        {banner && (
          <div
            role='status'
            className={cn(
              'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
              banner.kind === 'error'
                ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
                : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
            )}
          >
            {banner.message}
          </div>
        )}

        {items === null ? (
          <LoadingGrid />
        ) : items.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div className='mt-7 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {items.map((c) => (
              <CompetitorCard key={c.id} competitor={c} onDelete={() => handleDelete(c)} />
            ))}
          </div>
        )}

        {/* Footnote on capture pipeline */}
        {items && items.length > 0 && (
          <p className='mt-8 text-[12px] text-muted-foreground'>
            <span className='font-mono text-[var(--anubis-gold)]'>Note:</span>{' '}
            Followers, avgLikes, and post counts will auto-populate once the
            research-crawler capture pipeline is wired. For now they stay at
            zero until you fill them in manually.
          </p>
        )}
      </div>

      <AddCompetitorDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await refresh()
        }}
      />
    </div>
  )
}

/* ---------- Card ---------- */

function CompetitorCard({
  competitor,
  onDelete,
}: {
  competitor: CompetitorSummary
  onDelete: () => void
}) {
  const tint = competitor.tint ?? '#565B63'
  const followersLabel = formatBigNumber(competitor.followers)
  const avgLikesLabel = formatBigNumber(competitor.avgLikes)

  return (
    <article
      className={cn(
        'group flex flex-col gap-3 overflow-hidden rounded-md border border-border bg-card transition-colors',
        'hover:border-[color-mix(in_oklab,var(--anubis-gold)_28%,var(--border))]',
      )}
    >
      <div className='flex items-start gap-3 p-4'>
        <span
          aria-hidden
          className='relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border'
          style={{ background: tint }}
        >
          <UserRoundIcon className='size-5 text-white/80' strokeWidth={1.5} />
        </span>
        <div className='min-w-0 flex-1'>
          <h3 className='truncate font-mono text-[13.5px] font-semibold text-foreground'>
            {competitor.handle}
          </h3>
          {competitor.displayName && (
            <p className='truncate text-[12.5px] text-muted-foreground'>
              {competitor.displayName}
            </p>
          )}
        </div>
        {competitor.niche && (
          <span
            className='inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em]'
            style={{
              borderColor: `color-mix(in oklab, ${tint} 45%, transparent)`,
              background: `color-mix(in oklab, ${tint} 18%, transparent)`,
              color: tint,
            }}
          >
            {competitor.niche}
          </span>
        )}
      </div>

      <div className='border-t border-border px-4 py-3'>
        <div className='grid grid-cols-3 gap-2 text-center'>
          <Stat label='Followers' value={followersLabel} />
          <Stat label='Avg likes' value={avgLikesLabel} />
          <Stat label='Posts' value={competitor.postCount.toLocaleString()} />
        </div>
      </div>

      <div className='flex items-center justify-between border-t border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground'>
        <span>
          {competitor.lastRefreshedAt
            ? `Refreshed ${relativeTime(competitor.lastRefreshedAt)}`
            : 'Never refreshed'}
        </span>
        <button
          type='button'
          onClick={onDelete}
          aria-label={`Stop tracking ${competitor.handle}`}
          className='inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive'
        >
          <Trash2Icon className='size-3.5' strokeWidth={2} />
          Remove
        </button>
      </div>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col items-center gap-0.5'>
      <span className='font-mono text-[14px] font-semibold tabular-nums text-foreground'>
        {value}
      </span>
      <span className='font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground'>
        {label}
      </span>
    </div>
  )
}

/* ---------- Add dialog ---------- */

function AddCompetitorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [niche, setNiche] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setHandle('')
      setDisplayName('')
      setNiche('')
      setErr(null)
      setSubmitting(false)
    }
  }, [open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!handle.trim()) {
      setErr('Handle is required.')
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      await createCompetitor({
        handle: handle.trim(),
        displayName: displayName.trim() || undefined,
        niche: niche.trim() || undefined,
      })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add competitor.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-md bg-card p-0'>
        <form onSubmit={submit}>
          <DialogHeader className='border-b border-border px-6 py-4'>
            <DialogTitle>Add competitor</DialogTitle>
            <DialogDescription>
              Just the handle is required. You can edit the rest later.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-4 px-6 py-5'>
            <Field label='Handle' htmlFor='c-handle' hint='With or without the leading @.'>
              <input
                id='c-handle'
                type='text'
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder='ali.abdaal'
                autoFocus
                className={textInput}
              />
            </Field>

            <Field label='Display name' htmlFor='c-name'>
              <input
                id='c-name'
                type='text'
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder='Ali Abdaal'
                className={textInput}
              />
            </Field>

            <Field label='Niche' htmlFor='c-niche' hint='A one-word tag, used for grouping.'>
              <input
                id='c-niche'
                type='text'
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder='Productivity'
                className={textInput}
              />
            </Field>

            {err && (
              <p className='rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12.5px] text-destructive'>
                {err}
              </p>
            )}
          </div>

          <DialogFooter className='border-t border-border px-6 py-3'>
            <button
              type='button'
              onClick={onClose}
              disabled={submitting}
              className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={submitting || !handle.trim()}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                submitting || !handle.trim()
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
              )}
            >
              {submitting ? 'Adding…' : 'Add competitor'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Helpers ---------- */

const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label
        htmlFor={htmlFor}
        className='text-[12.5px] font-medium tracking-[-0.005em] text-foreground'
      >
        {label}
      </label>
      {children}
      {hint && <p className='text-[11.5px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function formatBigNumber(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function relativeTime(ms: number): string {
  const d = Date.now() - ms
  const min = Math.round(d / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

function LoadingGrid() {
  return (
    <div className='mt-7 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className='h-[178px] animate-pulse rounded-md border border-border bg-card'
        />
      ))}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className='mt-10 flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center'>
      <UserRoundIcon
        className='size-7 text-muted-foreground'
        strokeWidth={1.5}
      />
      <div>
        <h2 className='text-[16px] font-semibold tracking-[-0.01em]'>
          No competitors tracked yet
        </h2>
        <p className='mt-1.5 text-[13px] text-muted-foreground'>
          Add a handle and posts from that account will start showing up in Content.
        </p>
      </div>
      <button
        type='button'
        onClick={onAdd}
        className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)]'
      >
        <PlusIcon className='size-[15px]' strokeWidth={2.4} />
        Add your first competitor
      </button>
    </div>
  )
}
