import { describe, it, expect } from 'vitest'
import { isRunInProgress, nodeDimmed, edgeRunState, EDGE_RUN_STYLE } from '@/components/workflow/run-visuals'

describe('isRunInProgress', () => {
  it('is true only for running / awaiting_approval', () => {
    expect(isRunInProgress({ status: 'running' })).toBe(true)
    expect(isRunInProgress({ status: 'awaiting_approval' })).toBe(true)
    expect(isRunInProgress({ status: 'succeeded' })).toBe(false)
    expect(isRunInProgress({ status: 'failed' })).toBe(false)
    expect(isRunInProgress(null)).toBe(false)
    expect(isRunInProgress(undefined)).toBe(false)
  })
})

describe('nodeDimmed', () => {
  it('dims not-yet-run and skipped nodes only while in progress', () => {
    expect(nodeDimmed(undefined, true)).toBe(true)
    expect(nodeDimmed('pending', true)).toBe(true)
    expect(nodeDimmed('skipped', true)).toBe(true)
    expect(nodeDimmed('running', true)).toBe(false)
    expect(nodeDimmed('awaiting', true)).toBe(false)
    expect(nodeDimmed('succeeded', true)).toBe(false)
    expect(nodeDimmed('failed', true)).toBe(false)
    expect(nodeDimmed('pending', false)).toBe(false)
    expect(nodeDimmed(undefined, false)).toBe(false)
  })
})

describe('edgeRunState', () => {
  it('is idle when no run is in progress', () => {
    expect(edgeRunState('succeeded', 'running', false)).toBe('idle')
    expect(edgeRunState(undefined, undefined, false)).toBe('idle')
  })
  it('flows from a finished source into the live/next target', () => {
    expect(edgeRunState('succeeded', 'running', true)).toBe('flowing')
    expect(edgeRunState('succeeded', 'awaiting', true)).toBe('flowing')
    expect(edgeRunState('succeeded', 'pending', true)).toBe('flowing')
    expect(edgeRunState('succeeded', undefined, true)).toBe('flowing')
  })
  it('settles when both ends are done', () => {
    expect(edgeRunState('succeeded', 'succeeded', true)).toBe('settled')
    expect(edgeRunState('succeeded', 'failed', true)).toBe('settled')
  })
  it('dims edges not yet reached or into skipped targets', () => {
    expect(edgeRunState('pending', 'running', true)).toBe('dim')
    expect(edgeRunState(undefined, 'pending', true)).toBe('dim')
    expect(edgeRunState('succeeded', 'skipped', true)).toBe('dim')
  })
  it('defines a style for every state; only flowing animates', () => {
    for (const s of ['idle', 'flowing', 'settled', 'dim'] as const) {
      expect(EDGE_RUN_STYLE[s]).toBeTruthy()
    }
    expect(EDGE_RUN_STYLE.flowing.animation).toContain('workflowLineDash')
    expect(EDGE_RUN_STYLE.idle.animation).toBeUndefined()
    expect(EDGE_RUN_STYLE.dim.animation).toBeUndefined()
  })
})
