import { describe, it, expect } from 'vitest'
import type { CapturedPostSummary } from '@anubis/shared'
import {
  appendBatchCandidates,
  getBatchCandidates,
  clearBatchCandidates,
} from '../src/capture-candidates.js'

function post(id: string): CapturedPostSummary {
  return { id, competitorId: 'c1', username: 'u', postUrl: `https://x/${id}`, capturedAt: 1 }
}

describe('batch candidate store', () => {
  it('appends per job and reads them back, isolated by job id', () => {
    appendBatchCandidates('job-A', [post('a1'), post('a2')])
    appendBatchCandidates('job-A', [post('a3')])
    appendBatchCandidates('job-B', [post('b1')])

    expect(getBatchCandidates('job-A').map((p) => p.id)).toEqual(['a1', 'a2', 'a3'])
    expect(getBatchCandidates('job-B').map((p) => p.id)).toEqual(['b1'])
    expect(getBatchCandidates('unknown')).toEqual([])

    clearBatchCandidates('job-A')
    expect(getBatchCandidates('job-A')).toEqual([])
    expect(getBatchCandidates('job-B').map((p) => p.id)).toEqual(['b1'])
  })
})
