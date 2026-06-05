import { describe, it, expect } from 'vitest'
import { DEFAULT_WORKSPACE_ID, PLATFORMS } from '../src/types.js'

describe('content-memory constants', () => {
  it('exposes the well-known default workspace id', () => {
    expect(DEFAULT_WORKSPACE_ID).toBe('default-workspace')
  })

  it('lists the supported platforms including general', () => {
    expect(PLATFORMS).toContain('instagram')
    expect(PLATFORMS).toContain('general')
  })
})
