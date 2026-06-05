import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WORKSPACE_ID,
  PLATFORMS,
  CONTENT_TYPES,
  APPROVAL_STATUSES,
} from '../src/types.js'

describe('content-memory constants', () => {
  it('exposes the well-known default workspace id', () => {
    expect(DEFAULT_WORKSPACE_ID).toBe('default-workspace')
  })

  it('lists the supported platforms including general', () => {
    expect(PLATFORMS).toContain('instagram')
    expect(PLATFORMS).toContain('general')
  })
})

describe('similarity enums', () => {
  it('exposes the content types including competitor_post and rejected_post', () => {
    expect(CONTENT_TYPES).toContain('competitor_post')
    expect(CONTENT_TYPES).toContain('rejected_post')
  })

  it('exposes approval statuses', () => {
    expect(APPROVAL_STATUSES).toEqual(['approved', 'rejected', 'needs_review'])
  })
})
