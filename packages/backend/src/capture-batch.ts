import {
  CAPTURE_CHUNK_SIZE,
  CAPTURE_CHUNK_DELAY_MIN_MS,
  CAPTURE_CHUNK_DELAY_MAX_MS,
  type BatchCaptureJobResult,
  type BatchCaptureOutcome,
  type JobProgress,
} from '@anubis/shared'

/* -----------------------------------------------------------
   Chunked batch capture
   -----------------------------------------------------------
   Capturing a large competitor selection in one tight loop reads
   as bot traffic to Instagram. To stay human-paced we process the
   selection in fixed-size chunks and wait a randomized cooldown
   between chunks. The whole run lives inside a single background
   job (see captures.ts) so the UI stays responsive, can stream
   detailed progress, and can be stopped mid-run.

   This module is deliberately free of any backend/crawler wiring:
   the orchestrator takes injected `captureOne` / `sleep` / `random`
   so the chunk boundaries, delay scheduling, and stop semantics can
   be unit-tested with fake timers.

   Tuning constants (chunk size, delay range) live in @anubis/shared
   so the frontend hints stay in lockstep; re-exported here for the
   orchestrator + its tests.
   ----------------------------------------------------------- */

export { CAPTURE_CHUNK_SIZE, CAPTURE_CHUNK_DELAY_MIN_MS, CAPTURE_CHUNK_DELAY_MAX_MS }

/** Split `items` into consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be a positive integer')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Pick a randomized inter-chunk cooldown in `[minMs, maxMs]`. */
export function pickChunkDelayMs(
  random: () => number = Math.random,
  minMs: number = CAPTURE_CHUNK_DELAY_MIN_MS,
  maxMs: number = CAPTURE_CHUNK_DELAY_MAX_MS,
): number {
  const span = Math.max(0, maxMs - minMs)
  return Math.round(minMs + random() * span)
}

/**
 * A `sleep` that resolves after `ms`, or early if the signal aborts. Used as
 * the default delay implementation; tests inject a fake.
 */
export function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface BatchCaptureTarget {
  id: string
  handle: string
}

export interface RunBatchCaptureDeps {
  /** Competitors to capture, in order. */
  competitors: readonly BatchCaptureTarget[]
  /** Fires when the user requests a stop. */
  signal: AbortSignal
  /** Capture a single competitor's posts. Throwing marks that profile failed. */
  captureOne: (
    target: BatchCaptureTarget,
  ) => Promise<{ candidateCount: number; warnings?: string[] }>
  /** Push a JobProgress patch (merged into the job's progress). */
  reportProgress: (progress: JobProgress) => void
  /** Record a non-fatal warning. */
  reportWarning: (message: string) => void
  /** Interruptible sleep; defaults to `interruptibleSleep`. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** RNG in [0, 1) for the randomized cooldown; defaults to `Math.random`. */
  random?: () => number
  chunkSize?: number
  delayMinMs?: number
  delayMaxMs?: number
}

/**
 * Run a chunked, human-paced batch capture.
 *
 * Stop semantics: the abort signal is only checked *between* profiles and
 * *during* the cooldown — never mid-capture — so an in-flight profile always
 * finishes (and stays persisted) before the run winds down. Everything
 * captured in completed profiles is preserved regardless of when the stop
 * lands.
 */
export async function runBatchCapture(deps: RunBatchCaptureDeps): Promise<BatchCaptureJobResult> {
  const {
    competitors,
    signal,
    captureOne,
    reportProgress,
    reportWarning,
    sleep = interruptibleSleep,
    random = Math.random,
    chunkSize = CAPTURE_CHUNK_SIZE,
    delayMinMs = CAPTURE_CHUNK_DELAY_MIN_MS,
    delayMaxMs = CAPTURE_CHUNK_DELAY_MAX_MS,
  } = deps

  const chunks = chunk(competitors, chunkSize)
  const totalProfiles = competitors.length
  const perCompetitor: BatchCaptureOutcome[] = []
  let profilesCompleted = 0
  let candidateCount = 0

  reportProgress({
    phase: 'capture',
    status: 'capturing',
    chunkIndex: chunks.length > 0 ? 1 : 0,
    totalChunks: chunks.length,
    profilesCompleted: 0,
    totalProfiles,
    current: 0,
    total: totalProfiles,
    currentHandle: undefined,
    delaySecondsRemaining: undefined,
  })

  for (let ci = 0; ci < chunks.length; ci++) {
    if (signal.aborted) break
    const chunkTargets = chunks[ci]!

    for (const target of chunkTargets) {
      if (signal.aborted) break

      reportProgress({
        status: 'capturing',
        chunkIndex: ci + 1,
        totalChunks: chunks.length,
        profilesCompleted,
        totalProfiles,
        current: profilesCompleted,
        total: totalProfiles,
        currentHandle: target.handle,
        delaySecondsRemaining: undefined,
      })

      try {
        const res = await captureOne(target)
        candidateCount += res.candidateCount
        for (const w of res.warnings ?? []) reportWarning(w)
        perCompetitor.push({ handle: target.handle, candidateCount: res.candidateCount, ok: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportWarning(`${target.handle}: ${message}`)
        perCompetitor.push({ handle: target.handle, candidateCount: 0, ok: false, error: message })
      }

      profilesCompleted++
      reportProgress({
        profilesCompleted,
        current: profilesCompleted,
        total: totalProfiles,
        currentHandle: undefined,
      })
    }

    const isLastChunk = ci === chunks.length - 1
    if (!isLastChunk && !signal.aborted) {
      const delayMs = pickChunkDelayMs(random, delayMinMs, delayMaxMs)
      await countdownDelay(delayMs, {
        sleep,
        signal,
        reportProgress,
        base: {
          chunkIndex: ci + 1,
          totalChunks: chunks.length,
          profilesCompleted,
          totalProfiles,
        },
      })
    }
  }

  return {
    totalProfiles,
    profilesCompleted,
    candidateCount,
    stopped: signal.aborted,
    perCompetitor,
  }
}

/**
 * Wait `totalMs`, ticking a `delaySecondsRemaining` countdown into job progress
 * once per second so the UI can render "waiting Xs before next chunk". Returns
 * early when the signal aborts.
 */
async function countdownDelay(
  totalMs: number,
  opts: {
    sleep: (ms: number, signal: AbortSignal) => Promise<void>
    signal: AbortSignal
    reportProgress: (progress: JobProgress) => void
    base: Pick<JobProgress, 'chunkIndex' | 'totalChunks' | 'profilesCompleted' | 'totalProfiles'>
  },
): Promise<void> {
  const { sleep, signal, reportProgress, base } = opts
  let remaining = Math.ceil(totalMs / 1000)
  while (remaining > 0 && !signal.aborted) {
    reportProgress({
      ...base,
      status: 'delaying-between-chunks',
      currentHandle: undefined,
      delaySecondsRemaining: remaining,
    })
    await sleep(1000, signal)
    remaining--
  }
  // Clear the cooldown marker before the next chunk starts capturing.
  reportProgress({ status: 'capturing', delaySecondsRemaining: undefined })
}
