import { useEffect, useMemo, useState } from 'react'
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  SquareIcon,
  TimerIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react'

import type {
  BatchCaptureJobResult,
  CaptureJobResult,
  DiscoverJobResult,
  DiscoveredCandidate,
  JobProgress,
  JobSummary,
} from '@anubis/shared'
import { createCompetitor, listCompetitors } from '@/api'
import { useJobs } from '@/lib/use-jobs'
import { useNavigation } from '@/lib/navigation'
import { useProject } from '@/lib/use-project'
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
  return job.state === 'queued' || job.state === 'running' || job.state === 'stopping'
}

function isFinished(job: JobSummary): boolean {
  return job.state === 'succeeded' || job.state === 'failed' || job.state === 'stopped'
}

/** A job that hasn't finished and can still be stopped. */
function isStoppable(job: JobSummary): boolean {
  return job.state === 'queued' || job.state === 'running'
}

function isDelaying(job: JobSummary): boolean {
  return job.state === 'running' && job.progress.status === 'delaying-between-chunks'
}

/**
 * The six observable phases the UI distinguishes. `delaying-between-chunks`
 * is a sub-phase of `running` (driven by JobProgress.status), the rest map to
 * the lifecycle JobState.
 */
function phaseLabel(job: JobSummary): string {
  switch (job.state) {
    case 'queued':
      return 'Queued'
    case 'running':
      return isDelaying(job) ? 'Cooling down' : 'Running'
    case 'stopping':
      return 'Stopping'
    case 'stopped':
      return 'Stopped'
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
    default:
      return job.state
  }
}

function progressPercent(job: JobSummary): number {
  if (isFinished(job)) return 100
  const { current, total } = job.progress
  if (typeof current === 'number' && typeof total === 'number' && total > 0) {
    return Math.min(100, Math.max(2, Math.round((current / total) * 100)))
  }
  // Indeterminate — show a small sliver so the bar reads as "working".
  return job.state === 'queued' ? 4 : 12
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

/** True when the progress carries chunked-batch counters. */
function isBatchProgress(p: JobProgress): boolean {
  return typeof p.totalProfiles === 'number' && typeof p.totalChunks === 'number'
}

function progressNote(job: JobSummary): string {
  const p = job.progress

  // Chunked batch capture: surface chunk/profile counters + the live handle or
  // the inter-chunk cooldown countdown.
  if (isBatchProgress(p)) {
    const chunkPart =
      p.chunkIndex && p.totalChunks ? `chunk ${p.chunkIndex}/${p.totalChunks}` : ''
    const profilePart =
      typeof p.totalProfiles === 'number'
        ? `${p.profilesCompleted ?? 0}/${p.totalProfiles} profiles`
        : ''
    if (job.state === 'stopping') {
      return joinDot('Finishing current profile…', profilePart)
    }
    if (isDelaying(job) && typeof p.delaySecondsRemaining === 'number') {
      return joinDot(
        `Waiting ${formatCountdown(p.delaySecondsRemaining)} before next chunk`,
        chunkPart,
        profilePart,
      )
    }
    if (p.currentHandle) {
      return joinDot(`Capturing ${p.currentHandle}`, profilePart, chunkPart)
    }
    return joinDot(profilePart || 'Working…', chunkPart)
  }

  const { phase, current, total, note } = p
  if (job.state === 'stopping') return 'Stopping…'
  if (note && note !== 'done') return note
  if (typeof current === 'number' && typeof total === 'number') {
    return `${phase ?? 'Working'} · ${current}/${total}`
  }
  if (phase) return phase
  return job.state === 'queued' ? 'Queued…' : 'Working…'
}

/** Join non-empty parts with a middot separator. */
function joinDot(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ')
}

export function TopNavProgress() {
  const jobs = useJobs((s) => s.jobs)
  const active = useMemo(() => jobs.filter(isActive), [jobs])
  const dismiss = useJobs((s) => s.dismiss)
  const stop = useJobs((s) => s.stop)
  const [open, setOpen] = useState(false)

  // Recent finished jobs (shown in the popover list alongside active ones).
  const recentFinished = useMemo(
    () => jobs.filter(isFinished).slice(0, 6),
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
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide',
                    job.state === 'failed'
                      ? 'bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-destructive'
                      : job.state === 'succeeded'
                        ? 'bg-[color-mix(in_oklab,var(--anubis-success)_16%,transparent)] text-[var(--anubis-success)]'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {phaseLabel(job)}
                </span>
                {isStoppable(job) && (
                  <button
                    type='button'
                    aria-label='Stop job'
                    title='Stop — keeps everything captured so far'
                    onClick={() => void stop(job.id)}
                    className='inline-flex items-center gap-1 rounded-[5px] border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-[color-mix(in_oklab,var(--destructive)_50%,var(--border))] hover:text-destructive'
                  >
                    <SquareIcon className='size-2.5 fill-current' strokeWidth={0} />
                    Stop
                  </button>
                )}
                {job.state === 'stopping' && (
                  <span className='text-[10px] font-medium text-muted-foreground'>Stopping…</span>
                )}
                {isFinished(job) && (
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
              {isActive(job) && (
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
              {job.state === 'stopped' && (
                <span className='truncate text-[10.5px] text-muted-foreground'>
                  {summariseFinished(job)}
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
  if (isDelaying(job)) {
    return <TimerIcon className='size-3.5 shrink-0 text-[var(--anubis-gold)]' />
  }
  if (job.state === 'running' || job.state === 'queued' || job.state === 'stopping') {
    return <Loader2Icon className='size-3.5 shrink-0 animate-spin text-[var(--anubis-gold)]' />
  }
  if (job.state === 'succeeded') {
    return <CheckCircle2Icon className='size-3.5 shrink-0 text-[var(--anubis-success)]' />
  }
  if (job.state === 'stopped') {
    return <BanIcon className='size-3.5 shrink-0 text-muted-foreground' />
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
  if (job.kind === 'capture-posts-batch') {
    const result = job.result as BatchCaptureJobResult | undefined
    const done = result?.profilesCompleted ?? 0
    const total = result?.totalProfiles ?? 0
    const posts = result?.capturedCount ?? 0
    const prefix = job.state === 'stopped' ? `Stopped — ${done}/${total} profiles` : `${done} profiles`
    return `${prefix} · ${posts} post${posts === 1 ? '' : 's'} captured`
  }
  if (job.state === 'stopped') return 'Stopped — partial results kept.'
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
        ) : job?.kind === 'capture-posts-batch' ? (
          <BatchCaptureJobDetails job={job} onClose={onClose} />
        ) : job?.kind === 'capture-posts' ? (
          <CaptureJobDetails job={job} onClose={onClose} />
        ) : job ? (
          <GenericJobDetails job={job} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DiscoverJobDetails({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const { activeProject } = useProject()
  const result = job.result as DiscoverJobResult | undefined
  const candidates = result?.candidates ?? []
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.map((c) => c.username)))
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggle(username: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username)
      else next.add(username)
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

      <div className='max-h-[min(60vh,460px)] overflow-y-auto px-3 py-3'>
        {candidates.length === 0 ? (
          <p className='m-4 text-center text-[13px] text-muted-foreground'>
            Nothing came back from this run.
          </p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.username}
                candidate={candidate}
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
  selected,
  onToggle,
}: {
  candidate: DiscoveredCandidate
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
        <span className='shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground'>
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

function BatchCaptureJobDetails({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const { navigate } = useNavigation()
  const result = job.result as BatchCaptureJobResult | undefined
  const done = result?.profilesCompleted ?? 0
  const total = result?.totalProfiles ?? 0
  const posts = result?.capturedCount ?? 0
  const stopped = job.state === 'stopped' || result?.stopped
  const per = result?.perCompetitor ?? []
  const failed = per.filter((p) => !p.ok)

  return (
    <>
      <DialogHeader className='border-b border-border px-6 py-4'>
        <DialogTitle>{stopped ? 'Capture stopped' : 'Batch capture complete'}</DialogTitle>
        <DialogDescription>
          {job.label}
          {stopped ? ' — stopped early; everything captured so far was kept.' : ''}
        </DialogDescription>
      </DialogHeader>

      <div className='px-6 py-5'>
        <div className='flex items-center justify-center gap-8'>
          <Stat value={`${done}/${total}`} label='profiles processed' />
          <Stat value={String(posts)} label={`post${posts === 1 ? '' : 's'} captured`} />
          {failed.length > 0 && <Stat value={String(failed.length)} label='failed' tone='warn' />}
        </div>

        {per.length > 0 && (
          <ul className='mx-auto mt-5 max-h-[min(40vh,300px)] max-w-md divide-y divide-border overflow-y-auto rounded-md border border-border bg-background/60'>
            {per.map((p, i) => (
              <li key={`${p.handle}-${i}`} className='flex items-center gap-2 px-3 py-1.5 text-[12px]'>
                {p.ok ? (
                  <CheckCircle2Icon className='size-3.5 shrink-0 text-[var(--anubis-success)]' />
                ) : (
                  <XCircleIcon className='size-3.5 shrink-0 text-destructive' />
                )}
                <span className='min-w-0 flex-1 truncate font-mono text-foreground'>{p.handle}</span>
                <span className='shrink-0 tabular-nums text-muted-foreground'>
                  {p.ok ? `${p.capturedCount} post${p.capturedCount === 1 ? '' : 's'}` : 'failed'}
                </span>
              </li>
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

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'warn' }) {
  return (
    <div className='text-center'>
      <p
        className={cn(
          'font-mono text-[32px] font-semibold tabular-nums',
          tone === 'warn' ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
      </p>
      <p className='mt-0.5 text-[12px] text-muted-foreground'>{label}</p>
    </div>
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
