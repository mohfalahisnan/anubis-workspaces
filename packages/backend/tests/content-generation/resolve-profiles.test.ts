import { describe, expect, it } from 'vitest'
import { resolveGenerationProfiles } from '../../src/content-generation/resolve-profiles.js'

describe('resolveGenerationProfiles', () => {
  it('per-field: project override beats global', () => {
    expect(resolveGenerationProfiles({ image: 'manual' }, { image: 'codex-image', video: 'codex-video' }))
      .toEqual({ image: 'manual', video: 'codex-video' })
  })

  it('falls back to global when project field is unset', () => {
    expect(resolveGenerationProfiles({}, { image: 'google-flow' }))
      .toEqual({ image: 'google-flow', video: undefined })
  })

  it('returns undefined fields when neither is set (caller applies the manual default)', () => {
    expect(resolveGenerationProfiles(undefined, undefined)).toEqual({ image: undefined, video: undefined })
  })
})
