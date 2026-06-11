import { useState } from 'react'
import {
  BanIcon,
  CheckCircle2Icon,
  CompassIcon,
  HashIcon,
  Loader2Icon,
  LogInIcon,
  SearchIcon,
  SquareIcon,
  TimerIcon,
  XCircleIcon,
} from 'lucide-react'

import type { CompetitorLevel, DiscoverySource, JobProgress, JobSummary } from '@anubis/shared'

import { openInstagramLoginChrome } from '@/api'
import { LEVEL_COLOR } from '@/lib/competitor-level'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

/* ===========================================================
   competitor-actions — shared building blocks
   ===========================================================
   Form controls, level helpers, and a live job-progress panel
   shared by the Discover Competitors page, the Capture Posts
   page, and the (preview-only) capture selection dialog still
   used on the Content page. Centralised here so the three
   surfaces stay visually and behaviourally consistent.
   =========================================================== */

export type RunMode = 'login' | 'public'

export interface CaptureRunOptions {
  /** Which Chrome profile dir/port to use. */
  profile: RunMode
  /** Whether to launch Chrome headless. */
  headless: boolean
  /** Required only when profile=login and headless=true. */
  forceHeadless: boolean
  /** Maximum candidate posts to fetch per selected profile before review. */
  targetPostsPerProfile: number
}

export const LEVEL_LABEL: Record<CompetitorLevel, string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  black: 'Black',
  unknown: 'Unknown',
}

/**
 * Small colored level badge — consistent with the tier colors used
 * across the rest of the competitor surfaces (`LEVEL_COLOR`).
 */
export function LevelBadge({ level }: { level: CompetitorLevel }) {
  const color = LEVEL_COLOR[level]
  return (
    <span
      title={LEVEL_LABEL[level]}
      className='inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em]'
      style={{
        borderColor: `color-mix(in oklab, ${color} 55%, var(--border))`,
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        color: `color-mix(in oklab, ${color} 72%, var(--foreground))`,
      }}
    >
      <span aria-hidden className='size-2 rounded-full' style={{ background: color }} />
      {LEVEL_LABEL[level]}
    </span>
  )
}

/**
 * Run options block — exposes the two knobs the user actually cares about for
 * any crawler call: which Chrome profile (signed in vs anonymous) and headless
 * (window vs background). The discovery page passes `allowProfilePick={false}`
 * plus a `pinnedNote` so the fixed-login choice is honest rather than hidden.
 */
export function RunOptionsPanel({
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
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginMessage, setLoginMessage] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)

  async function handleOpenLoginChrome() {
    setLoginBusy(true)
    setLoginMessage(null)
    setLoginError(null)
    try {
      const result = await openInstagramLoginChrome()
      setLoginMessage(result.reused ? 'Login Chrome is already open.' : 'Login Chrome opened.')
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Could not open login Chrome.')
    } finally {
      setLoginBusy(false)
    }
  }

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

      <div className='flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='min-w-0'>
            <p className='text-[12.5px] font-medium text-foreground'>Instagram login</p>
            <p className='mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground'>
              Open the app profile, sign in, then run collection.
            </p>
          </div>
          <button
            type='button'
            onClick={() => void handleOpenLoginChrome()}
            disabled={loginBusy}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] font-medium transition-colors',
              loginBusy
                ? 'cursor-wait bg-muted text-muted-foreground'
                : 'bg-background text-foreground hover:bg-muted',
            )}
          >
            <LogInIcon className='size-3.5' strokeWidth={2} />
            {loginBusy ? 'Opening…' : 'Open login Chrome'}
          </button>
        </div>
        {(loginMessage || loginError) && (
          <p
            role='status'
            className={cn(
              'text-[11.5px] leading-relaxed',
              loginError ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {loginError ?? loginMessage}
          </p>
        )}
      </div>

      <label className='flex cursor-pointer select-none items-center gap-2.5 text-[12.5px] text-foreground'>
        <input
          type='checkbox'
          checked={headless}
          onChange={(e) => onHeadlessChange(e.target.checked)}
          className='sr-only'
        />
        <Checkbox checked={headless} />
        <span>Run headless</span>
        <span className='text-[11.5px] text-muted-foreground'>(no Chrome window)</span>
      </label>

      {pinnedNote && (
        <p className='text-[11.5px] leading-relaxed text-muted-foreground'>{pinnedNote}</p>
      )}
    </div>
  )
}

export function SourceSegmented({
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

export function Checkbox({ checked }: { checked: boolean }) {
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

export function Field({
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

export const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className='flex flex-col gap-2 px-3 py-3'>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className='h-10 animate-pulse rounded-md border border-border bg-background/60'
        />
      ))}
    </div>
  )
}

export function formatBigNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function relativeTime(ms: number): string {
  const d = Date.now() - ms
  const min = Math.round(d / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

export function usernameKey(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/* ===========================================================
   Live job-progress panel
   ===========================================================
   Renders a rich, full-page view of an in-flight (or finished)
   background job by reading the shared jobs store. Distinct from
   the compact top-nav indicator: this shows the phase, counters,
   live handle, cooldown countdown, and any warnings, plus a Stop
   control. Used by both the Discover and Capture pages.
   =========================================================== */

function isActive(job: JobSummary): boolean {
  return job.state === 'queued' || job.state === 'running' || job.state === 'stopping'
}

function isFinished(job: JobSummary): boolean {
  return job.state === 'succeeded' || job.state === 'failed' || job.state === 'stopped'
}

function isDelaying(job: JobSummary): boolean {
  return job.state === 'running' && job.progress.status === 'delaying-between-chunks'
}

export function jobPhaseLabel(job: JobSummary): string {
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
  return job.state === 'queued' ? 4 : 12
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

function isBatchProgress(p: JobProgress): boolean {
  return typeof p.totalProfiles === 'number' && typeof p.totalChunks === 'number'
}

function joinDot(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ')
}

export function jobProgressNote(job: JobSummary): string {
  const p = job.progress
  if (isBatchProgress(p)) {
    const chunkPart = p.chunkIndex && p.totalChunks ? `chunk ${p.chunkIndex}/${p.totalChunks}` : ''
    const profilePart =
      typeof p.totalProfiles === 'number'
        ? `${p.profilesCompleted ?? 0}/${p.totalProfiles} profiles`
        : ''
    if (job.state === 'stopping') return joinDot('Finishing current profile…', profilePart)
    if (isDelaying(job) && typeof p.delaySecondsRemaining === 'number') {
      return joinDot(
        `Waiting ${formatCountdown(p.delaySecondsRemaining)} before next chunk`,
        chunkPart,
        profilePart,
      )
    }
    if (p.currentHandle) return joinDot(`Capturing ${p.currentHandle}`, profilePart, chunkPart)
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

function JobStateIcon({ job }: { job: JobSummary }) {
  if (isDelaying(job)) return <TimerIcon className='size-4 shrink-0 text-[var(--anubis-gold)]' />
  if (isActive(job)) return <Loader2Icon className='size-4 shrink-0 animate-spin text-[var(--anubis-gold)]' />
  if (job.state === 'succeeded') return <CheckCircle2Icon className='size-4 shrink-0 text-[var(--anubis-success)]' />
  if (job.state === 'stopped') return <BanIcon className='size-4 shrink-0 text-muted-foreground' />
  return <XCircleIcon className='size-4 shrink-0 text-destructive' />
}

/**
 * Full-width progress card for a single background job. The job is read from
 * the shared store by the page, so it keeps rendering across navigation; pass
 * `onStop` to surface a Stop button while the job is still stoppable.
 */
export function JobProgressPanel({
  job,
  onStop,
}: {
  job: JobSummary
  onStop?: (id: string) => void
}) {
  const stoppable = job.state === 'queued' || job.state === 'running'
  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3.5'>
      <div className='flex items-center gap-2.5'>
        <JobStateIcon job={job} />
        <span className='min-w-0 flex-1 truncate font-mono text-[13px] text-foreground'>
          {job.label}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            job.state === 'failed'
              ? 'bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-destructive'
              : job.state === 'succeeded'
                ? 'bg-[color-mix(in_oklab,var(--anubis-success)_16%,transparent)] text-[var(--anubis-success)]'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {jobPhaseLabel(job)}
        </span>
        {stoppable && onStop && (
          <button
            type='button'
            onClick={() => onStop(job.id)}
            title='Stop — keeps everything captured so far'
            className='inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[color-mix(in_oklab,var(--destructive)_50%,var(--border))] hover:text-destructive'
          >
            <SquareIcon className='size-2.5 fill-current' strokeWidth={0} />
            Stop
          </button>
        )}
      </div>

      {isActive(job) && <Progress value={progressPercent(job)} className='h-1.5' />}

      <p className='text-[12px] text-muted-foreground'>{jobProgressNote(job)}</p>

      {job.state === 'failed' && (
        <p className='rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12px] text-destructive'>
          {job.error ?? 'Job failed.'}
        </p>
      )}

      {job.warnings.length > 0 && (
        <details className='text-[11.5px] text-muted-foreground'>
          <summary className='cursor-pointer select-none'>
            {job.warnings.length} warning{job.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul className='mt-1.5 max-h-40 list-disc overflow-y-auto rounded-md border border-border bg-background/60 px-6 py-2'>
            {job.warnings.slice(0, 30).map((w, i) => (
              <li key={i} className='break-words'>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
