import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { JobKind, JobProgress, JobState, JobSummary } from '@anubis/shared'

/**
 * Structural match for the research-crawler's ProgressReporter. Declared
 * locally (rather than imported) so the job manager stays decoupled from
 * the crawler package; it's structurally assignable wherever a crawler
 * reporter is expected.
 */
export interface ProgressReporter {
  start(phase: string, total?: number): void
  update(phase: string, current: number, note?: string): void
  event(phase: string, message: string): void
  done(phase: string): void
}

/* -----------------------------------------------------------
   Background job manager
   -----------------------------------------------------------
   A small, generic in-memory registry for long-running work
   (competitor discovery, post capture, and later workspace
   extraction). Jobs run detached from the request that started
   them; the HTTP route returns the job id immediately and the
   frontend monitors progress via SSE (`GET /jobs/stream`) or by
   polling (`GET /jobs`, `GET /jobs/:id`).

   The manager is deliberately decoupled from any specific job
   kind — `runJob` takes an executor closure and a `kind` string,
   so adding a new background feature needs no changes here.
   ----------------------------------------------------------- */

/** Mutable internal job record; `JobSummary` is the serialisable view. */
interface JobRecord<TResult = unknown> extends JobSummary<TResult> {}

export interface RunJobInput {
  kind: JobKind
  label: string
  projectId?: string
}

/** Handle passed to a job executor for reporting progress + warnings. */
export interface JobContext {
  /** A research-crawler ProgressReporter that funnels phases into job progress. */
  reporter: ProgressReporter
  /** Record a non-fatal warning. */
  warn: (message: string) => void
  /** Manually set a progress note/phase (independent of the reporter). */
  setProgress: (progress: JobProgress) => void
  /** Aborts when the user requests a stop (`cancel`). */
  signal: AbortSignal
  /** True once a stop has been requested for this job. */
  isCancelled: () => boolean
}

/** Per-job cancellation state, kept off the serialisable summary. */
interface JobControl {
  controller: AbortController
  cancelRequested: boolean
}

type JobEvent =
  | { type: 'snapshot'; jobs: JobSummary[] }
  | { type: 'job'; job: JobSummary }
  | { type: 'removed'; id: string }

const MAX_FINISHED_JOBS = 50

class JobManager {
  private readonly jobs = new Map<string, JobRecord>()
  private readonly control = new Map<string, JobControl>()
  private readonly emitter = new EventEmitter()

  constructor() {
    // Job runs are fire-and-forget; many SSE clients may subscribe.
    this.emitter.setMaxListeners(0)
  }

  list(): JobSummary[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toSummary)
  }

  get(id: string): JobSummary | undefined {
    const record = this.jobs.get(id)
    return record ? toSummary(record) : undefined
  }

  /** Remove a finished job (dismiss). In-flight jobs cannot be removed. */
  remove(id: string): boolean {
    const record = this.jobs.get(id)
    if (!record) return false
    if (isInFlight(record.state)) return false
    this.jobs.delete(id)
    this.control.delete(id)
    this.emit({ type: 'removed', id })
    return true
  }

  /**
   * Request a stop for a queued/running job. The job's AbortSignal fires so a
   * cooperative executor can wind down gracefully; the final state becomes
   * `stopped` (not `failed`) once the executor returns. Already-finished jobs
   * and jobs that don't observe the signal are unaffected. Returns false if
   * the job is unknown or already terminal.
   */
  cancel(id: string): boolean {
    const record = this.jobs.get(id)
    if (!record) return false
    if (record.state !== 'queued' && record.state !== 'running') return false

    const ctrl = this.control.get(id)
    if (ctrl) {
      ctrl.cancelRequested = true
      ctrl.controller.abort()
    }
    // A running job advertises `stopping` while it winds down; a still-queued
    // job is short-circuited to `stopped` when its executor starts.
    if (record.state === 'running') {
      record.state = 'stopping'
      this.publish(record)
    }
    return true
  }

  onChange(listener: (event: JobEvent) => void): () => void {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }

  /**
   * Enqueue + start a job. Returns the created job synchronously; the
   * executor runs on the next microtask so the HTTP handler can respond
   * immediately with the job id.
   */
  runJob<TResult>(
    input: RunJobInput,
    executor: (ctx: JobContext) => Promise<TResult>,
  ): JobSummary<TResult> {
    const now = Date.now()
    const record: JobRecord<TResult> = {
      id: randomUUID(),
      kind: input.kind,
      label: input.label,
      state: 'queued',
      progress: {},
      warnings: [],
      projectId: input.projectId,
      createdAt: now,
    }
    this.jobs.set(record.id, record as JobRecord)
    this.control.set(record.id, { controller: new AbortController(), cancelRequested: false })
    this.publish(record)

    queueMicrotask(() => void this.execute(record, executor))

    return toSummary(record)
  }

  private async execute<TResult>(
    record: JobRecord<TResult>,
    executor: (ctx: JobContext) => Promise<TResult>,
  ): Promise<void> {
    const ctrl = this.control.get(record.id)!

    // Stop requested before the executor even started — don't run at all.
    if (ctrl.cancelRequested) {
      record.state = 'stopped'
      record.finishedAt = Date.now()
      this.publish(record)
      this.control.delete(record.id)
      this.pruneFinished()
      return
    }

    record.state = 'running'
    record.startedAt = Date.now()
    this.publish(record)

    const ctx: JobContext = {
      reporter: this.makeReporter(record),
      warn: (message) => {
        record.warnings.push(message)
        this.publish(record)
      },
      setProgress: (progress) => {
        record.progress = { ...record.progress, ...progress }
        this.publish(record)
      },
      signal: ctrl.controller.signal,
      isCancelled: () => ctrl.cancelRequested,
    }

    try {
      const result = await executor(ctx)
      record.result = result
      // A cooperative executor returns normally even when stopped; honour the
      // cancellation rather than reporting a (misleading) success.
      record.state = ctrl.cancelRequested ? 'stopped' : 'succeeded'
    } catch (err) {
      // A stop that surfaces as a thrown AbortError is a stop, not a failure.
      record.state = ctrl.cancelRequested ? 'stopped' : 'failed'
      if (record.state === 'failed') {
        record.error = err instanceof Error ? err.message : 'Job failed.'
      }
    } finally {
      record.finishedAt = Date.now()
      this.publish(record)
      this.control.delete(record.id)
      this.pruneFinished()
    }
  }

  /** Bridge the crawler's ProgressReporter into job-progress updates. */
  private makeReporter(record: JobRecord): ProgressReporter {
    const apply = (progress: JobProgress) => {
      record.progress = { ...record.progress, ...progress }
      this.publish(record)
    }
    return {
      start: (phase, total) => apply({ phase, total, current: 0 }),
      update: (phase, current, note) => apply({ phase, current, note }),
      event: (phase, message) => apply({ phase, note: message }),
      done: (phase) => apply({ phase, note: 'done' }),
    }
  }

  private publish(record: JobRecord): void {
    this.emit({ type: 'job', job: toSummary(record) })
  }

  private emit(event: JobEvent): void {
    this.emitter.emit('change', event)
  }

  /** Keep memory bounded: drop the oldest finished jobs past the cap. */
  private pruneFinished(): void {
    const finished = [...this.jobs.values()]
      .filter((j) => isTerminal(j.state))
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    while (finished.length > MAX_FINISHED_JOBS) {
      const oldest = finished.shift()
      if (!oldest) break
      this.jobs.delete(oldest.id)
      this.emit({ type: 'removed', id: oldest.id })
    }
  }
}

/** A job that is queued, running, or winding down after a stop request. */
function isInFlight(state: JobState): boolean {
  return state === 'queued' || state === 'running' || state === 'stopping'
}

/** A job that has reached a final state and won't change again. */
function isTerminal(state: JobState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'stopped'
}

function toSummary<TResult>(record: JobRecord<TResult>): JobSummary<TResult> {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    state: record.state as JobState,
    progress: { ...record.progress },
    result: record.result,
    error: record.error,
    warnings: [...record.warnings],
    projectId: record.projectId,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  }
}

/** Process-wide singleton; the backend is a single child process. */
export const jobManager = new JobManager()

/* -----------------------------------------------------------
   Routes
   ----------------------------------------------------------- */

export const jobRoutes = new Hono()

jobRoutes.get('/', (c) => {
  return c.json({ ok: true, items: jobManager.list() })
})

// NOTE: `/stream` MUST be registered before `/:id`. Hono matches
// same-method routes in registration order, so a `/:id` handler placed
// first would capture `/jobs/stream` as `id="stream"` and 404 the SSE
// feed (regression covered in tests/jobs.test.ts).
//
// Live job feed. Emits:
//   event: snapshot  data: JobSummary[]        (sent once on connect)
//   event: job       data: JobSummary          (created / progress / finished)
//   event: removed   data: { id }              (dismissed / pruned)
jobRoutes.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const queue: JobEvent[] = [{ type: 'snapshot', jobs: jobManager.list() }]
    let notify: (() => void) | null = null
    let closed = false

    const unsubscribe = jobManager.onChange((event) => {
      queue.push(event)
      notify?.()
    })

    stream.onAbort(() => {
      closed = true
      unsubscribe()
      notify?.()
    })

    try {
      while (!closed) {
        while (queue.length > 0) {
          const event = queue.shift()!
          if (event.type === 'snapshot') {
            await stream.writeSSE({ event: 'snapshot', data: JSON.stringify(event.jobs) })
          } else if (event.type === 'job') {
            await stream.writeSSE({ event: 'job', data: JSON.stringify(event.job) })
          } else {
            await stream.writeSSE({ event: 'removed', data: JSON.stringify({ id: event.id }) })
          }
        }
        if (closed) break
        // Park until the next event (or a heartbeat) wakes us. Clear the
        // heartbeat timer when an event resolves us early so handles don't
        // pile up over the life of the connection.
        let timer: ReturnType<typeof setTimeout> | null = null
        await new Promise<void>((resolve) => {
          notify = resolve
          timer = setTimeout(resolve, 15_000)
        })
        if (timer) clearTimeout(timer)
        notify = null
        if (!closed && queue.length === 0) {
          // Heartbeat comment keeps the connection alive through proxies.
          await stream.writeSSE({ event: 'ping', data: '{}' })
        }
      }
    } finally {
      unsubscribe()
    }
  })
})

jobRoutes.get('/:id', (c) => {
  const job = jobManager.get(c.req.param('id'))
  if (!job) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, job })
})

// Request a stop for a queued/running job. The job winds down gracefully and
// settles as `stopped`; work already completed is preserved.
jobRoutes.post('/:id/cancel', (c) => {
  const cancelled = jobManager.cancel(c.req.param('id'))
  if (!cancelled) return c.json({ ok: false, error: 'not_found_or_not_running' }, 404)
  const job = jobManager.get(c.req.param('id'))
  return c.json({ ok: true, job })
})

jobRoutes.delete('/:id', (c) => {
  const removed = jobManager.remove(c.req.param('id'))
  if (!removed) return c.json({ ok: false, error: 'not_found_or_running' }, 404)
  return c.json({ ok: true })
})
