import type { CapturedPostSummary } from '@anubis/shared'
import { jobManager } from './jobs.js'

/* -----------------------------------------------------------
   Live batch-capture candidate store
   -----------------------------------------------------------
   Batch capture no longer persists posts; instead each profile's
   captured posts are appended here, keyed by the batch job id, so
   the results panel can poll them in as the run progresses. The
   store lives exactly as long as the job record (pruned on job
   removal), so a finished-but-not-dismissed job still serves its
   full set — the job result therefore carries only counts.
   ----------------------------------------------------------- */

const store = new Map<string, CapturedPostSummary[]>()

export function appendBatchCandidates(jobId: string, candidates: CapturedPostSummary[]): void {
  const existing = store.get(jobId)
  if (existing) existing.push(...candidates)
  else store.set(jobId, [...candidates])
}

export function getBatchCandidates(jobId: string): CapturedPostSummary[] {
  return store.get(jobId) ?? []
}

export function clearBatchCandidates(jobId: string): void {
  store.delete(jobId)
}

// Drop a job's candidates when its record is removed (dismiss / prune) so the
// store stays bounded by the job manager's own lifecycle.
jobManager.onChange((event) => {
  if (event.type === 'removed') store.delete(event.id)
})
