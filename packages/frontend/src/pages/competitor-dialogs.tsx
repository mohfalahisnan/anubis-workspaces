import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownToLineIcon,
  ChevronDownIcon,
  CompassIcon,
  HashIcon,
  PlusIcon,
  SearchIcon,
  UserRoundIcon,
} from 'lucide-react'

import type {
  CompetitorSummary,
  DiscoverCompetitorsInput,
  DiscoveredCandidate,
  DiscoverySource,
} from '@anubis/shared'

import {
  createCompetitor,
  discoverCompetitors,
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

/* ===========================================================
   Capture selection
   ===========================================================
   Lets the user pick which tracked competitors to capture
   posts from, instead of running the crawler against every
   tracked handle by default. "Select all" / "Deselect all"
   shortcuts cover the common cases.
   =========================================================== */

export type RunMode = 'login' | 'public'

export interface CaptureRunOptions {
  /** Which Chrome profile dir/port to use. */
  profile: RunMode
  /** Whether to launch Chrome headless. */
  headless: boolean
  /** Required only when profile=login and headless=true. */
  forceHeadless: boolean
}

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
  // Default: anonymous + headless (current fast-default behaviour).
  // Toggle to 'login' if you want authenticated captures.
  const [runMode, setRunMode] = useState<RunMode>('public')
  const [headless, setHeadless] = useState(true)

  useEffect(() => {
    if (!open) return
    let active = true
    setItems(null)
    setSelected(new Set())
    setError(null)
    setRunMode('public')
    setHeadless(true)
    listCompetitors()
      .then((rows) => {
        if (!active) return
        setItems(rows)
        // Default selection: previously-refreshed competitors only,
        // so the most common use ("update what I've already pulled")
        // is one click after opening.
        const seed = new Set<string>()
        for (const row of rows) {
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
  }, [open])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (!items) return
    setSelected(new Set(items.map((c) => c.id)))
  }

  function deselectAll() {
    setSelected(new Set())
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
              <div className='flex items-center justify-between px-3 pb-1 pt-2'>
                <span className='font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground'>
                  {count} of {items.length} selected
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
              <ul className='py-1'>
                {items.map((c) => {
                  const isSelected = selected.has(c.id)
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
                          <div className='truncate font-mono text-[12.5px] text-foreground'>
                            {c.handle}
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
            </>
          )}
        </div>

        <div className='border-t border-border px-6 py-4'>
          <RunOptionsPanel
            profile={runMode}
            headless={headless}
            onProfileChange={(p) => {
              setRunMode(p)
              // Sensible default: login → window opens; public → headless.
              setHeadless(p === 'public')
            }}
            onHeadlessChange={setHeadless}
            allowProfilePick
          />
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

/* ===========================================================
   Find competitors (discovery)
   ===========================================================
   Two-stage dialog: form → results.
     1. User picks source (explore/hashtag/keyword), provides the
        relevant input, and sets a target profile count.
     2. We call the research-crawler discovery flow, render the
        candidate list with checkboxes, and add the selected
        handles to the tracked competitor list on confirm.
   =========================================================== */

interface DiscoveryFormState {
  source: DiscoverySource
  hashtag: string
  keyword: string
  target: number
  /**
   * When true the crawler launches Chrome headless. Discovery is
   * pinned to the 'login' profile (because IG's explore / hashtag /
   * keyword pages need an authenticated session to be useful), so
   * a headless run requires forceHeadless behind the scenes.
   */
  headless: boolean
}

const DEFAULT_FORM: DiscoveryFormState = {
  source: 'explore',
  hashtag: '',
  keyword: '',
  target: 10,
  // Default: open a Chrome window. The window doubles as a "the
  // crawler is doing something" affordance and lets the user spot
  // CAPTCHAs / rate limits if they hit.
  headless: false,
}

export function FindCompetitorsDialog({
  open,
  onClose,
  onComplete,
}: {
  open: boolean
  onClose: () => void
  onComplete: (added: number) => void
}) {
  const [form, setForm] = useState<DiscoveryFormState>(DEFAULT_FORM)
  const [stage, setStage] = useState<'form' | 'running' | 'results'>('form')
  const [candidates, setCandidates] = useState<DiscoveredCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [addingErrors, setAddingErrors] = useState<string[]>([])

  useEffect(() => {
    if (!open) {
      setForm(DEFAULT_FORM)
      setStage('form')
      setCandidates([])
      setSelected(new Set())
      setError(null)
      setAddingErrors([])
    }
  }, [open])

  const canSubmit = useMemo(() => {
    if (form.source === 'hashtag') return form.hashtag.trim().length > 0
    if (form.source === 'keyword') return form.keyword.trim().length > 0
    return true
  }, [form])

  async function handleDiscover(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setStage('running')
    setError(null)
    try {
      const input: DiscoverCompetitorsInput = {
        source: form.source,
        targetCompetitors: form.target,
        timeoutMs: 120_000,
        // Discovery is always run against the 'login' profile —
        // IG's explore / hashtag / keyword pages don't return
        // useful candidates without an authenticated session.
        profile: 'login',
        headless: form.headless,
        forceHeadless: form.headless,
      }
      if (form.source === 'hashtag') input.hashtag = form.hashtag.trim().replace(/^#/, '')
      if (form.source === 'keyword') input.keyword = form.keyword.trim()
      const found = await discoverCompetitors(input)
      // Dedupe by username (the crawler sometimes returns the same
      // handle twice when it surfaces them through different paths).
      const uniq = new Map<string, DiscoveredCandidate>()
      for (const candidate of found) uniq.set(candidate.username, candidate)
      const list = [...uniq.values()]
      setCandidates(list)
      setSelected(new Set(list.map((c) => c.username)))
      setStage('results')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Discovery failed.')
      setStage('form')
    }
  }

  async function handleAdd() {
    const picked = candidates.filter((c) => selected.has(c.username))
    const errors: string[] = []
    let added = 0
    for (const candidate of picked) {
      try {
        await createCompetitor({
          handle: candidate.username,
          displayName: candidate.fullName?.trim() || undefined,
        })
        added++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Already-tracked is the common skip — silent if every error
        // is that, surface anything else.
        if (!/already/i.test(msg)) {
          errors.push(`@${candidate.username}: ${msg}`)
        }
      }
    }
    if (errors.length > 0) {
      setAddingErrors(errors)
    } else {
      onComplete(added)
    }
  }

  function toggle(username: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username)
      else next.add(username)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(candidates.map((c) => c.username)))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-lg bg-card p-0'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle>
            {stage === 'results' ? 'Pick competitors to track' : 'Find competitors'}
          </DialogTitle>
          <DialogDescription>
            {stage === 'results'
              ? `Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}.
                 Already-tracked handles will be skipped automatically.`
              : 'Use the research-crawler to surface adjacent Instagram profiles.'}
          </DialogDescription>
        </DialogHeader>

        {stage === 'form' && (
          <form onSubmit={handleDiscover}>
            <div className='flex flex-col gap-5 px-6 py-5'>
              <Field label='Source' hint='Where the crawler looks for candidates.'>
                <SourceSegmented
                  value={form.source}
                  onChange={(source) => setForm((f) => ({ ...f, source }))}
                />
              </Field>

              {form.source === 'hashtag' && (
                <Field
                  label='Hashtag'
                  htmlFor='d-hashtag'
                  hint='Without the #. Example: productivity.'
                >
                  <input
                    id='d-hashtag'
                    type='text'
                    value={form.hashtag}
                    onChange={(e) => setForm((f) => ({ ...f, hashtag: e.target.value }))}
                    placeholder='productivity'
                    autoFocus
                    className={textInput}
                  />
                </Field>
              )}

              {form.source === 'keyword' && (
                <Field
                  label='Search keyword'
                  htmlFor='d-keyword'
                  hint='What you would type into IG search.'
                >
                  <input
                    id='d-keyword'
                    type='text'
                    value={form.keyword}
                    onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                    placeholder='content strategist'
                    autoFocus
                    className={textInput}
                  />
                </Field>
              )}

              <Field
                label='Target profile count'
                htmlFor='d-target'
                hint='How many candidates to surface (1–50).'
              >
                <input
                  id='d-target'
                  type='number'
                  min={1}
                  max={50}
                  value={form.target}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setForm((f) => ({
                      ...f,
                      target: Number.isFinite(n) ? Math.min(50, Math.max(1, Math.floor(n))) : f.target,
                    }))
                  }}
                  className={textInput}
                />
              </Field>

              <RunOptionsPanel
                profile='login'
                headless={form.headless}
                onProfileChange={() => undefined}
                onHeadlessChange={(headless) => setForm((f) => ({ ...f, headless }))}
                pinnedNote='Discovery always uses your logged-in Chrome profile so explore / hashtag / keyword pages return real candidates.'
              />

              {error && (
                <p className='rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12.5px] text-destructive'>
                  {error}
                </p>
              )}
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
                disabled={!canSubmit}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                  !canSubmit
                    ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                    : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
                )}
              >
                <SearchIcon className='size-[15px]' strokeWidth={2} />
                Discover
              </button>
            </DialogFooter>
          </form>
        )}

        {stage === 'running' && (
          <div className='flex flex-col items-center gap-3 px-6 py-12'>
            <div className='size-2 animate-[anubisPulse_1.7s_ease-out_infinite] rounded-full bg-[var(--anubis-gold-hi)]' />
            <p className='font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground'>
              Discovering candidates…
            </p>
            <p className='max-w-xs text-center text-[12px] text-muted-foreground'>
              This usually takes 15–60 seconds depending on the source.
            </p>
          </div>
        )}

        {stage === 'results' && (
          <>
            <div className='max-h-[min(50vh,360px)] overflow-y-auto px-2 py-2'>
              {candidates.length === 0 ? (
                <p className='m-4 text-[13px] text-muted-foreground'>
                  Nothing came back. Try a different source or hashtag.
                </p>
              ) : (
                <>
                  <div className='flex items-center justify-between px-3 pb-1 pt-2'>
                    <span className='font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground'>
                      {selected.size} of {candidates.length} selected
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
                  <ul className='py-1'>
                    {candidates.map((candidate) => (
                      <li key={candidate.username}>
                        <button
                          type='button'
                          onClick={() => toggle(candidate.username)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                            selected.has(candidate.username)
                              ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)]'
                              : 'hover:bg-muted',
                          )}
                        >
                          <Checkbox checked={selected.has(candidate.username)} />
                          <span
                            aria-hidden
                            className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
                          >
                            <UserRoundIcon className='size-4' strokeWidth={1.5} />
                          </span>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate font-mono text-[12.5px] text-foreground'>
                                @{candidate.username}
                              </span>
                              {candidate.followers !== undefined && (
                                <span className='shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums'>
                                  {formatBigNumber(candidate.followers)} followers
                                </span>
                              )}
                            </div>
                            {candidate.fullName && (
                              <div className='truncate text-[11.5px] text-foreground/80'>
                                {candidate.fullName}
                              </div>
                            )}
                            {candidate.bio && (
                              <div className='line-clamp-1 text-[11.5px] text-muted-foreground'>
                                {candidate.bio}
                              </div>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {addingErrors.length > 0 && (
                <div className='m-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12px] text-destructive'>
                  <p className='mb-1 font-medium'>Some additions failed:</p>
                  <ul className='list-disc pl-5'>
                    {addingErrors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {addingErrors.length > 5 && (
                      <li className='list-none italic'>
                        …and {addingErrors.length - 5} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter className='border-t border-border px-6 py-3'>
              <button
                type='button'
                onClick={() => setStage('form')}
                className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                Back
              </button>
              <button
                type='button'
                disabled={selected.size === 0}
                onClick={() => void handleAdd()}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                  selected.size === 0
                    ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                    : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
                )}
              >
                <PlusIcon className='size-[15px]' strokeWidth={2.4} />
                Add {selected.size > 0 ? selected.size : ''}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------- shared bits ---------- */

/**
 * Run options block — exposes the two knobs the user actually
 * cares about for any crawler call:
 *  - Profile (which Chrome dir to use, i.e. signed in vs anonymous)
 *  - Headless (window vs background)
 *
 * Used by both dialogs. The discovery dialog passes
 * `allowProfilePick={false}` (defaulted) + a `pinnedNote` so the
 * fixed-login choice is honest rather than hidden.
 */
function RunOptionsPanel({
  profile,
  headless,
  onProfileChange,
  onHeadlessChange,
  allowProfilePick = false,
  pinnedNote,
}: {
  profile: RunMode
  headless: boolean
  onProfileChange: (p: RunMode) => void
  onHeadlessChange: (h: boolean) => void
  allowProfilePick?: boolean
  pinnedNote?: string
}) {
  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-background/50 p-3.5'>
      <div className='flex items-center justify-between gap-3'>
        <span className='font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground'>
          Run with
        </span>
        {!allowProfilePick && (
          <span className='font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--anubis-gold)]'>
            Login profile
          </span>
        )}
      </div>

      {allowProfilePick && (
        <div className='inline-flex w-fit gap-1 rounded-md border border-border bg-background p-1'>
          {(['login', 'public'] as const).map((opt) => {
            const active = opt === profile
            return (
              <button
                key={opt}
                type='button'
                onClick={() => onProfileChange(opt)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--anubis-gold)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt === 'login' ? 'Logged in' : 'Anonymous'}
              </button>
            )
          })}
        </div>
      )}

      <label className='flex cursor-pointer select-none items-center gap-2.5 text-[12.5px] text-foreground'>
        <input
          type='checkbox'
          checked={headless}
          onChange={(e) => onHeadlessChange(e.target.checked)}
          className='sr-only'
        />
        <Checkbox checked={headless} />
        <span>Run headless</span>
        <span className='text-[11.5px] text-muted-foreground'>
          (no Chrome window)
        </span>
      </label>

      {pinnedNote && (
        <p className='text-[11.5px] leading-relaxed text-muted-foreground'>
          {pinnedNote}
        </p>
      )}
    </div>
  )
}

function SourceSegmented({
  value,
  onChange,
}: {
  value: DiscoverySource
  onChange: (v: DiscoverySource) => void
}) {
  const options: { value: DiscoverySource; label: string; icon: React.ReactNode }[] = [
    { value: 'explore', label: 'Explore', icon: <CompassIcon className='size-3.5' strokeWidth={2} /> },
    { value: 'hashtag', label: 'Hashtag', icon: <HashIcon className='size-3.5' strokeWidth={2} /> },
    { value: 'keyword', label: 'Keyword', icon: <SearchIcon className='size-3.5' strokeWidth={2} /> },
  ]
  return (
    <div className='inline-flex gap-1 rounded-md border border-border bg-background p-1'>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type='button'
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3.5 text-[12.5px] font-medium transition-colors',
              active
                ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--anubis-gold)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
        checked
          ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
          : 'border-border bg-background',
      )}
    >
      {checked && (
        <svg viewBox='0 0 24 24' className='size-3' fill='none' stroke='currentColor' strokeWidth={3.5} strokeLinecap='round' strokeLinejoin='round'>
          <path d='M20 6L9 17l-5-5' />
        </svg>
      )}
    </span>
  )
}

function ListSkeleton() {
  return (
    <div className='flex flex-col gap-2 px-3 py-3'>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className='h-10 animate-pulse rounded-md border border-border bg-background/60'
        />
      ))}
    </div>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
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

const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

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

/* Suppress unused-icon lint */
void ChevronDownIcon
