import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COMPETITOR_LEVELS,
  effectiveLevel,
  levelFor,
  type CompetitorLevelsConfig,
} from '../src/index.js'

describe('levelFor (default config)', () => {
  const cfg = DEFAULT_COMPETITOR_LEVELS

  it('returns "unknown" when followers is null or undefined', () => {
    expect(levelFor(null, cfg)).toBe('unknown')
    expect(levelFor(undefined, cfg)).toBe('unknown')
  })

  it('returns "black" below minActive', () => {
    expect(levelFor(0, cfg)).toBe('black')
    expect(levelFor(9_999, cfg)).toBe('black')
  })

  it('returns "green" at minActive and up to greenMax inclusive', () => {
    expect(levelFor(10_000, cfg)).toBe('green')
    expect(levelFor(25_000, cfg)).toBe('green')
    expect(levelFor(40_000, cfg)).toBe('green')
  })

  it('returns "yellow" above greenMax and up to yellowMax inclusive', () => {
    expect(levelFor(40_001, cfg)).toBe('yellow')
    expect(levelFor(75_000, cfg)).toBe('yellow')
    expect(levelFor(1_000_000, cfg)).toBe('yellow')
  })

  it('returns "red" above yellowMax', () => {
    expect(levelFor(1_000_001, cfg)).toBe('red')
    expect(levelFor(50_000_000, cfg)).toBe('red')
    expect(levelFor(660_000_000, cfg)).toBe('red')
  })

  it('returns "black" only above the (effectively unbounded) active ceiling', () => {
    expect(levelFor(1_000_000_001, cfg)).toBe('black')
  })

  it('uses default config when none is supplied', () => {
    expect(levelFor(25_000)).toBe('green')
  })
})

describe('levelFor (custom config)', () => {
  const custom: CompetitorLevelsConfig = {
    minActive: 500,
    greenMax: 5_000,
    yellowMax: 50_000,
    maxActive: 500_000,
  }

  it('honours custom bands', () => {
    expect(levelFor(499, custom)).toBe('black')
    expect(levelFor(500, custom)).toBe('green')
    expect(levelFor(5_001, custom)).toBe('yellow')
    expect(levelFor(50_001, custom)).toBe('red')
    expect(levelFor(500_001, custom)).toBe('black')
  })
})

describe('effectiveLevel', () => {
  const cfg = DEFAULT_COMPETITOR_LEVELS

  it('uses the manual override when set, ignoring followers', () => {
    expect(effectiveLevel('red', 25_000, cfg)).toBe('red')
    expect(effectiveLevel('black', 25_000, cfg)).toBe('black')
  })

  it('falls back to the derived level when override is null/undefined', () => {
    expect(effectiveLevel(null, 25_000, cfg)).toBe('green')
    expect(effectiveLevel(undefined, 25_000, cfg)).toBe('green')
    expect(effectiveLevel(undefined, null, cfg)).toBe('unknown')
  })
})

describe('isValidCompetitorLevels', () => {
  it('accepts the default config', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels(DEFAULT_COMPETITOR_LEVELS)).toBe(true)
  })

  it('rejects when bands are equal (greenMax === yellowMax)', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels({
      minActive: 1_000, greenMax: 50_000, yellowMax: 50_000, maxActive: 100_000,
    })).toBe(false)
  })

  it('rejects when any band is non-positive', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels({
      minActive: 0, greenMax: 10_000, yellowMax: 20_000, maxActive: 30_000,
    })).toBe(false)
  })

  it('rejects when bands are out of order', async () => {
    const { isValidCompetitorLevels } = await import('../src/index.js')
    expect(isValidCompetitorLevels({
      minActive: 100_000, greenMax: 50_000, yellowMax: 200_000, maxActive: 500_000,
    })).toBe(false)
  })
})
