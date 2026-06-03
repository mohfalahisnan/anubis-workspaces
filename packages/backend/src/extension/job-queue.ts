import { randomUUID } from 'node:crypto'

export const EXTENSION_OFFLINE = 'EXTENSION_OFFLINE'
export const EXTENSION_TIMEOUT = 'EXTENSION_TIMEOUT'
export const EXTENSION_ERROR = 'EXTENSION_ERROR'
export const CANCELLED = 'CANCELLED'

export class ExtensionDispatchError extends Error {
  constructor(public readonly code: string, message: string, public readonly inner?: unknown) {
    super(message)
    this.name = 'ExtensionDispatchError'
  }
}

interface PendingJob {
  resolve: (data: unknown) => void
  reject: (err: ExtensionDispatchError) => void
  timer: NodeJS.Timeout
}

export interface JobQueueTransport {
  send(frame: unknown): boolean
  isConnected(): boolean
}

export interface DispatchOpts {
  kind: 'capture-profile' | 'discover'
  input: unknown
  timeoutMs: number
}

/* -----------------------------------------------------------
   JobQueue
   -----------------------------------------------------------
   In-memory router between HTTP requests and the WS client.
   dispatch() returns a Promise that resolves on a matching
   `result` frame from the extension (or rejects with one of
   EXTENSION_OFFLINE / EXTENSION_ERROR / EXTENSION_TIMEOUT /
   CANCELLED). No persistence; jobs vanish on backend restart.
   ----------------------------------------------------------- */
export class JobQueue {
  private readonly pending = new Map<string, PendingJob>()

  constructor(private readonly transport: JobQueueTransport) {}

  dispatch(opts: DispatchOpts): Promise<unknown> {
    if (!this.transport.isConnected()) {
      return Promise.reject(
        new ExtensionDispatchError(
          EXTENSION_OFFLINE,
          'Anubis extension is not connected. Open Chrome with the extension installed and paired.',
        ),
      )
    }
    const jobId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(jobId)) {
          reject(new ExtensionDispatchError(EXTENSION_TIMEOUT, `Job ${jobId} timed out after ${opts.timeoutMs}ms`))
        }
      }, opts.timeoutMs)

      this.pending.set(jobId, { resolve, reject, timer })

      const ok = this.transport.send({
        type: 'dispatch',
        jobId,
        kind: opts.kind,
        input: opts.input,
        timeoutMs: opts.timeoutMs,
      })
      if (!ok) {
        clearTimeout(timer)
        this.pending.delete(jobId)
        reject(new ExtensionDispatchError(EXTENSION_OFFLINE, 'Extension dropped between isConnected check and send.'))
      }
    })
  }

  handleFrame(frame: unknown): void {
    if (!isWithJobId(frame)) return
    if (frame.type === 'result' && frame.ok) {
      const job = this.pending.get(frame.jobId)
      if (!job) return
      clearTimeout(job.timer)
      this.pending.delete(frame.jobId)
      job.resolve(frame.data)
    } else if (frame.type === 'error' && frame.ok === false) {
      const job = this.pending.get(frame.jobId)
      if (!job) return
      clearTimeout(job.timer)
      this.pending.delete(frame.jobId)
      job.reject(
        new ExtensionDispatchError(EXTENSION_ERROR, frame.message ?? 'extension error', { code: frame.code, message: frame.message }),
      )
    }
  }

  cancel(jobId: string): void {
    const job = this.pending.get(jobId)
    if (!job) return
    clearTimeout(job.timer)
    this.pending.delete(jobId)
    this.transport.send({ type: 'cancel', jobId })
    job.reject(new ExtensionDispatchError(CANCELLED, `Job ${jobId} cancelled`))
  }

  disconnectAll(): void {
    for (const [jobId, job] of this.pending) {
      clearTimeout(job.timer)
      job.reject(new ExtensionDispatchError(EXTENSION_OFFLINE, `Extension disconnected before job ${jobId} completed`))
    }
    this.pending.clear()
  }
}

function isWithJobId(frame: unknown): frame is { type: string; jobId: string; ok?: boolean; data?: unknown; code?: string; message?: string } {
  return typeof frame === 'object' && frame !== null
    && 'type' in frame && typeof (frame as { type: unknown }).type === 'string'
    && 'jobId' in frame && typeof (frame as { jobId: unknown }).jobId === 'string'
}
