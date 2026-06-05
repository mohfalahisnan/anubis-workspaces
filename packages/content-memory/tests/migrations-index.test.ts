import { describe, it, expect } from 'vitest'
import { CONTENT_MEMORY_MIGRATIONS } from '../src/db/migrations/index.js'

describe('CONTENT_MEMORY_MIGRATIONS', () => {
  it('exports versions 8, 9, 11 with non-empty SQL', () => {
    const versions = CONTENT_MEMORY_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([8, 9, 11])
    for (const m of CONTENT_MEMORY_MIGRATIONS) {
      expect(m.sql.length).toBeGreaterThan(0)
    }
  })
})
