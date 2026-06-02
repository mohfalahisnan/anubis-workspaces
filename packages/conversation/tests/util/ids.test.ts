import { describe, it, expect } from 'vitest'
import { newId } from '../../src/util/ids.js'

describe('newId', () => {
  it('returns a 36-char UUID string in v7 format', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('is time-ordered (later id > earlier id lexically)', async () => {
    const a = newId()
    await new Promise(r => setTimeout(r, 2))
    const b = newId()
    expect(b > a).toBe(true)
  })
})
