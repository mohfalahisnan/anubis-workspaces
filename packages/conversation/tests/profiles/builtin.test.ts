import { describe, it, expect } from 'vitest'
import { BUILTIN_PROFILES } from '../../src/profiles/builtin.js'
import { ProfileSchema } from '../../src/profiles/types.js'

describe('BUILTIN_PROFILES', () => {
  it('every entry validates against ProfileSchema and has source=builtin', () => {
    for (const p of BUILTIN_PROFILES) {
      const r = ProfileSchema.safeParse(p)
      expect(r.success, `invalid builtin profile ${p.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
      expect(p.source).toBe('builtin')
    }
  })

  it('contains the documented seed ids', () => {
    const ids = new Set(BUILTIN_PROFILES.map(p => p.id))
    for (const id of ['claude-coding', 'claude-yolo', 'claude-research', 'codex-coding', 'codex-yolo']) {
      expect(ids.has(id), `missing builtin profile ${id}`).toBe(true)
    }
  })
})
