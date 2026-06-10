import { describe, it, expect } from 'vitest'
import type { JobSummary } from '@anubis/shared'
import { jobManager } from '../src/jobs.js'

const TERMINAL = new Set(['succeeded', 'failed', 'stopped'])

/** Wait until a job reaches a terminal state (or timeout). */
async function waitForFinish(id: string, timeoutMs = 2000): Promise<JobSummary> {
  const start = Date.now()
  for (;;) {
    const job = jobManager.get(id)
    if (job && TERMINAL.has(job.state)) return job
    if (Date.now() - start > timeoutMs) throw new Error('job did not finish in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('jobManager', () => {
  it('runs a job to success and records the result + progress', async () => {
    const started = jobManager.runJob<{ value: number }>(
      { kind: 'capture-posts', label: 'Capture · @test' },
      async (ctx) => {
        ctx.reporter.start('capture', 10)
        ctx.reporter.update('capture', 5, 'halfway')
        ctx.warn('a non-fatal warning')
        return { value: 42 }
      },
    )

    // Returned synchronously, before the executor runs.
    expect(started.state).toBe('queued')
    expect(started.kind).toBe('capture-posts')

    const finished = await waitForFinish(started.id)
    expect(finished.state).toBe('succeeded')
    expect(finished.result).toEqual({ value: 42 })
    expect(finished.warnings).toContain('a non-fatal warning')
    // Last reported progress sticks.
    expect(finished.progress.phase).toBe('capture')
    expect(finished.progress.current).toBe(5)
    expect(finished.startedAt).toBeTypeOf('number')
    expect(finished.finishedAt).toBeTypeOf('number')
  })

  it('records errors when the executor throws', async () => {
    const started = jobManager.runJob(
      { kind: 'discover-competitors', label: 'Discover · explore' },
      async () => {
        throw new Error('boom')
      },
    )
    const finished = await waitForFinish(started.id)
    expect(finished.state).toBe('failed')
    expect(finished.error).toBe('boom')
    expect(finished.result).toBeUndefined()
  })

  it('emits change events to subscribers across the lifecycle', async () => {
    const events: string[] = []
    const unsubscribe = jobManager.onChange((event) => {
      if (event.type === 'job') events.push(event.job.state)
    })

    const started = jobManager.runJob(
      { kind: 'capture-posts', label: 'Capture · @events' },
      async () => 'ok',
    )
    await waitForFinish(started.id)
    unsubscribe()

    // Should have observed at least queued → running → succeeded.
    expect(events).toContain('running')
    expect(events).toContain('succeeded')
  })

  it('lets finished jobs be dismissed but refuses to remove running ones', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = jobManager.runJob(
      { kind: 'capture-posts', label: 'Capture · @dismiss' },
      async () => {
        await gate
        return 'done'
      },
    )

    // Give the executor a tick to flip to running.
    await new Promise((r) => setTimeout(r, 20))
    expect(jobManager.remove(started.id)).toBe(false)

    release()
    await waitForFinish(started.id)
    expect(jobManager.remove(started.id)).toBe(true)
    expect(jobManager.get(started.id)).toBeUndefined()
  })

  it('cancels a running job: signal aborts, state becomes stopping → stopped', async () => {
    let sawAbort = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = jobManager.runJob<{ cancelled: boolean }>(
      { kind: 'capture-posts-batch', label: 'Capture · 3 competitors' },
      async (ctx) => {
        ctx.signal.addEventListener('abort', () => {
          sawAbort = true
          release()
        })
        await gate
        // Cooperative executor returns a partial result rather than throwing.
        return { cancelled: ctx.isCancelled() }
      },
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(jobManager.cancel(started.id)).toBe(true)
    // Immediately reflects the winding-down state.
    expect(jobManager.get(started.id)?.state).toBe('stopping')

    const finished = await waitForFinish(started.id)
    expect(sawAbort).toBe(true)
    expect(finished.state).toBe('stopped')
    // A cancelled job settles as `stopped`, never `failed`.
    expect(finished.error).toBeUndefined()
    expect((finished.result as { cancelled: boolean }).cancelled).toBe(true)
  })

  it('refuses to cancel an already-finished job', async () => {
    const started = jobManager.runJob(
      { kind: 'capture-posts', label: 'Capture · @done' },
      async () => 'ok',
    )
    await waitForFinish(started.id)
    expect(jobManager.cancel(started.id)).toBe(false)
  })
})

describe('/jobs/:id/cancel route', () => {
  it('POST /jobs/:id/cancel stops a running job; 404s an unknown id', async () => {
    const { default: app } = await import('../src/app.js')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = jobManager.runJob(
      { kind: 'capture-posts-batch', label: 'Capture · 2 competitors' },
      async (ctx) => {
        ctx.signal.addEventListener('abort', () => release())
        await gate
        return 'partial'
      },
    )
    await new Promise((r) => setTimeout(r, 20))

    const res = await app.request(`/jobs/${started.id}/cancel`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; job: JobSummary }
    expect(body.ok).toBe(true)

    const finished = await waitForFinish(started.id)
    expect(finished.state).toBe('stopped')

    const missing = await app.request('/jobs/does-not-exist/cancel', { method: 'POST' })
    expect(missing.status).toBe(404)
  })
})

describe('/jobs routes', () => {
  it('GET /jobs lists jobs and GET /jobs/:id returns one', async () => {
    const { default: app } = await import('../src/app.js')
    const started = jobManager.runJob(
      { kind: 'capture-posts', label: 'Capture · @route' },
      async () => 'ok',
    )
    await waitForFinish(started.id)

    const listRes = await app.request('/jobs')
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { ok: boolean; items: JobSummary[] }
    expect(list.ok).toBe(true)
    expect(list.items.some((j) => j.id === started.id)).toBe(true)

    const oneRes = await app.request(`/jobs/${started.id}`)
    expect(oneRes.status).toBe(200)
    const one = (await oneRes.json()) as { ok: boolean; job: JobSummary }
    expect(one.job.id).toBe(started.id)

    const missing = await app.request('/jobs/does-not-exist')
    expect(missing.status).toBe(404)
  })

  it('DELETE /jobs/:id dismisses a finished job', async () => {
    const { default: app } = await import('../src/app.js')
    const started = jobManager.runJob(
      { kind: 'capture-posts', label: 'Capture · @delete' },
      async () => 'ok',
    )
    await waitForFinish(started.id)

    const del = await app.request(`/jobs/${started.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const after = await app.request(`/jobs/${started.id}`)
    expect(after.status).toBe(404)
  })

  // Regression: the SSE feed route must not be shadowed by `/:id`. Hono
  // matches same-method routes in registration order, so `/stream` has to
  // be registered before `/:id` or it resolves to the param handler (404).
  it('GET /jobs/stream opens an SSE event stream (not shadowed by /:id)', async () => {
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/jobs/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream')
    // The handler streams forever; close it so the test doesn't hang.
    await res.body?.cancel()
  })
})
