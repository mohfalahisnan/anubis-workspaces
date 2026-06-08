import { Fragment, useEffect, useState } from 'react'
import {
  CalendarClockIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'

import type { CronJobSummary } from '@anubis/shared'

import { deleteCronJob, listCronJobs, updateCronJob } from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'

/* -----------------------------------------------------------
   Scheduled jobs
   -----------------------------------------------------------
   Lists every cron job your agents have created via the
   [CRON_CREATE] block. Each row can be enabled/disabled with
   the toggle, expanded to inspect the stored prompt, or
   deleted entirely. Creation lives on the agent side — there
   is no "New scheduled job" button by design.
   ----------------------------------------------------------- */

type Banner = { kind: 'error' | 'success'; message: string }

export function ScheduledPage() {
  const { activeProject } = useProject()
  const [jobs, setJobs] = useState<CronJobSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function refresh() {
    try {
      setJobs(await listCronJobs(undefined, activeProject?.id || undefined))
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load scheduled jobs.',
      })
    }
  }

  useEffect(() => {
    void refresh()
  }, [activeProject?.id])

  async function handleToggle(job: CronJobSummary) {
    setBusy(true)
    setBanner(null)
    try {
      await updateCronJob(job.id, { enabled: !job.enabled })
      await refresh()
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Toggle failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(job: CronJobSummary) {
    const ok = window.confirm(`Delete "${job.name}"?`)
    if (!ok) return
    setBusy(true)
    setBanner(null)
    try {
      await deleteCronJob(job.id)
      await refresh()
      setBanner({ kind: 'success', message: `Deleted "${job.name}".` })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Delete failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-6 pt-7 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>
              Scheduled jobs
            </h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              Created by your agents via{' '}
              <code className='font-mono text-foreground/80'>[CRON_CREATE]</code>{' '}
              blocks. Edit or disable them here — the scheduler runs in-process,
              so a job only fires while Anubis is running.
            </p>
          </div>
          <button
            type='button'
            onClick={() => void refresh()}
            disabled={busy}
            className='inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
            Refresh
          </button>
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

        {/* Table */}
        {jobs === null ? (
          <LoadingTable />
        ) : jobs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className='mt-7 overflow-hidden rounded-md border border-border bg-card'>
            <table className='w-full border-collapse'>
              <thead>
                <tr className='border-b border-border bg-background/50 text-left'>
                  <Th>Name</Th>
                  <Th>Schedule</Th>
                  <Th>Cadence</Th>
                  <Th>Last run</Th>
                  <Th className='text-right pr-4'>Enabled</Th>
                  <Th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const isOpen = expanded === job.id
                  return (
                    <Fragment key={job.id}>
                      <tr
                        className={cn(
                          'border-b border-border transition-colors hover:bg-muted/40',
                          isOpen && 'bg-muted/40',
                        )}
                      >
                        <Td>
                          <button
                            type='button'
                            onClick={() => setExpanded(isOpen ? null : job.id)}
                            className='inline-flex items-center gap-2 text-left text-[13px] font-medium text-foreground'
                          >
                            <ChevronDownIcon
                              className={cn(
                                'size-3.5 text-muted-foreground transition-transform',
                                !isOpen && '-rotate-90',
                              )}
                              strokeWidth={2}
                            />
                            <span className='truncate'>{job.name}</span>
                          </button>
                        </Td>
                        <Td>
                          <span className='font-mono text-[12px] text-foreground'>
                            {job.schedule}
                          </span>
                        </Td>
                        <Td className='text-muted-foreground'>
                          {job.scheduleDescription ?? '—'}
                        </Td>
                        <Td className='text-muted-foreground'>
                          {job.lastRunAt ? relativeTime(job.lastRunAt) : 'never'}
                        </Td>
                        <Td className='text-right pr-4'>
                          <ToggleSwitch
                            enabled={job.enabled}
                            disabled={busy}
                            onChange={() => void handleToggle(job)}
                          />
                        </Td>
                        <Td className='pr-4'>
                          <button
                            type='button'
                            onClick={() => handleDelete(job)}
                            disabled={busy}
                            aria-label={`Delete ${job.name}`}
                            className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive disabled:opacity-50'
                          >
                            <Trash2Icon className='size-3.5' strokeWidth={2} />
                          </button>
                        </Td>
                      </tr>

                      {isOpen && (
                        <tr className='border-b border-border bg-background/40'>
                          <td colSpan={6} className='px-4 py-4'>
                            <div className='flex flex-col gap-3'>
                              <div>
                                <p className='mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
                                  Prompt
                                </p>
                                <pre className='whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-[12px] leading-[1.6] text-foreground'>
                                  {job.prompt.trim()}
                                </pre>
                              </div>
                              <div className='flex items-center gap-4 text-[11px] text-muted-foreground'>
                                <span>
                                  Conversation:{' '}
                                  <span className='font-mono text-foreground/80'>
                                    {job.conversationId}
                                  </span>
                                </span>
                                <span>
                                  Created {relativeTime(job.createdAt)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- bits ---------- */

function Th({
  children,
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      className={cn(
        'px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td className={cn('px-4 py-3 align-middle text-[13px]', className)}>
      {children}
    </td>
  )
}

function ToggleSwitch({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean
  disabled: boolean
  onChange: () => void
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={enabled}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors',
        enabled
          ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)]'
          : 'border-border bg-muted',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block size-3.5 translate-x-0.5 transform rounded-full bg-background transition-transform',
          enabled && 'translate-x-[18px]',
        )}
      />
    </button>
  )
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

function LoadingTable() {
  return (
    <div className='mt-7 overflow-hidden rounded-md border border-border bg-card'>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className='h-12 animate-pulse border-b border-border bg-card last:border-b-0'
        />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className='mt-10 flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center'>
      <CalendarClockIcon
        className='size-7 text-muted-foreground'
        strokeWidth={1.5}
      />
      <div>
        <h2 className='text-[16px] font-semibold tracking-[-0.01em]'>
          No scheduled jobs yet
        </h2>
        <p className='mt-1.5 max-w-md text-[13px] text-muted-foreground'>
          Ask your agent to schedule something — e.g. <em>"check this every
          weekday at 9am"</em> — and it'll emit a <code className='font-mono'>[CRON_CREATE]</code>{' '}
          block that lands here.
        </p>
      </div>
    </div>
  )
}

