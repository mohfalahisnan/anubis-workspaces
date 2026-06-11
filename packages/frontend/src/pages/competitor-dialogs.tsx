import { useEffect, useState } from 'react'
import { ArrowDownToLineIcon } from 'lucide-react'

import type { CompetitorLevel, CompetitorSummary } from '@anubis/shared'

import { listCompetitors } from '@/api'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { LEVEL_COLOR, resolveLevel } from '@/lib/competitor-level'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import {
  Checkbox,
  Field,
  LevelBadge,
  LEVEL_LABEL,
  ListSkeleton,
  RunOptionsPanel,
  relativeTime,
  textInput,
  usernameKey,
  type CaptureRunOptions,
  type RunMode,
} from './competitor-actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type { CaptureRunOptions, RunMode } from './competitor-actions'

/* ===========================================================
   Capture selection (preview flow)
   ===========================================================
   Lets the user pick which tracked competitors to *preview*
   capture posts from on the Content page, before importing
   chosen posts into the content library. The full background
   capture-to-database flow lives on the dedicated Capture Posts
   page (`pages/capture-posts.tsx`); this dialog is only the
   preview entry point retained by Content.
   =========================================================== */

/** Filter selection: a concrete level, or 'all' (every non-black). */
type LevelFilter = 'all' | CompetitorLevel

/** Levels offered as filter chips, in tier order. */
const LEVEL_FILTERS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red', label: 'Red' },
  { value: 'black', label: 'Black' },
]

export function CaptureSelectionDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (selected: CompetitorSummary[], options: CaptureRunOptions) => void
}) {
  const [items, setItems] = useState<CompetitorSummary[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  // Default: anonymous + headless (current fast-default behaviour).
  // Toggle to 'login' if you want authenticated captures.
  const [runMode, setRunMode] = useState<RunMode>('public')
  const [headless, setHeadless] = useState(true)
  const [targetPostsPerProfile, setTargetPostsPerProfile] = useState(12)

  const { activeProject } = useProject()
  const { config: levelsConfig } = useCompetitorLevels()

  useEffect(() => {
    if (!open) return
    let active = true
    setItems(null)
    setSelected(new Set())
    setError(null)
    setLevelFilter('all')
    setRunMode('public')
    setHeadless(true)
    setTargetPostsPerProfile(12)
    listCompetitors(activeProject?.id)
      .then((rows) => {
        if (!active) return
        const uniqueRows = dedupeCompetitors(rows)
        setItems(uniqueRows)
        // Default selection: previously-refreshed competitors only,
        // so the most common use ("update what I've already pulled")
        // is one click after opening.
        const seed = new Set<string>()
        for (const row of uniqueRows) {
          if (row.lastRefreshedAt) seed.add(row.id)
        }
        setSelected(seed)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load competitors.')
      })
    return () => {
      active = false
    }
  }, [open, activeProject?.id])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const levelOf = (c: CompetitorSummary): CompetitorLevel =>
    resolveLevel(c.followers, c.level, levelsConfig)

  const visibleItems = (items ?? []).filter(
    (c) => levelFilter === 'all' || levelOf(c) === levelFilter,
  )

  function selectAll() {
    setSelected(new Set(visibleItems.map((c) => c.id)))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  /** Add every tracked competitor at `level` to the selection. */
  function selectByLevel(level: CompetitorLevel) {
    if (!items) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of items) {
        if (levelOf(c) === level) next.add(c.id)
      }
      return next
    })
  }

  const count = selected.size

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-md bg-card p-0'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle>Capture posts</DialogTitle>
          <DialogDescription>
            Pick which tracked competitors to crawl. The capture runs
            sequentially so you can watch progress per handle.
          </DialogDescription>
        </DialogHeader>

        <div className='max-h-[min(60vh,420px)] overflow-y-auto px-2 py-2'>
          {error && (
            <p className='m-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12.5px] text-destructive'>
              {error}
            </p>
          )}
          {items === null ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <p className='m-4 text-[13px] text-muted-foreground'>
              No competitors tracked yet. Close this dialog and add some first.
            </p>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-1.5 px-3 pb-1.5 pt-2'>
                <span className='mr-1 text-[11px] text-muted-foreground'>Level</span>
                {LEVEL_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type='button'
                    onClick={() => setLevelFilter(filter.value)}
                    className={cn(
                      'inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors',
                      levelFilter === filter.value
                        ? 'border-[color-mix(in_oklab,var(--anubis-gold)_58%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className='flex flex-wrap items-center gap-2 px-3 pb-1 text-[12px]'>
                <span className='mr-1 text-[11px] text-muted-foreground'>Quick select</span>
                {(['green', 'yellow', 'red'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type='button'
                    onClick={() => selectByLevel(lvl)}
                    className='inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    <span aria-hidden className='size-2 rounded-full' style={{ background: LEVEL_COLOR[lvl] }} />
                    All {LEVEL_LABEL[lvl]}
                  </button>
                ))}
              </div>
              <div className='flex items-center justify-between px-3 pb-1 pt-1'>
                <span className='font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground'>
                  {count} of {visibleItems.length} selected
                </span>
                <div className='flex items-center gap-2 text-[12px]'>
                  <button
                    type='button'
                    onClick={selectAll}
                    className='text-[var(--anubis-gold)] hover:underline'
                  >
                    Select all
                  </button>
                  <span className='text-muted-foreground'>·</span>
                  <button
                    type='button'
                    onClick={deselectAll}
                    className='text-muted-foreground hover:text-foreground hover:underline'
                  >
                    Clear
                  </button>
                </div>
              </div>
              {visibleItems.length === 0 ? (
                <p className='m-4 text-[13px] text-muted-foreground'>
                  No tracked competitors match this level.
                </p>
              ) : (
                <ul className='py-1'>
                  {visibleItems.map((c) => {
                    const isSelected = selected.has(c.id)
                    const level = levelOf(c)
                    return (
                      <li key={c.id}>
                        <button
                          type='button'
                          onClick={() => toggle(c.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                            isSelected
                              ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)]'
                              : 'hover:bg-muted',
                          )}
                        >
                          <Checkbox checked={isSelected} />
                          <span
                            aria-hidden
                            className='flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white/85'
                            style={{ background: c.tint ?? '#565B63' }}
                          >
                            {c.handle.replace('@', '').slice(0, 1).toUpperCase()}
                          </span>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate font-mono text-[12.5px] text-foreground'>
                                {c.handle}
                              </span>
                              <LevelBadge level={level} />
                            </div>
                            <div className='truncate text-[11.5px] text-muted-foreground'>
                              {c.lastRefreshedAt
                                ? `Last refreshed ${relativeTime(c.lastRefreshedAt)}`
                                : 'Never refreshed'}
                              {c.niche ? ` · ${c.niche}` : ''}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <div className='border-t border-border px-6 py-4'>
          <div className='flex flex-col gap-4'>
            <Field
              label='Target posts per profile'
              htmlFor='capture-target-posts'
              hint='Candidates are shown for review before anything is saved.'
            >
              <input
                id='capture-target-posts'
                type='number'
                min={1}
                max={120}
                value={targetPostsPerProfile}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setTargetPostsPerProfile(
                    Number.isFinite(n) ? Math.min(120, Math.max(1, Math.floor(n))) : 12,
                  )
                }}
                className={textInput}
              />
            </Field>
            <RunOptionsPanel
              profile={runMode}
              headless={headless}
              onProfileChange={(p) => {
                setRunMode(p)
                // Sensible default: login -> window opens; public -> headless.
                setHeadless(p === 'public')
              }}
              onHeadlessChange={setHeadless}
              allowProfilePick
            />
          </div>
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
            type='button'
            disabled={count === 0}
            onClick={() => {
              if (!items) return
              const picked = items.filter((c) => selected.has(c.id))
              onConfirm(picked, {
                profile: runMode,
                headless,
                forceHeadless: runMode === 'login' && headless,
                targetPostsPerProfile,
              })
            }}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
              count === 0
                ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
            )}
          >
            <ArrowDownToLineIcon className='size-[15px]' strokeWidth={2.2} />
            Capture {count > 0 ? count : ''}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function dedupeCompetitors(items: CompetitorSummary[]): CompetitorSummary[] {
  const seen = new Set<string>()
  const out: CompetitorSummary[] = []
  for (const item of items) {
    const key = usernameKey(item.handle)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
