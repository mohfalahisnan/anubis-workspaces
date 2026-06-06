import { describe, it, expect } from 'vitest'
import type { RunStatus, StepStatus, NodeRunEvent } from '../src/types.js'

it('new statuses and events are part of the unions', () => {
  const r: RunStatus[] = ['pending', 'running', 'awaiting_approval', 'succeeded', 'failed', 'rejected', 'cancelled']
  const s: StepStatus[] = ['pending', 'running', 'awaiting', 'succeeded', 'failed', 'skipped']
  const awaiting: NodeRunEvent = { kind: 'node-awaiting', nodeId: 'n', at: 1, title: 't' }
  const decided: NodeRunEvent = { kind: 'node-decided', nodeId: 'n', at: 1, decision: 'approved' }
  expect(r.length).toBe(7)
  expect(s.length).toBe(6)
  expect(awaiting.kind).toBe('node-awaiting')
  expect(decided.kind).toBe('node-decided')
})
