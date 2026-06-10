import { create } from 'zustand'
import type { JobSummary } from '@anubis/shared'
import { cancelJob, dismissJob, listJobs, streamJobs } from '@/api'

/* -----------------------------------------------------------
   useJobs — reusable background-job store
   -----------------------------------------------------------
   A single source of truth for every background job the backend
   is running (competitor discovery, post capture, and — later —
   workspace extraction). Subscribes once to the backend SSE feed
   (`GET /jobs/stream`) and keeps an in-memory map of jobs.

   This store is intentionally generic over job `kind`: nothing
   here is hardcoded to discovery or capture. New job kinds light
   up the top-nav progress bar and completion alerts automatically
   as long as the backend emits them.

   Usage:
     - call `useJobs.getState().connect()` once at app mount
     - `const jobs = useJobs((s) => s.jobs)` to read the live list
     - `unacknowledged` holds finished jobs the user hasn't seen yet
       (drives the completion alert / toast)
   ----------------------------------------------------------- */

export type Job = JobSummary

interface JobsState {
  /** All known jobs, newest first. */
  jobs: Job[]
  /** True once the SSE stream is connected. */
  connected: boolean
  connecting: boolean

  /** Ids of finished jobs the user has been alerted about. */
  acknowledged: Set<string>

  connect: () => void
  disconnect: () => void
  /** Mark a finished job as seen (stops it from re-alerting). */
  acknowledge: (id: string) => void
  /** Dismiss a finished job (removes it from the backend + store). */
  dismiss: (id: string) => Promise<void>
  /** Request a stop for an in-flight job (settles as `stopped`). */
  stop: (id: string) => Promise<void>
}

let abortController: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => b.createdAt - a.createdAt)
}

function isFinished(job: Job): boolean {
  return job.state === 'succeeded' || job.state === 'failed' || job.state === 'stopped'
}

export const useJobs = create<JobsState>((set, get) => ({
  jobs: [],
  connected: false,
  connecting: false,
  acknowledged: new Set<string>(),

  connect: () => {
    if (get().connected || get().connecting) return
    set({ connecting: true })

    const controller = new AbortController()
    abortController = controller

    const run = async () => {
      try {
        // Prime with the current list so we render immediately even if the
        // stream's snapshot frame is delayed.
        const initial = await listJobs().catch(() => [])
        if (controller.signal.aborted) return
        set((s) => ({
          jobs: sortJobs(mergeJobs(s.jobs, initial)),
          connected: true,
          connecting: false,
        }))

        await streamJobs({
          signal: controller.signal,
          onSnapshot: (incoming) => {
            set({ jobs: sortJobs(incoming) })
          },
          onJob: (job) => {
            set((s) => ({ jobs: sortJobs(upsertJob(s.jobs, job)) }))
          },
          onRemoved: (id) => {
            set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
          },
        })
      } catch {
        // Stream dropped — fall through to reconnect.
      } finally {
        if (!controller.signal.aborted) {
          set({ connected: false, connecting: false })
          // Backoff-free retry; the backend is local so reconnects are cheap.
          reconnectTimer = setTimeout(() => {
            if (abortController === controller) {
              abortController = null
              get().connect()
            }
          }, 2000)
        }
      }
    }

    void run()
  },

  disconnect: () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    abortController?.abort()
    abortController = null
    set({ connected: false, connecting: false })
  },

  acknowledge: (id: string) => {
    set((s) => {
      const next = new Set(s.acknowledged)
      next.add(id)
      return { acknowledged: next }
    })
  },

  dismiss: async (id: string) => {
    // Optimistic removal; the SSE 'removed' event will confirm.
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
    try {
      await dismissJob(id)
    } catch {
      // If dismissal failed (e.g. still running), the next snapshot restores it.
    }
  },

  stop: async (id: string) => {
    // Optimistic: flip to `stopping` so the UI reacts instantly; the SSE feed
    // confirms the eventual `stopped` state (and any partial result).
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id && (j.state === 'queued' || j.state === 'running')
          ? { ...j, state: 'stopping' as const }
          : j,
      ),
    }))
    try {
      await cancelJob(id)
    } catch {
      // If the stop failed (already finished, etc.), the next snapshot restores truth.
    }
  },
}))

function upsertJob(jobs: Job[], job: Job): Job[] {
  const idx = jobs.findIndex((j) => j.id === job.id)
  if (idx === -1) return [...jobs, job]
  const next = [...jobs]
  next[idx] = job
  return next
}

function mergeJobs(existing: Job[], incoming: Job[]): Job[] {
  const byId = new Map(existing.map((j) => [j.id, j]))
  for (const job of incoming) byId.set(job.id, job)
  return [...byId.values()]
}

/* ---------- selectors (importable, stable) ---------- */

/** Jobs that are queued, running, or winding down after a stop request. */
export function selectActiveJobs(s: JobsState): Job[] {
  return s.jobs.filter(
    (j) => j.state === 'queued' || j.state === 'running' || j.state === 'stopping',
  )
}

/**
 * Finished jobs the user hasn't acknowledged yet. Drives completion alerts.
 */
export function selectUnacknowledgedJobs(s: JobsState): Job[] {
  return s.jobs.filter((j) => isFinished(j) && !s.acknowledged.has(j.id))
}
