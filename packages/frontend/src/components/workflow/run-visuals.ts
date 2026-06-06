import type { CSSProperties } from 'react'
import type { NodeRunStatus } from './node-shell'

type RunStatusLike =
  | { status: 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'rejected' | 'cancelled' }
  | null
  | undefined

export type EdgeRunState = 'idle' | 'flowing' | 'settled' | 'dim'

/** A run is "in progress" while it is executing or paused for approval. */
export function isRunInProgress(run: RunStatusLike): boolean {
  return run?.status === 'running' || run?.status === 'awaiting_approval'
}

/** Not-yet-run (pending/not-started) or skipped nodes dim — but only during a run. */
export function nodeDimmed(status: NodeRunStatus | undefined, inProgress: boolean): boolean {
  if (!inProgress) return false
  return status === undefined || status === 'pending' || status === 'skipped'
}

/**
 * Classify an edge for run visualization, from its endpoints' statuses:
 *  - idle:    no run in progress
 *  - flowing: source finished and target is the live/next node (data is moving)
 *  - settled: both ends finished (quiet)
 *  - dim:     not yet reached, or into a skipped branch
 */
export function edgeRunState(
  source: NodeRunStatus | undefined,
  target: NodeRunStatus | undefined,
  inProgress: boolean,
): EdgeRunState {
  if (!inProgress) return 'idle'
  if (source === 'succeeded') {
    if (target === 'succeeded' || target === 'failed') return 'settled'
    if (target === 'running' || target === 'awaiting' || target === 'pending' || target === undefined) {
      return 'flowing'
    }
  }
  return 'dim'
}

export const EDGE_RUN_STYLE: Record<EdgeRunState, CSSProperties> = {
  idle:    { strokeWidth: 2,   stroke: 'var(--anubis-gold)',    strokeOpacity: 0.5 },
  flowing: { strokeWidth: 2.5, stroke: 'var(--anubis-gold-hi)', strokeOpacity: 1, strokeDasharray: '10 8', animation: 'workflowLineDash 700ms linear infinite' },
  settled: { strokeWidth: 2,   stroke: 'var(--anubis-gold)',    strokeOpacity: 0.55 },
  dim:     { strokeWidth: 2,   stroke: 'var(--anubis-gold)',    strokeOpacity: 0.16 },
}
