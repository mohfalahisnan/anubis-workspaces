import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react'

import type {
  CaptureJobResult,
  CompetitorLevel,
  DiscoverJobResult,
  DiscoveredCandidate,
  ExtractWorkspaceJobResult,
  JobSummary,
} from '@anubis/shared'
import { createCompetitor, listCompetitors } from '@/api'
import { useJobs } from '@/lib/use-jobs'
import { useNavigation } from '@/lib/navigation'
import { useProject } from '@/lib/use-project'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { LEVEL_COLOR } from '@/lib/competitor-level'
import {
  CompetitorLevelFilter,
  matchesLevelFilter,
  type LevelFilter,
} from '@/components/competitor-level-filter'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/* ===========================================================
   TopNavProgress
   ===========================================================
   The reusable active-job indicator that lives in the top nav.
   It is generic over job kind — it renders whatever jobs the
   `useJobs` store holds, so future job kinds (e.g. workspace
   extraction) appear here automatically.

   Pairs with <JobCompletionAlerts/>, which surfaces a toast on
   completion and opens a kind-aware details modal on click.
   =========================================================== */

function isActive(job: JobSummary): boolean {
  return job.state === 'queued' || job.state === 'running'
}

function isFinished(job: JobSummary): boolean {
  return job.state === 'succeeded' || job.state === 'failed'
}

function progressPercent(job: JobSummary): number {
  if (job.state === 'succeeded') return 100
  if (job.state === 'failed') return 100
  const { current, total } = job.progress
  if (typeof current === 'number' && typeof total === 'number' && total > 0) {
    return Math.min(100, Math.max(2, Math.round((current / total) * 100)))
  }
  // Indeterminate — show a small sliver so the bar reads as "working".
  return job.state === 'running' ? 12 : 4
}

function progressNote(job: JobSummary): string {
  const { phase, current, total, note } = job.progress
  if (note && note !== 'done') return note
  if (typeof current === 'number' && typeof total === 'number') {
    return `${phase ?? 'Working'} · ${current}/${total}`
  }
  if (phase) return phase
  return job.state === 'queued' ? 'Queued…' : 'Working…'
}

export function TopNavProgress() {
  const jobs = useJobs((s) => s.jobs)
  const active = useMemo(() => jobs.filter(isActive), [jobs])
  const dismiss = useJobs((s) => s.dismiss)
  const [open, setOpen] = useState(false)

  // Recent finished jobs (shown in the popover list alongside active ones).
  const recentFinished = useMemo(
    () => jobs.filter((j) => j.state === 'succeeded' || j.state === 'failed').slice(0, 6),
    [jobs],
  )

  if (active.length === 0 && recentFinished.length === 0) return null

  const headline =
    active.length > 0
      ? `${active.length} job${active.length === 1 ? '' : 's'} running`
      : 'Jobs'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label='Background jobs'
          className={cn(
            'hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm transition-colors sm:flex mr-1',
            active.length > 0
              ? 'border-[color-mix(in_oklab,var(--anubis-gold)_35%,var(--border))] bg-card/60 text-foreground'
              : 'border-border bg-card/60 text-muted-foreground hover:text-foreground',
          )}
        >
          {active.length > 0 ? (
            <Loader2Icon className='size-3.5 animate-spin text-[var(--anubis-gold)]' />
          ) : (
            <CheckCircle2Icon className='size-3.5 text-[var(--anubis-success)]' />
          )}
          <span className='font-mono text-[11px] font-medium tracking-tight'>{headline}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        <div className='border-b border-border px-3 py-2'>
          <p className='text-[12px] font-medium text-foreground'>Background jobs</p>
        </div>
        <ul className='max-h-[320px] overflow-y-auto p-1.5'>
          {[...active, ...recentFinished].length === 0 && (
            <li className='px-2 py-3 text-center text-[12px] text-muted-foreground'>
              No jobs yet.
            </li>
          )}
          {[...active, ...recentFinished].map((job) => (
            <li
              key={job.id}
              className='flex flex-col gap-1.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/60'
            >
              <div className='flex items-center gap-2'>
                <JobStateIcon job={job} />
                <span className='min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground'>
                  {job.label}
                </span>
                {(job.state === 'succeeded' || job.state === 'failed') && (
                  <button
                    type='button'
                    aria-label='Dismiss job'
                    onClick={() => void dismiss(job.id)}
                    className='text-muted-foreground transition-colors hover:text-foreground'
                  >
                    <XIcon className='size-3.5' strokeWidth={2.2} />
                  </button>
                )}
              </div>
              {(job.state === 'queued' || job.state === 'running') && (
                <>
                  <Progress
                    value={progressPercent(job)}
                    className='h-1'
                  />
                  <span className='truncate text-[10.5px] text-muted-foreground'>
                    {progressNote(job)}
                  </span>
                </>
              )}
              {job.state === 'failed' && (
                <span className='truncate text-[10.5px] text-destructive'>
                  {job.error ?? 'Failed.'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function JobStateIcon({ job }: { job: JobSummary }) {
  if (job.state === 'running' || job.state === 'queued') {
    return <Loader2Icon className='size-3.5 shrink-0 animate-spin text-[var(--anubis-gold)]' />
  }
  if (job.state === 'succeeded') {
    return <CheckCircle2Icon className='size-3.5 shrink-0 text-[var(--anubis-success)]' />
  }
  return <XCircleIcon className='size-3.5 shrink-0 text-destructive' />
}

/* ===========================================================
   JobCompletionAlerts
   ===========================================================
   Surfaces a small toast for each newly-finished job. Clicking
   it acknowledges the job and opens a kind-aware details modal.
   =========================================================== */

export function JobCompletionAlerts() {
  const jobs = useJobs((s) => s.jobs)
  const acknowledged = useJobs((s) => s.acknowledged)
  const acknowledge = useJobs((s) => s.acknowledge)
  const unacknowledged = useMemo(
    () => jobs.filter((j) => isFinished(j) && !acknowledged.has(j.id)),
    [jobs, acknowledged],
  )
  const [detailsJob, setDetailsJob] = useState<JobSummary | null>(null)

  // Auto-dismiss successful toasts after a while so they don't pile up; failed
  // ones stay until the user clicks them.
  useEffect(() => {
    const timers = unacknowledged
      .filter((j) => j.state === 'succeeded')
      .map((j) =>
        setTimeout(() => acknowledge(j.id), 12_000),
      )
    return () => timers.forEach(clearTimeout)
  }, [unacknowledged, acknowledge])

  return (
    <>
      <div className='pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2'>
        {unacknowledged.slice(0, 4).map((job) => (
          <button
            key={job.id}
            type='button'
            onClick={() => {
              acknowledge(job.id)
              setDetailsJob(job)
            }}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3 text-left shadow-lg ring-1 ring-foreground/5 transition-colors',
              job.state === 'succeeded'
                ? 'border-[color-mix(in_oklab,var(--anubis-success)_40%,var(--border))] hover:bg-muted/60'
                : 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] hover:bg-muted/60',
            )}
          >
            <JobStateIcon job={job} />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[12.5px] font-medium text-foreground'>
                {job.label}
              </p>
              <p className='mt-0.5 truncate text-[11.5px] text-muted-foreground'>
                {summariseFinished(job)}
              </p>
            </div>
            <ChevronRightIcon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
          </button>
        ))}
      </div>

      <JobDetailsModal job={detailsJob} onClose={() => setDetailsJob(null)} />
    </>
  )
}

function summariseFinished(job: JobSummary): string {
  if (job.state === 'failed') return job.error ?? 'Job failed.'
  if (job.kind === 'discover-competitors') {
    const result = job.result as DiscoverJobResult | undefined
    const n = result?.candidates.length ?? 0
    return n === 0 ? 'No candidates found.' : `${n} candidate${n === 1 ? '' : 's'} — click to review`
  }
  if (job.kind === 'capture-posts') {
    const result = job.result as CaptureJobResult | undefined
    const n = result?.capturedCount ?? 0
    return n === 0 ? 'No new posts captured.' : `Captured ${n} post${n === 1 ? '' : 's'} — click to view`
  }
  if (job.kind === 'extract-workspace') {
    const result = job.result as ExtractWorkspaceJobResult | undefined
    const n = result?.processedCount ?? 0
    return n === 0 ? 'No files extracted.' : `Extracted ${n} file${n === 1 ? '' : 's'} — click for details`
  }
  return 'Completed — click for details'
}

/* ===========================================================
   JobDetailsModal — kind-aware results view
   =========================================================== */

function JobDetailsModal({
  job,
  onClose,
}: {
  job: JobSummary | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-2xl bg-card p-0'>
        {job?.kind === 'discover-competitors' ? (
          <DiscoverJobDetails job={job} onClose={onClose} />
        ) : job?.kind === 'capture-posts' ? (
          <CaptureJobDetails job={job} onClose={onClose} />
        ) : job?.kind === 'extract-workspace' ? (
          <ExtractWorkspaceJobDetails job={job} onClose={onClose} />
        ) : job ? (
          <GenericJobDetails job={job} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DiscoverJobDetails({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const { activeProject } = useProject()
  const { levelFor } = useCompetitorLevels()
  const result = job.result as DiscoverJobResult | undefined
  const candidates = result?.candidates ?? []
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  // Out-of-range ('black') candidates are hidden by default; flip to review them.
  const [showBlack, setShowBlack] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const levelOf = (candidate: DiscoveredCandidate): CompetitorLevel =>
    levelFor(candidate.followers ?? null)

  // Seed the default selection once the candidates are available: pick the
  // in-range (non-black) ones so a default "Add" never tracks profiles the
  // user can't see. Re-seeding is guarded so user toggles aren't clobbered.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || candidates.length === 0) return
    seeded.current = true
    setSelected(new Set(candidates.filter((c) => levelOf(c) !== 'black').map((c) => c.username)))
  }, [candidates, levelFor])

  const visibleCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        const level = levelOf(candidate)
        // Hide black unless the user opted in or is explicitly filtering to it.
        if (level === 'black' && !showBlack && levelFilter !== 'black') return false
        return matchesLevelFilter(level, levelFilter)
      }),
    [candidates, levelFilter, showBlack, levelFor],
  )
  const visibleSelectedCount = visibleCandidates.filter((c) => selected.has(c.username)).length

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
      for (const c of visibleCandidates) next.add(c.username)
      return next
    })
  }

  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of visibleCandidates) next.delete(c.username)
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

  return (
    <>
      <DialogHeader className='border-b border-border px-6 py-4'>
        <DialogTitle>Discovered competitors</DialogTitle>
        <DialogDescription>
          {job.label} — {candidates.length} candidate{candidates.length === 1 ? '' : 's'} found.
          Pick which to start tracking.
        </DialogDescription>
      </DialogHeader>

      {candidates.length > 0 && (
        <div className='flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5'>
          <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
          <div className='flex items-center gap-3 text-[11.5px]'>
            <label className='inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground'>
              <input
                type='checkbox'
                checked={showBlack}
                onChange={(e) => setShowBlack(e.target.checked)}
                className='size-3.5 accent-[var(--anubis-gold)]'
              />
              Show out-of-range
            </label>
            <button
              type='button'
              onClick={visibleSelectedCount === visibleCandidates.length ? clearVisible : selectVisible}
              disabled={visibleCandidates.length === 0}
              className='font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40'
            >
              {visibleSelectedCount === visibleCandidates.length ? 'Clear shown' : 'Select shown'}
            </button>
          </div>
        </div>
      )}

      <div className='max-h-[min(60vh,460px)] overflow-y-auto px-3 py-3'>
        {candidates.length === 0 ? (
          <p className='m-4 text-center text-[13px] text-muted-foreground'>
            Nothing came back from this run.
          </p>
        ) : visibleCandidates.length === 0 ? (
          <p className='m-4 text-center text-[13px] text-muted-foreground'>
            No candidates match this filter.
          </p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {visibleCandidates.map((candidate) => (
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
            Added {added} new competitor{added === 1 ? '' : 's'}.
          </p>
        )}
      </div>

      <DialogFooter className='border-t border-border px-6 py-3'>
        <button
          type='button'
          onClick={onClose}
          className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          Close
        </button>
        <button
          type='button'
          disabled={adding || selected.size === 0 || candidates.length === 0}
          onClick={() => void handleAdd()}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
            adding || selected.size === 0 || candidates.length === 0
              ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
              : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
          )}
        >
          <PlusIcon className='size-[15px]' strokeWidth={2.4} />
          {adding ? 'Adding…' : `Add ${selected.size > 0 ? selected.size : ''}`}
        </button>
      </DialogFooter>
    </>
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
          selected
            ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)]'
            : 'hover:bg-muted',
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

function CaptureJobDetails({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const { navigate } = useNavigation()
  const result = job.result as CaptureJobResult | undefined
  const count = result?.capturedCount ?? 0

  return (
    <>
      <DialogHeader className='border-b border-border px-6 py-4'>
        <DialogTitle>Capture complete</DialogTitle>
        <DialogDescription>{job.label}</DialogDescription>
      </DialogHeader>

      <div className='px-6 py-6 text-center'>
        <p className='font-mono text-[40px] font-semibold tabular-nums text-foreground'>{count}</p>
        <p className='mt-1 text-[13px] text-muted-foreground'>
          new post{count === 1 ? '' : 's'} captured
          {result?.competitor?.handle ? ` from ${result.competitor.handle}` : ''}.
        </p>
        {job.warnings.length > 0 && (
          <ul className='mx-auto mt-4 max-w-sm list-disc rounded-md border border-border bg-background/60 px-6 py-3 text-left text-[11.5px] text-muted-foreground'>
            {job.warnings.slice(0, 4).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <DialogFooter className='border-t border-border px-6 py-3'>
        <button
          type='button'
          onClick={onClose}
          className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          Close
        </button>
        <button
          type='button'
          onClick={() => {
            onClose()
            navigate({ page: 'content' })
          }}
          className='inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-4 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)]'
        >
          View posts
        </button>
      </DialogFooter>
    </>
  )
}

function ExtractWorkspaceJobDetails({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const { navigate } = useNavigation()
  const result = job.result as ExtractWorkspaceJobResult | undefined
  const stats: Array<{ label: string; value: number }> = [
    { label: 'Files found', value: result?.totalCount ?? 0 },
    { label: 'Processed', value: result?.processedCount ?? 0 },
    { label: 'Images (OCR)', value: result?.imageCount ?? 0 },
    { label: 'Audio/Video', value: result?.mediaCount ?? 0 },
    { label: 'From cache', value: result?.cachedCount ?? 0 },
    { label: 'Failed', value: result?.failedCount ?? 0 },
  ]

  return (
    <>
      <DialogHeader className='border-b border-border px-6 py-4'>
        <DialogTitle>Workspace extraction complete</DialogTitle>
        <DialogDescription>{job.label}</DialogDescription>
      </DialogHeader>

      <div className='px-6 py-5'>
        <div className='grid grid-cols-3 gap-3'>
          {stats.map((s) => (
            <div
              key={s.label}
              className='rounded-md border border-border bg-background/60 px-3 py-3 text-center'
            >
              <p className='font-mono text-[22px] font-semibold tabular-nums text-foreground'>{s.value}</p>
              <p className='mt-0.5 text-[11px] text-muted-foreground'>{s.label}</p>
            </div>
          ))}
        </div>
        {job.warnings.length > 0 && (
          <div className='mt-4'>
            <p className='mb-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
              {job.warnings.length} warning{job.warnings.length === 1 ? '' : 's'}
            </p>
            <ul className='max-h-[160px] list-disc overflow-y-auto rounded-md border border-border bg-background/60 px-6 py-3 text-left text-[11.5px] text-muted-foreground'>
              {job.warnings.slice(0, 20).map((w, i) => (
                <li key={i} className='break-words'>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DialogFooter className='border-t border-border px-6 py-3'>
        <button
          type='button'
          onClick={onClose}
          className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          Close
        </button>
        <button
          type='button'
          onClick={() => {
            onClose()
            navigate({ page: 'knowledge-base' })
          }}
          className='inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-4 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)]'
        >
          Open Knowledge Base
        </button>
      </DialogFooter>
    </>
  )
}

function GenericJobDetails({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  return (
    <>
      <DialogHeader className='border-b border-border px-6 py-4'>
        <DialogTitle>{job.label}</DialogTitle>
        <DialogDescription>
          {job.state === 'failed' ? 'This job failed.' : 'This job completed.'}
        </DialogDescription>
      </DialogHeader>
      <div className='px-6 py-5 text-[13px] text-muted-foreground'>
        {job.state === 'failed' ? (
          <p className='text-destructive'>{job.error ?? 'Unknown error.'}</p>
        ) : (
          <pre className='max-h-[40vh] overflow-auto rounded-md border border-border bg-background/60 p-3 text-[11.5px] text-foreground'>
            {JSON.stringify(job.result ?? {}, null, 2)}
          </pre>
        )}
      </div>
      <DialogFooter className='border-t border-border px-6 py-3'>
        <button
          type='button'
          onClick={onClose}
          className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          Close
        </button>
      </DialogFooter>
    </>
  )
}

function formatBigNumber(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}
