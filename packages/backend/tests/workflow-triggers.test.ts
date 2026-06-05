import { describe, it, expect } from 'vitest'
import { matchesGlob } from '../src/trigger-manager.js'

describe('matchesGlob', () => {
  it('matches everything when no glob', () => {
    expect(matchesGlob('/a/b/c.png', undefined)).toBe(true)
    expect(matchesGlob('/a/b/c.png', '')).toBe(true)
  })
  it('matches a simple extension glob against the basename', () => {
    expect(matchesGlob('/a/b/c.png', '*.png')).toBe(true)
    expect(matchesGlob('/a/b/c.jpg', '*.png')).toBe(false)
  })
  it('matches a prefix glob', () => {
    expect(matchesGlob('C:\\x\\report-2026.csv', 'report-*')).toBe(true)
  })
})
