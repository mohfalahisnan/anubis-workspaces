import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CheckIcon,
  CheckSquareIcon,
  DownloadCloudIcon,
  Edit3Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react'

import type { CompetitorLevelsConfig, CompetitorLevelOverride, CompetitorSummary } from '@anubis/shared'
import { effectiveLevel } from '@anubis/shared'
import { useProject } from '@/lib/use-project'

import {
  captureCompetitor,
  createCompetitor,
  deleteCompetitor,
  listCompetitors,
  updateCompetitor,
} from '@/api'
import { FindCompetitorsDialog } from './competitor-dialogs'
import { CompetitorLevelFilter, matchesLevelFilter, type LevelFilter } from '@/components/competitor-level-filter'
import {
  PaginationBar,
  SearchBox,
  SortControl,
  paginate,
  useSorted,
  type SortOption,
  type SortState,
} from '@/components/list-controls'
import { ViewToggle, type ViewMode } from '@/components/view-toggle'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { levelTint, levelTip, resolveLevel } from '@/lib/competitor-level'
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

type CompetitorSortKey = 'handle' | 'followers' | 'avgLikes' | 'postCount' | 'lastRefreshedAt'

const COMPETITOR_SORT_OPTIONS: readonly SortOption<CompetitorSortKey>[] = [
  { value: 'followers', label: 'Followers' },
  { value: 'avgLikes', label: 'Avg likes' },
  { value: 'postCount', label: 'Posts' },
  { value: 'handle', label: 'Handle' },
  { value: 'lastRefreshedAt', label: 'Last refresh' },
]

const COMPETITOR_SORT_ACCESSORS: Record<CompetitorSortKey, (c: CompetitorSummary) => unknown> = {
  handle: (c) => c.handle.replace(/^@/, '').toLowerCase(),
  followers: (c) => c.followers,
  avgLikes: (c) => c.avgLikes,
  postCount: (c) => c.postCount,
  lastRefreshedAt: (c) => c.lastRefreshedAt,
}

function matchesCompetitorQuery(c: CompetitorSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [c.handle, c.displayName, c.niche, c.bio]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q)
}

export function CompetitorsPage() {
  const { activeProject } = useProject()
  const [items, setItems] = useState<CompetitorSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<CompetitorSummary | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [capturing, setCapturing] = useState<Set<string>>(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<CompetitorSortKey>>({ key: 'followers', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(24)
  const [view, setView] = useState<ViewMode>('grid')
  const { config: levelsCfg } = useCompetitorLevels()

  const filteredItems = useMemo(
    () =>
      items?.filter(
        (c) =>
          matchesLevelFilter(effectiveLevel(c.level, c.followers, levelsCfg), levelFilter) &&
          matchesCompetitorQuery(c, query),
      ),
    [items, levelFilter, levelsCfg, query],
  )

  const sortedItems = useSorted(filteredItems ?? [], sort, COMPETITOR_SORT_ACCESSORS)
  const matchCount = filteredItems?.length ?? 0
  const { slice: visibleItems, page: currentPage } = paginate(sortedItems, page, pageSize)

  // Keep the page in range when filters/sorting shrink the result set.
  useEffect(() => {
    if (currentPage !== page) setPage(currentPage)
  }, [currentPage, page])

  // Reset to the first page whenever the filter inputs change.
  useEffect(() => {
    setPage(1)
  }, [levelFilter, query, sort.key, sort.dir, pageSize, activeProject?.id])

  async function refresh() {
    try {
      setItems(dedupeCompetitors(await listCompetitors(activeProject?.id || undefined)))
    } catch (e) {
      setItems([])
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load competitors.',
      })
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id])

  async function handleCapture(c: CompetitorSummary) {
    setCapturing((prev) => new Set(prev).add(c.id))
    setBanner(null)
    try {
      const result = await captureCompetitor(c.id)
      await refresh()
      setBanner({
        kind: 'success',
        message:
          result.capturedCount > 0
            ? `Captured ${result.capturedCount} post${result.capturedCount === 1 ? '' : 's'} from ${c.handle}.`
            : `${c.handle} responded but no new posts came back.`,
      })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Capture failed.',
      })
    } finally {
      setCapturing((prev) => {
        const next = new Set(prev)
        next.delete(c.id)
        return next
      })
    }
  }

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

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    setBulkConfirm(false)
    setBusy(true)
    setBanner(null)
    const ids = [...selected]
    const errors: string[] = []
    for (const id of ids) {
      try {
        await deleteCompetitor(id)
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    await refresh()
    setBusy(false)
    exitSelectMode()
    if (errors.length === 0) {
      setBanner({
        kind: 'success',
        message: `Removed ${ids.length} competitor${ids.length === 1 ? '' : 's'}.`,
      })
    } else if (errors.length === ids.length) {
      setBanner({ kind: 'error', message: `All ${ids.length} deletes failed: ${errors[0]}` })
    } else {
      setBanner({
        kind: 'error',
        message: `Removed ${ids.length - errors.length} of ${ids.length}; ${errors.length} failed.`,
      })
    }
  }

  async function handleUpdate(
    competitor: CompetitorSummary,
    patch: {
      displayName?: string
      niche?: string
      tint?: string
      followers?: number
      avgLikes?: number
      notes?: string
      bio?: string
      level?: CompetitorLevelOverride | null
    },
  ) {
    setBusy(true)
    setBanner(null)
    try {
      await updateCompetitor(competitor.id, patch)
      setEditing(null)
      await refresh()
      setBanner({ kind: 'success', message: `Updated ${competitor.handle}.` })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to update competitor.',
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
          <div className='flex shrink-0 flex-wrap items-center gap-2.5'>
            <button
              type='button'
              onClick={() => void refresh()}
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
            {selectMode ? (
              <button
                type='button'
                onClick={exitSelectMode}
                disabled={busy}
                className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
              >
                <XIcon className='size-[15px]' strokeWidth={2} />
                Done
              </button>
            ) : (
              <button
                type='button'
                onClick={() => setSelectMode(true)}
                disabled={busy || !items || items.length === 0}
                className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
              >
                <CheckSquareIcon className='size-[15px]' strokeWidth={2} />
                Select
              </button>
            )}
            <button
              type='button'
              onClick={() => setFindOpen(true)}
              disabled={busy || selectMode}
              className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
            >
              <SearchIcon className='size-[15px]' strokeWidth={2} />
              Find competitors
            </button>
            <button
              type='button'
              onClick={() => setAddOpen(true)}
              disabled={busy || selectMode}
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

        {items && items.length > 0 && (
          <div className='mt-5 flex flex-col gap-3'>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
              <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
              <ViewToggle view={view} onChange={setView} className='ml-auto' />
            </div>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder='Search handle, name, niche, bio…'
                className='w-full sm:w-[320px]'
              />
              <SortControl options={COMPETITOR_SORT_OPTIONS} value={sort} onChange={setSort} className='ml-auto' />
            </div>
          </div>
        )}

        {selectMode && items && items.length > 0 && (
          <BulkSelectBar
            count={selected.size}
            total={sortedItems.length}
            onSelectAll={() => setSelected(new Set(sortedItems.map((c) => c.id)))}
            onClear={() => setSelected(new Set())}
            onDelete={() => setBulkConfirm(true)}
            busy={busy}
            label='competitor'
          />
        )}

        {items === null ? (
          <LoadingGrid />
        ) : items.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : matchCount === 0 ? (
          <div className='mt-10 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center text-[13px] text-muted-foreground'>
            No competitors match these filters.
          </div>
        ) : view === 'grid' ? (
          <div className='mt-7 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {visibleItems.map((c) => (
              <CompetitorCard
                key={c.id}
                competitor={c}
                levelsCfg={levelsCfg}
                onCapture={() => void handleCapture(c)}
                onEdit={() => setEditing(c)}
                onDelete={() => handleDelete(c)}
                capturing={capturing.has(c.id)}
                selectMode={selectMode}
                selected={selected.has(c.id)}
                onToggleSelect={() => toggleSelected(c.id)}
              />
            ))}
          </div>
        ) : (
          <CompetitorTable
            competitors={visibleItems}
            levelsCfg={levelsCfg}
            capturing={capturing}
            onCapture={(c) => void handleCapture(c)}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => handleDelete(c)}
            selectMode={selectMode}
            selected={selected}
            onToggleSelect={toggleSelected}
          />
        )}

        {items && items.length > 0 && matchCount > 0 && (
          <PaginationBar
            page={currentPage}
            pageSize={pageSize}
            total={matchCount}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}

        {/* Footnote on capture mechanics */}
        {items && items.length > 0 && (
          <p className='mt-8 text-[12px] leading-relaxed text-muted-foreground'>
            <span className='font-mono text-[var(--anubis-gold)]'>Tip:</span>{' '}
            Refresh runs the research-crawler against Chrome. If a capture says
            "not authenticated", open Chrome with the <code className='font-mono text-foreground/80'>login</code>{' '}
            profile and sign in once via{' '}
            <code className='font-mono text-foreground/80'>POST /research-crawler/chrome/open</code>.
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

      <EditCompetitorDialog
        competitor={editing}
        onClose={() => setEditing(null)}
        onSave={(competitor, patch) => void handleUpdate(competitor, patch)}
      />

      <FindCompetitorsDialog
        open={findOpen}
        onClose={() => setFindOpen(false)}
        onComplete={async (added) => {
          setFindOpen(false)
          await refresh()
          setBanner({
            kind: 'success',
            message:
              added === 0
                ? 'Selected candidates were already tracked — nothing new added.'
                : `Added ${added} new competitor${added === 1 ? '' : 's'} from discovery.`,
          })
        }}
      />

      <BulkDeleteDialog
        open={bulkConfirm}
        count={selected.size}
        label='competitor'
        onCancel={() => setBulkConfirm(false)}
        onConfirm={() => void handleBulkDelete()}
      />
    </div>
  )
}

/* ---------- Bulk-select shared bits ---------- */

function BulkSelectBar({
  count,
  total,
  onSelectAll,
  onClear,
  onDelete,
  busy,
  label,
}: {
  count: number
  total: number
  onSelectAll: () => void
  onClear: () => void
  onDelete: () => void
  busy: boolean
  label: string
}) {
  const allSelected = count > 0 && count === total
  return (
    <div className='mt-5 flex flex-wrap items-center gap-2 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_6%,transparent)] px-3.5 py-2.5'>
      <span className='text-[13px] font-medium text-foreground'>
        <span className='tabular-nums'>{count}</span> selected
        <span className='ml-1 text-muted-foreground'>of {total}</span>
      </span>
      <div className='ml-auto flex flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={allSelected ? onClear : onSelectAll}
          disabled={busy}
          className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
        <button
          type='button'
          onClick={onClear}
          disabled={busy || count === 0}
          className='inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40'
        >
          Clear
        </button>
        <button
          type='button'
          onClick={onDelete}
          disabled={busy || count === 0}
          className='inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-[12.5px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50'
        >
          <Trash2Icon className='size-[13px]' strokeWidth={2.2} />
          Delete {count > 0 ? `${count} ${label}${count === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </div>
  )
}

function BulkDeleteDialog({
  open,
  count,
  label,
  onCancel,
  onConfirm,
}: {
  open: boolean
  count: number
  label: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className='max-w-md bg-card p-0'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle>Delete {count} {label}{count === 1 ? '' : 's'}?</DialogTitle>
          <DialogDescription>
            This removes the selected {label}{count === 1 ? '' : 's'} permanently. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className='border-t border-border px-6 py-3'>
          <button
            type='button'
            onClick={onCancel}
            className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={onConfirm}
            className='inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-4 text-[13.5px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90'
          >
            <Trash2Icon className='size-[14px]' strokeWidth={2.2} />
            Delete {count}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Card ---------- */

function CompetitorCard({
  competitor,
  levelsCfg,
  onCapture,
  onEdit,
  onDelete,
  capturing,
  selectMode,
  selected,
  onToggleSelect,
}: {
  competitor: CompetitorSummary
  levelsCfg: CompetitorLevelsConfig
  onCapture: () => void
  onEdit: () => void
  onDelete: () => void
  capturing: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
}) {
  const tint = competitor.tint ?? '#565B63'
  const followersLabel = formatBigNumber(competitor.followers)
  const avgLikesLabel = formatBigNumber(competitor.avgLikes)
  const level = resolveLevel(competitor.followers, competitor.level, levelsCfg)
  const levelTooltip = levelTip(competitor.followers, competitor.level, levelsCfg)

  return (
    <article
      role={selectMode ? 'button' : undefined}
      aria-pressed={selectMode ? selected : undefined}
      onClick={selectMode ? onToggleSelect : undefined}
      title={levelTooltip}
      style={{ background: levelTint(level, 'card') }}
      className={cn(
        'group relative flex flex-col gap-3 overflow-hidden rounded-md border border-border bg-card transition-colors',
        selectMode
          ? selected
            ? 'cursor-pointer border-[var(--anubis-gold)] ring-1 ring-[var(--anubis-gold)]'
            : 'cursor-pointer hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'
          : 'hover:border-[color-mix(in_oklab,var(--anubis-gold)_28%,var(--border))]',
      )}
    >
      {selectMode && (
        <span
          aria-hidden
          className={cn(
            'absolute left-2 top-2 z-[1] flex size-5 items-center justify-center rounded border transition-colors',
            selected
              ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
              : 'border-border bg-card text-transparent',
          )}
        >
          <CheckIcon className='size-3.5' strokeWidth={3} />
        </span>
      )}
      <div className='flex items-start gap-3 p-4'>
        <span
          aria-hidden
          className='relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border'
          style={{ background: tint }}
        >
          <UserRoundIcon className='size-5 text-white/80' strokeWidth={1.5} />
        </span>
        <div className='min-w-0 flex-1'>
          <h3 className='flex items-center gap-1.5 truncate font-mono text-[13.5px] font-semibold text-foreground'>
            {competitor.handle}
          </h3>
          {competitor.displayName && (
            <p className='truncate text-[12.5px] text-muted-foreground'>
              {competitor.displayName}
            </p>
          )}
          {competitor.bio && (
            <p className='mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground'>
              {competitor.bio}
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

      <div className='flex items-center justify-between gap-2 border-t border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground'>
        <span className='min-w-0 truncate'>
          {capturing
            ? 'Capturing…'
            : competitor.lastRefreshedAt
              ? `Refreshed ${relativeTime(competitor.lastRefreshedAt)}`
              : 'Never refreshed'}
        </span>
        <div className='flex shrink-0 items-center gap-1'>
          <button
            type='button'
            onClick={(e) => { e.stopPropagation(); onCapture() }}
            disabled={capturing || selectMode}
            aria-label={`Refresh ${competitor.handle}`}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed',
              capturing
                ? 'text-[var(--anubis-gold)] opacity-80'
                : 'text-foreground hover:bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] hover:text-[var(--anubis-gold)]',
            )}
          >
            <DownloadCloudIcon
              className={cn(
                'size-3.5',
                capturing && 'animate-pulse',
              )}
              strokeWidth={2}
            />
            {capturing ? 'Capturing' : 'Refresh'}
          </button>
          <button
            type='button'
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            disabled={capturing || selectMode}
            aria-label={`Edit ${competitor.handle}`}
            className='inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            <Edit3Icon className='size-3.5' strokeWidth={2} />
            Edit
          </button>
          <button
            type='button'
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            disabled={capturing || selectMode}
            aria-label={`Stop tracking ${competitor.handle}`}
            className='inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive disabled:opacity-50'
          >
            <Trash2Icon className='size-3.5' strokeWidth={2} />
            Remove
          </button>
        </div>
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

/* ---------- Table ---------- */

const tableActionBtn =
  'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'

function CompetitorTable({
  competitors,
  levelsCfg,
  capturing,
  onCapture,
  onEdit,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
}: {
  competitors: CompetitorSummary[]
  levelsCfg: CompetitorLevelsConfig
  capturing: Set<string>
  onCapture: (c: CompetitorSummary) => void
  onEdit: (c: CompetitorSummary) => void
  onDelete: (c: CompetitorSummary) => void
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
}) {
  return (
    <div className='mt-7 overflow-hidden rounded-md border border-border bg-card'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[820px] border-collapse text-left text-[13px]'>
          <thead className='border-b border-border bg-background/50 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
            <tr>
              {selectMode && <th className='w-8 px-3 py-2.5 font-medium' />}
              <th className='px-3 py-2.5 font-medium'>Competitor</th>
              <th className='px-3 py-2.5 font-medium'>Niche</th>
              <th className='px-3 py-2.5 text-right font-medium'>Followers</th>
              <th className='px-3 py-2.5 text-right font-medium'>Avg likes</th>
              <th className='px-3 py-2.5 text-right font-medium'>Posts</th>
              <th className='px-3 py-2.5 font-medium'>Last refresh</th>
              <th className='px-3 py-2.5 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {competitors.map((c) => {
              const isSelected = selected.has(c.id)
              const isCapturing = capturing.has(c.id)
              const level = resolveLevel(c.followers, c.level, levelsCfg)
              return (
                <tr
                  key={c.id}
                  onClick={selectMode ? () => onToggleSelect(c.id) : undefined}
                  title={levelTip(c.followers, c.level, levelsCfg)}
                  style={{
                    background: isSelected
                      ? 'color-mix(in oklab, var(--anubis-gold) 8%, transparent)'
                      : levelTint(level, 'row'),
                  }}
                  className={cn(
                    'border-b border-border/70 last:border-0',
                    selectMode && 'cursor-pointer',
                  )}
                >
                  {selectMode && (
                    <td className='px-3 py-3'>
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 items-center justify-center rounded border transition-colors',
                          isSelected
                            ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
                            : 'border-border bg-card text-transparent',
                        )}
                      >
                        <CheckIcon className='size-3' strokeWidth={3} />
                      </span>
                    </td>
                  )}
                  <td className='px-3 py-3'>
                    <div className='flex items-center gap-2.5'>
                      <span
                        aria-hidden
                        className='flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border'
                        style={{ background: c.tint ?? '#565B63' }}
                      >
                        <UserRoundIcon className='size-4 text-white/80' strokeWidth={1.5} />
                      </span>
                      <div className='min-w-0'>
                        <div className='truncate font-mono text-[12px] font-semibold text-foreground'>{c.handle}</div>
                        {c.displayName && (
                          <div className='truncate text-[11px] text-muted-foreground'>{c.displayName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className='px-3 py-3 text-muted-foreground'>{c.niche ?? '—'}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.followers)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.avgLikes)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{c.postCount.toLocaleString()}</td>
                  <td className='px-3 py-3 font-mono text-[11.5px] text-muted-foreground'>
                    {isCapturing ? 'Capturing…' : c.lastRefreshedAt ? relativeTime(c.lastRefreshedAt) : 'Never'}
                  </td>
                  <td className='px-3 py-3' onClick={(e) => e.stopPropagation()}>
                    <div className='flex justify-end gap-1'>
                      <button
                        type='button'
                        onClick={() => onCapture(c)}
                        disabled={isCapturing || selectMode}
                        aria-label={`Refresh ${c.handle}`}
                        className={cn(tableActionBtn, isCapturing && 'text-[var(--anubis-gold)]')}
                      >
                        <DownloadCloudIcon className={cn('size-3.5', isCapturing && 'animate-pulse')} strokeWidth={2} />
                      </button>
                      <button
                        type='button'
                        onClick={() => onEdit(c)}
                        disabled={isCapturing || selectMode}
                        aria-label={`Edit ${c.handle}`}
                        className={tableActionBtn}
                      >
                        <Edit3Icon className='size-3.5' strokeWidth={2} />
                      </button>
                      <button
                        type='button'
                        onClick={() => onDelete(c)}
                        disabled={isCapturing || selectMode}
                        aria-label={`Stop tracking ${c.handle}`}
                        className={cn(tableActionBtn, 'hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive')}
                      >
                        <Trash2Icon className='size-3.5' strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
  const { activeProject } = useProject()
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
        projectId: activeProject?.id,
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

function EditCompetitorDialog({
  competitor,
  onClose,
  onSave,
}: {
  competitor: CompetitorSummary | null
  onClose: () => void
  onSave: (
    competitor: CompetitorSummary,
    patch: {
      displayName?: string
      niche?: string
      tint?: string
      followers?: number
      avgLikes?: number
      notes?: string
      bio?: string
      level?: CompetitorLevelOverride | null
    },
  ) => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [niche, setNiche] = useState('')
  const [tint, setTint] = useState('#565B63')
  const [followers, setFollowers] = useState('')
  const [avgLikes, setAvgLikes] = useState('')
  const [notes, setNotes] = useState('')
  const [bio, setBio] = useState('')
  const [level, setLevel] = useState<CompetitorLevelOverride | ''>('')

  useEffect(() => {
    if (!competitor) return
    setDisplayName(competitor.displayName ?? '')
    setNiche(competitor.niche ?? '')
    setTint(competitor.tint ?? '#565B63')
    setFollowers(competitor.followers === undefined ? '' : String(competitor.followers))
    setAvgLikes(competitor.avgLikes === undefined ? '' : String(competitor.avgLikes))
    setNotes(competitor.notes ?? '')
    setBio(competitor.bio ?? '')
    setLevel(competitor.level ?? '')
  }, [competitor])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!competitor) return
    onSave(competitor, {
      displayName: displayName.trim() || undefined,
      niche: niche.trim() || undefined,
      tint,
      followers: parseOptionalInt(followers),
      avgLikes: parseOptionalInt(avgLikes),
      notes: notes.trim() || undefined,
      bio: bio.trim() || undefined,
      level: level === '' ? null : level,
    })
  }

  return (
    <Dialog open={!!competitor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-md bg-card p-0'>
        <form onSubmit={submit}>
          <DialogHeader className='border-b border-border px-6 py-4'>
            <DialogTitle>Edit competitor</DialogTitle>
            <DialogDescription>
              Tune the profile metadata shown across Competitors and Content.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-4 px-6 py-5'>
            <Field label='Display name' htmlFor='edit-c-name'>
              <input
                id='edit-c-name'
                type='text'
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={textInput}
              />
            </Field>

            <div className='grid grid-cols-[1fr_auto] gap-3'>
              <Field label='Niche' htmlFor='edit-c-niche'>
                <input
                  id='edit-c-niche'
                  type='text'
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  className={textInput}
                />
              </Field>
              <Field label='Tint' htmlFor='edit-c-tint'>
                <input
                  id='edit-c-tint'
                  type='color'
                  value={tint}
                  onChange={(e) => setTint(e.target.value)}
                  className='h-10 w-12 rounded-md border border-border bg-background p-1'
                />
              </Field>
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <Field label='Followers' htmlFor='edit-c-followers'>
                <input
                  id='edit-c-followers'
                  type='number'
                  min={0}
                  value={followers}
                  onChange={(e) => setFollowers(e.target.value)}
                  className={textInput}
                />
              </Field>
              <Field label='Avg likes' htmlFor='edit-c-avg-likes'>
                <input
                  id='edit-c-avg-likes'
                  type='number'
                  min={0}
                  value={avgLikes}
                  onChange={(e) => setAvgLikes(e.target.value)}
                  className={textInput}
                />
              </Field>
            </div>

            <Field label='Level' htmlFor='edit-c-level' hint='Overrides the followers-based level. Auto = derive from followers.'>
              <select
                id='edit-c-level'
                value={level}
                onChange={(e) => setLevel(e.target.value as CompetitorLevelOverride | '')}
                className={textInput}
              >
                <option value=''>Auto (from followers)</option>
                <option value='black'>Black</option>
                <option value='green'>Green</option>
                <option value='yellow'>Yellow</option>
                <option value='red'>Red</option>
              </select>
            </Field>

            <Field label='Bio' htmlFor='edit-c-bio' hint='Auto-filled from Instagram on capture; edit to override.'>
              <textarea
                id='edit-c-bio'
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className={`${textInput} h-auto resize-none py-2 leading-relaxed`}
              />
            </Field>

            <Field label='Notes' htmlFor='edit-c-notes'>
              <textarea
                id='edit-c-notes'
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className={`${textInput} h-auto resize-none py-2 leading-relaxed`}
              />
            </Field>
          </div>

          <DialogFooter className='border-t border-border px-6 py-3'>
            <button
              type='button'
              onClick={onClose}
              className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              Cancel
            </button>
            <button
              type='submit'
              className='inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-4 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)]'
            >
              Save changes
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Helpers ---------- */

function competitorKey(competitor: Pick<CompetitorSummary, 'handle'>): string {
  return competitor.handle.trim().replace(/^@/, '').toLowerCase()
}

function dedupeCompetitors(items: CompetitorSummary[]): CompetitorSummary[] {
  const seen = new Set<string>()
  const out: CompetitorSummary[] = []
  for (const item of items) {
    const key = competitorKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

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

function parseOptionalInt(value: string): number | undefined {
  if (!value.trim()) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined
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
