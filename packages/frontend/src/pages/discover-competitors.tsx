import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeftIcon, PlusIcon, SearchIcon } from 'lucide-react'

import type {
  CompetitorLevel,
  DiscoverCompetitorsInput,
  DiscoverJobResult,
  DiscoveredCandidate,
  JobSummary,
} from '@anubis/shared'

import { createCompetitor, discoverCompetitorsAsync, listCompetitors } from '@/api'
import { useNavigation } from '@/lib/navigation'
import { useProject } from '@/lib/use-project'
import { useJobs } from '@/lib/use-jobs'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { LEVEL_COLOR } from '@/lib/competitor-level'
import {
  CompetitorLevelFilter,
  matchesLevelFilter,
  type LevelFilter,
} from '@/components/competitor-level-filter'
import {
  SearchBox,
  SortControl,
  useSorted,
  type SortOption,
  type SortState,
} from '@/components/list-controls'
import {
  Field,
  JobProgressPanel,
  RunOptionsPanel,
  SourceSegmented,
  formatBigNumber,
  textInput,
} from './competitor-actions'
import { cn } from '@/lib/utils'

/* ===========================================================
   Discover Competitors page
   ===========================================================
   Dedicated page (replacing the old modal) for the research-
   crawler discovery flow. The form enqueues a background job;
   the page then renders that job's live progress and, on
   completion, the candidate list with level filters, sorting,
   and a "track selected" action that writes to the database.

   The job lives in the shared `useJobs` store (backed by the
   backend SSE feed), so navigating away and back — with the
   job id carried in the route — restores progress and results
   without restarting or cancelling the run.
   =========================================================== */

interface DiscoveryFormState {
  source: DiscoverCompetitorsInput['source']
  hashtag: string
  keyword: string
  target: number
  /**
   * When true the crawler launches Chrome headless. Discovery is pinned to the
   * 'login' profile (IG explore / hashtag / keyword pages need an authenticated
   * session), so a headless run requires forceHeadless behind the scenes.
   */
  headless: boolean
}

const DEFAULT_FORM: DiscoveryFormState = {
  source: 'explore',
  hashtag: '',
  keyword: '',
  target: 10,
  headless: false,
}

type CandidateSortKey = 'followers' | 'username'

const CANDIDATE_SORT_OPTIONS: readonly SortOption<CandidateSortKey>[] = [
  { value: 'followers', label: 'Followers' },
  { value: 'username', label: 'Handle' },
]

const CANDIDATE_SORT_ACCESSORS: Record<CandidateSortKey, (c: DiscoveredCandidate) => unknown> = {
  followers: (c) => c.followers,
  username: (c) => c.username.replace(/^@/, '').toLowerCase(),
}

export function DiscoverCompetitorsPage({ jobId }: { jobId?: string }) {
  const { navigate } = useNavigation()
  const { activeProject } = useProject()
  const jobs = useJobs((s) => s.jobs)
  const stop = useJobs((s) => s.stop)

  const [form, setForm] = useState<DiscoveryFormState>(DEFAULT_FORM)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The job this page is currently following: the one named in the route, or
  // (when arriving without an id) the most recent discovery job for the active
  // project, so returning to the page re-attaches to a run in flight.
  const job = useMemo<JobSummary | null>(() => {
    if (jobId) return jobs.find((j) => j.id === jobId) ?? null
    return (
      jobs
        .filter(
          (j) =>
            j.kind === 'discover-competitors' &&
            (!activeProject?.id || j.projectId === activeProject.id),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    )
  }, [jobs, jobId, activeProject?.id])

  const canSubmit = useMemo(() => {
    if (form.source === 'hashtag') return form.hashtag.trim().length > 0
    if (form.source === 'keyword') return form.keyword.trim().length > 0
    return true
  }, [form])

  async function handleDiscover(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || starting) return
    setStarting(true)
    setError(null)
    try {
      const input: DiscoverCompetitorsInput & { projectId?: string } = {
        source: form.source,
        targetCompetitors: form.target,
        timeoutMs: 120_000,
        // Discovery always runs against the 'login' profile — IG's explore /
        // hashtag / keyword pages don't return useful candidates without an
        // authenticated session.
        profile: 'login',
        headless: form.headless,
        forceHeadless: form.headless,
        projectId: activeProject?.id,
      }
      if (form.source === 'hashtag') input.hashtag = form.hashtag.trim().replace(/^#/, '')
      if (form.source === 'keyword') input.keyword = form.keyword.trim()
      const { jobId: newJobId } = await discoverCompetitorsAsync(input)
      navigate({ page: 'discover-competitors', jobId: newJobId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start discovery.')
    } finally {
      setStarting(false)
    }
  }

  const running = job ? job.state === 'queued' || job.state === 'running' || job.state === 'stopping' : false

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1100px] px-7 pb-12'>
        <div className='flex flex-col gap-4 pt-7'>
          <button
            type='button'
            onClick={() => navigate({ page: 'competitors' })}
            className='inline-flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground'
          >
            <ArrowLeftIcon className='size-3.5' strokeWidth={2} />
            Back to competitors
          </button>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>
              Discover competitors
            </h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              Use the research-crawler to surface adjacent Instagram profiles. Discovery runs in the
              background — you can leave this page and come back without losing progress.
            </p>
          </div>
        </div>

        <div className='mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]'>
          {/* Form */}
          <form
            onSubmit={handleDiscover}
            className='flex h-fit flex-col gap-5 rounded-md border border-border bg-card p-5'
          >
            <Field label='Source' hint='Where the crawler looks for candidates.'>
              <SourceSegmented
                value={form.source}
                onChange={(source) => setForm((f) => ({ ...f, source }))}
              />
            </Field>

            {form.source === 'hashtag' && (
              <Field label='Hashtag' htmlFor='d-hashtag' hint='Without the #. Example: productivity.'>
                <input
                  id='d-hashtag'
                  type='text'
                  value={form.hashtag}
                  onChange={(e) => setForm((f) => ({ ...f, hashtag: e.target.value }))}
                  placeholder='productivity'
                  className={textInput}
                />
              </Field>
            )}

            {form.source === 'keyword' && (
              <Field label='Search keyword' htmlFor='d-keyword' hint='What you would type into IG search.'>
                <input
                  id='d-keyword'
                  type='text'
                  value={form.keyword}
                  onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                  placeholder='content strategist'
                  className={textInput}
                />
              </Field>
            )}

            <Field label='Target profile count' htmlFor='d-target' hint='How many candidates to surface (1–50).'>
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

            <button
              type='submit'
              disabled={!canSubmit || starting || running}
              className={cn(
                'inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                !canSubmit || starting || running
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
              )}
            >
              <SearchIcon className='size-[15px]' strokeWidth={2} />
              {running ? 'Discovery running…' : starting ? 'Starting…' : 'Discover'}
            </button>
          </form>

          {/* Progress + results */}
          <div className='flex flex-col gap-5'>
            {job ? (
              <>
                <JobProgressPanel job={job} onStop={(id) => void stop(id)} />
                <DiscoveryResults key={job.id} job={job} />
              </>
            ) : (
              <div className='flex h-full min-h-[220px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/40 px-6 py-10 text-center'>
                <SearchIcon className='size-6 text-muted-foreground' strokeWidth={1.5} />
                <p className='text-[13px] text-muted-foreground'>
                  Set up a search on the left and hit Discover. Progress and candidates appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Results ---------- */

function DiscoveryResults({ job }: { job: JobSummary }) {
  const { activeProject } = useProject()
  const { levelFor } = useCompetitorLevels()
  const result = job.result as DiscoverJobResult | undefined
  const candidates = result?.candidates ?? []

  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<CandidateSortKey>>({ key: 'followers', dir: 'desc' })
  // Out-of-range ('black') candidates are hidden by default; flip to review them.
  const [showBlack, setShowBlack] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const levelOf = (candidate: DiscoveredCandidate): CompetitorLevel =>
    levelFor(candidate.followers ?? null)

  // Seed the default selection once candidates land: pick the in-range
  // (non-black) ones so a default "track" never adds profiles the user can't
  // see. Guarded so user toggles aren't clobbered on re-render.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || candidates.length === 0) return
    seeded.current = true
    setSelected(new Set(candidates.filter((c) => levelOf(c) !== 'black').map((c) => c.username)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates])

  const filtered = useMemo(
    () =>
      candidates.filter((candidate) => {
        const level = levelOf(candidate)
        if (level === 'black' && !showBlack && levelFilter !== 'black') return false
        if (!matchesLevelFilter(level, levelFilter)) return false
        const q = query.trim().toLowerCase()
        if (!q) return true
        return [candidate.username, candidate.fullName, candidate.bio]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, levelFilter, showBlack, query, levelFor],
  )
  const visible = useSorted(filtered, sort, CANDIDATE_SORT_ACCESSORS)
  const visibleSelectedCount = visible.filter((c) => selected.has(c.username)).length

  function toggle(username: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username)
      else next.add(username)
      return next
    })
  }

  function selectVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of visible) next.add(c.username)
      return next
    })
  }

  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of visible) next.delete(c.username)
      return next
    })
  }

  async function handleAdd() {
    setAdding(true)
    setError(null)
    const picked = candidates.filter((c) => selected.has(c.username))
    let count = 0
    const tracked = new Set(
      (await listCompetitors(activeProject?.id).catch(() => [])).map((c) =>
        c.handle.replace(/^@/, '').toLowerCase(),
      ),
    )
    for (const candidate of picked) {
      const key = candidate.username.replace(/^@/, '').toLowerCase()
      if (tracked.has(key)) continue
      try {
        await createCompetitor({
          handle: candidate.username,
          displayName: candidate.fullName?.trim() || undefined,
          followers: candidate.followers,
          bio: candidate.bio?.trim() || undefined,
          projectId: activeProject?.id,
        })
        count++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!/already/i.test(msg)) setError(msg)
      }
    }
    setAdded(count)
    setAdding(false)
  }

  const running = job.state === 'queued' || job.state === 'running' || job.state === 'stopping'

  if (running && candidates.length === 0) {
    return (
      <div className='rounded-md border border-dashed border-border bg-card/40 px-6 py-8 text-center text-[13px] text-muted-foreground'>
        Crawling Instagram for candidates… results appear here the moment the run completes.
      </div>
    )
  }

  if (candidates.length === 0) {
    return (
      <div className='rounded-md border border-dashed border-border bg-card/40 px-6 py-8 text-center text-[13px] text-muted-foreground'>
        Nothing came back from this run.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-card'>
      <div className='flex flex-col gap-3 border-b border-border px-4 py-3'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-[15px] font-semibold tracking-[-0.01em]'>
            {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
          </h2>
          <label className='inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground'>
            <input
              type='checkbox'
              checked={showBlack}
              onChange={(e) => setShowBlack(e.target.checked)}
              className='size-3.5 accent-[var(--anubis-gold)]'
            />
            Show out-of-range
          </label>
        </div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
          <SortControl options={CANDIDATE_SORT_OPTIONS} value={sort} onChange={setSort} className='ml-auto' />
        </div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder='Search handle, name, bio…'
            className='w-full sm:w-[280px]'
          />
          <button
            type='button'
            onClick={visibleSelectedCount === visible.length ? clearVisible : selectVisible}
            disabled={visible.length === 0}
            className='ml-auto text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40'
          >
            {visibleSelectedCount === visible.length ? 'Clear shown' : 'Select shown'}
          </button>
        </div>
      </div>

      <div className='max-h-[min(60vh,520px)] overflow-y-auto px-3 py-2'>
        {visible.length === 0 ? (
          <p className='m-4 text-center text-[13px] text-muted-foreground'>
            No candidates match this filter.
          </p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {visible.map((candidate) => (
              <CandidateRow
                key={candidate.username}
                candidate={candidate}
                level={levelOf(candidate)}
                selected={selected.has(candidate.username)}
                onToggle={() => toggle(candidate.username)}
              />
            ))}
          </ul>
        )}
        {error && (
          <p className='m-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12px] text-destructive'>
            {error}
          </p>
        )}
        {added !== null && (
          <p className='m-2 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] px-3 py-2 text-[12px] text-foreground'>
            Added {added} new competitor{added === 1 ? '' : 's'} to your watchlist.
          </p>
        )}
      </div>

      <div className='flex items-center justify-end border-t border-border px-4 py-3'>
        <button
          type='button'
          disabled={adding || selected.size === 0}
          onClick={() => void handleAdd()}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
            adding || selected.size === 0
              ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
              : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
          )}
        >
          <PlusIcon className='size-[15px]' strokeWidth={2.4} />
          {adding ? 'Adding…' : `Track ${selected.size > 0 ? selected.size : ''}`}
        </button>
      </div>
    </div>
  )
}

function CandidateRow({
  candidate,
  level,
  selected,
  onToggle,
}: {
  candidate: DiscoveredCandidate
  level: CompetitorLevel
  selected: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type='button'
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
          selected ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)]' : 'hover:bg-muted',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
            selected
              ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
              : 'border-border bg-background',
          )}
        >
          {selected && (
            <svg viewBox='0 0 24 24' className='size-3' fill='none' stroke='currentColor' strokeWidth={3.5} strokeLinecap='round' strokeLinejoin='round'>
              <path d='M20 6L9 17l-5-5' />
            </svg>
          )}
        </span>
        <div className='min-w-0 flex-1'>
          <div className='truncate font-mono text-[12.5px] text-foreground'>@{candidate.username}</div>
          {candidate.fullName && (
            <div className='truncate text-[11.5px] text-muted-foreground'>{candidate.fullName}</div>
          )}
          {candidate.bio && (
            <div className='mt-0.5 line-clamp-1 text-[11px] text-muted-foreground'>{candidate.bio}</div>
          )}
        </div>
        <span className='flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground'>
          <span
            aria-hidden
            title={level}
            className='size-2 rounded-full ring-1 ring-black/20'
            style={{ background: LEVEL_COLOR[level] }}
          />
          {formatBigNumber(candidate.followers)}
        </span>
      </button>
    </li>
  )
}
