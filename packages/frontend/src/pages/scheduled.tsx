import { Fragment, useEffect, useState } from 'react'
import {
  CalendarClockIcon,
  ChevronDownIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'

import type { CronJobSummary } from '@anubis/shared'

import { deleteCronJob, listCronJobs, updateCronJob, createCronJob } from '@/api'
import { workflowsApi, type WorkflowSummary } from '@/api/workflows'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'

/* -----------------------------------------------------------
   Scheduled jobs
   -----------------------------------------------------------
   Lists every cron job your agents have created via the
   [CRON_CREATE] block. Each row can be enabled/disabled with
   the toggle, expanded to inspect the stored action payload,
   or deleted entirely. Creation lives on the agent side —
   there is no "New scheduled job" button by design.
   ----------------------------------------------------------- */

type Banner = { kind: 'error' | 'success'; message: string }

export function ScheduledPage() {
  const { activeProject } = useProject()
  const [jobs, setJobs] = useState<CronJobSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

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
            <button
              type='button'
              onClick={() => setAddOpen(true)}
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              <PlusIcon className='size-[15px]' strokeWidth={2.4} />
              New scheduled job
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
                                  Action
                                </p>
                                <pre className='whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-[12px] leading-[1.6] text-foreground'>
                                  {formatJobDetail(job)}
                                </pre>
                              </div>
                              <div className='flex items-center gap-4 text-[11px] text-muted-foreground'>
                                <span>
                                  Type:{' '}
                                  <span className='font-mono text-foreground/80'>
                                    {job.actionType}
                                  </span>
                                </span>
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
      <CreateCronDialog
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

function formatJobDetail(job: CronJobSummary): string {
  if (job.actionType === 'message') return job.prompt.trim() || '<empty prompt>'
  return JSON.stringify(job.actionConfig ?? {}, null, 2)
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

/* ---------- Create Scheduled Job Dialog ---------- */

function CreateCronDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { activeProject } = useProject()
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('*/30 * * * *')
  const [scheduleDescription, setScheduleDescription] = useState('Every 30 minutes')
  const [actionType, setActionType] = useState<'message' | 'competitor-discovery' | 'capture-posts' | 'workflow'>('message')
  const [prompt, setPrompt] = useState('')

  const [discoveryQuery, setDiscoveryQuery] = useState('')
  const [discoveryProfile, setDiscoveryProfile] = useState<'public' | 'login'>('public')
  const [discoveryLevel, setDiscoveryLevel] = useState<'black' | 'green' | 'yellow' | 'red'>('green')

  const [captureHandles, setCaptureHandles] = useState('all')
  const [captureProfile, setCaptureProfile] = useState<'public' | 'login'>('public')
  const [captureLimit, setCaptureLimit] = useState<number | ''>(30)

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [workflowInput, setWorkflowInput] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setSchedule('*/30 * * * *')
      setScheduleDescription('Every 30 minutes')
      setActionType('message')
      setPrompt('')
      setDiscoveryQuery('')
      setDiscoveryProfile('public')
      setDiscoveryLevel('green')
      setCaptureHandles('all')
      setCaptureProfile('public')
      setCaptureLimit(30)
      setWorkflowId('')
      setWorkflowInput('')
      setErr(null)
      setSubmitting(false)
    }
  }, [open])

  // Load the project's workflows so the user can pick one for a 'workflow' job.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void workflowsApi
      .list(activeProject?.id)
      .then((r) => {
        if (!cancelled) setWorkflows(r.items)
      })
      .catch(() => {
        if (!cancelled) setWorkflows([])
      })
    return () => {
      cancelled = true
    }
  }, [open, activeProject?.id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setErr('Name is required.')
      return
    }
    if (!schedule.trim()) {
      setErr('Schedule expression is required.')
      return
    }

    setSubmitting(true)
    setErr(null)

    try {
      let actionConfig: any = undefined
      if (actionType === 'competitor-discovery') {
        if (!discoveryQuery.trim()) {
          setErr('Discovery query is required.')
          setSubmitting(false)
          return
        }
        actionConfig = {
          projectId: activeProject?.id || 'default',
          query: discoveryQuery.trim(),
          captureProfile: discoveryProfile,
          defaultLevel: discoveryLevel,
        }
      } else if (actionType === 'capture-posts') {
        let handles: string | string[] = captureHandles.trim()
        if (handles !== 'all') {
          handles = handles.split(',').map((h) => h.trim()).filter(Boolean)
          if (handles.length === 0) {
            setErr('At least one handle or "all" is required.')
            setSubmitting(false)
            return
          }
        }
        actionConfig = {
          projectId: activeProject?.id || 'default',
          handles,
          captureProfile,
          postLimit: captureLimit || 30,
        }
      } else if (actionType === 'workflow') {
        if (!workflowId) {
          setErr('Select a workflow to run.')
          setSubmitting(false)
          return
        }
        let input: Record<string, unknown> | undefined
        const rawInput = workflowInput.trim()
        if (rawInput) {
          try {
            const parsed = JSON.parse(rawInput)
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              throw new Error('not an object')
            }
            input = parsed as Record<string, unknown>
          } catch {
            setErr('Input payload must be a JSON object (node-id → data overrides).')
            setSubmitting(false)
            return
          }
        }
        actionConfig = {
          workflowId,
          projectId: activeProject?.id || undefined,
          ...(input ? { input } : {}),
        }
      }

      await createCronJob({
        name: name.trim(),
        schedule: schedule.trim(),
        scheduleDescription: scheduleDescription.trim() || undefined,
        actionType,
        actionConfig,
        prompt: actionType === 'message' ? prompt.trim() : undefined,
        projectId: activeProject?.id,
      })

      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create scheduled job.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-md bg-card p-0'>
        <form onSubmit={submit}>
          <DialogHeader className='border-b border-border px-6 py-4'>
            <DialogTitle>New scheduled job</DialogTitle>
            <DialogDescription>
              Create a new in-process cron job to automate your workflows.
            </DialogDescription>
          </DialogHeader>

          <div className='flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6 py-5'>
            <Field label='Job Name' htmlFor='cron-name' hint='Choose a unique name for this scheduled task.'>
              <input
                id='cron-name'
                type='text'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='Capture Trend Posts daily'
                autoFocus
                className={textInput}
              />
            </Field>

            <div className='grid grid-cols-2 gap-3'>
              <Field label='Cron Schedule' htmlFor='cron-expr' hint='Standard 5-field cron expression.'>
                <input
                  id='cron-expr'
                  type='text'
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder='0 9 * * 1-5'
                  className={textInput}
                />
              </Field>

              <Field label='Description' htmlFor='cron-desc' hint='Human-readable cadence.'>
                <input
                  id='cron-desc'
                  type='text'
                  value={scheduleDescription}
                  onChange={(e) => setScheduleDescription(e.target.value)}
                  placeholder='Every weekday at 9am'
                  className={textInput}
                />
              </Field>
            </div>

            <Field label='Action Type' htmlFor='cron-type'>
              <select
                id='cron-type'
                value={actionType}
                onChange={(e) => setActionType(e.target.value as any)}
                className={textInput}
              >
                <option value='message'>Agent Prompt</option>
                <option value='competitor-discovery'>Competitor Discovery</option>
                <option value='capture-posts'>Capture Posts</option>
                <option value='workflow'>Run Workflow</option>
              </select>
            </Field>

            {actionType === 'workflow' && (
              <>
                <Field label='Workflow' htmlFor='cron-wf-id' hint='Runs the published version on the schedule below.'>
                  <select
                    id='cron-wf-id'
                    value={workflowId}
                    onChange={(e) => setWorkflowId(e.target.value)}
                    className={textInput}
                  >
                    <option value=''>Select a workflow…</option>
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.id} disabled={!wf.hasPublished}>
                        {wf.name}
                        {wf.hasPublished ? '' : ' (no published version)'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label='Input (optional)'
                  htmlFor='cron-wf-input'
                  hint='JSON object of per-node data overrides, e.g. {"node-1": {"value": "x"}}. Leave blank for none.'
                >
                  <textarea
                    id='cron-wf-input'
                    value={workflowInput}
                    onChange={(e) => setWorkflowInput(e.target.value)}
                    placeholder='{}'
                    rows={3}
                    className={`${textInput} h-auto resize-none py-2 font-mono leading-relaxed`}
                  />
                </Field>
              </>
            )}

            {actionType === 'message' && (
              <Field label='Agent Prompt' htmlFor='cron-prompt' hint='The message sent to the agent when the job runs.'>
                <textarea
                  id='cron-prompt'
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder='Generate today trend analysis report and publish to Slack.'
                  rows={3}
                  className={`${textInput} h-auto resize-none py-2 leading-relaxed`}
                />
              </Field>
            )}

            {actionType === 'competitor-discovery' && (
              <>
                <Field label='Search Query' htmlFor='cron-disc-query' hint='Keyword, hashtag (e.g. #productivity), or "explore".'>
                  <input
                    id='cron-disc-query'
                    type='text'
                    value={discoveryQuery}
                    onChange={(e) => setDiscoveryQuery(e.target.value)}
                    placeholder='#tech'
                    className={textInput}
                  />
                </Field>
                <div className='grid grid-cols-2 gap-3'>
                  <Field label='Capture Profile' htmlFor='cron-disc-profile'>
                    <select
                      id='cron-disc-profile'
                      value={discoveryProfile}
                      onChange={(e) => setDiscoveryProfile(e.target.value as any)}
                      className={textInput}
                    >
                      <option value='public'>Public profile</option>
                      <option value='login'>Login profile</option>
                    </select>
                  </Field>
                  <Field label='Default Level' htmlFor='cron-disc-level'>
                    <select
                      id='cron-disc-level'
                      value={discoveryLevel}
                      onChange={(e) => setDiscoveryLevel(e.target.value as any)}
                      className={textInput}
                    >
                      <option value='green'>Green</option>
                      <option value='yellow'>Yellow</option>
                      <option value='red'>Red</option>
                      <option value='black'>Black</option>
                    </select>
                  </Field>
                </div>
              </>
            )}

            {actionType === 'capture-posts' && (
              <>
                <Field label='Handles' htmlFor='cron-capt-handles' hint='Comma-separated handles or "all".'>
                  <input
                    id='cron-capt-handles'
                    type='text'
                    value={captureHandles}
                    onChange={(e) => setCaptureHandles(e.target.value)}
                    placeholder='all'
                    className={textInput}
                  />
                </Field>
                <div className='grid grid-cols-2 gap-3'>
                  <Field label='Capture Profile' htmlFor='cron-capt-profile'>
                    <select
                      id='cron-capt-profile'
                      value={captureProfile}
                      onChange={(e) => setCaptureProfile(e.target.value as any)}
                      className={textInput}
                    >
                      <option value='public'>Public profile</option>
                      <option value='login'>Login profile</option>
                    </select>
                  </Field>
                  <Field label='Post Limit' htmlFor='cron-capt-limit'>
                    <input
                      id='cron-capt-limit'
                      type='number'
                      min={1}
                      max={100}
                      value={captureLimit}
                      onChange={(e) => setCaptureLimit(Number(e.target.value) || '')}
                      className={textInput}
                    />
                  </Field>
                </div>
              </>
            )}

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
              disabled={submitting || !name.trim() || !schedule.trim()}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                submitting || !name.trim() || !schedule.trim()
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
              )}
            >
              {submitting ? 'Creating…' : 'Create job'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
      <label htmlFor={htmlFor} className='text-[12.5px] font-medium text-foreground'>
        {label}
      </label>
      {children}
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'
