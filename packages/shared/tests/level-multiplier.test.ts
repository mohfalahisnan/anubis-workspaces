import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LEVEL_MULTIPLIERS,
  isValidLevelMultipliers,
  multiplierRatingFor,
  type LevelMultipliersConfig,
} from '../src/index.js'

describe('multiplierRatingFor (default config)', () => {
  const cfg = DEFAULT_LEVEL_MULTIPLIERS

  it('is unrated when the competitor level is not green/yellow/red', () => {
    expect(multiplierRatingFor('black', 1000, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('unknown', 1000, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
  })

  it('is unrated when likes or avgLikes is missing or avgLikes <= 0', () => {
    expect(multiplierRatingFor('green', null, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('green', undefined, 10, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('green', 100, null, cfg)).toEqual({ rating: 'unrated', multiplier: null })
    expect(multiplierRatingFor('green', 100, 0, cfg)).toEqual({ rating: 'unrated', multiplier: null })
  })

  it('green competitor: < 5x red, [5x,10x) yellow, >= 10x green', () => {
    expect(multiplierRatingFor('green', 49, 10, cfg).rating).toBe('red')   // 4.9x
    expect(multiplierRatingFor('green', 50, 10, cfg).rating).toBe('yellow') // 5x boundary
    expect(multiplierRatingFor('green', 99, 10, cfg).rating).toBe('yellow') // 9.9x
    expect(multiplierRatingFor('green', 100, 10, cfg).rating).toBe('green') // 10x boundary
  })

  it('yellow competitor: < 10x red, [10x,15x) yellow, >= 15x green', () => {
    expect(multiplierRatingFor('yellow', 99, 10, cfg).rating).toBe('red')
    expect(multiplierRatingFor('yellow', 100, 10, cfg).rating).toBe('yellow')
    expect(multiplierRatingFor('yellow', 150, 10, cfg).rating).toBe('green')
  })

  it('red competitor: < 15x red, [15x,20x) yellow, >= 20x green', () => {
    expect(multiplierRatingFor('red', 149, 10, cfg).rating).toBe('red')
    expect(multiplierRatingFor('red', 150, 10, cfg).rating).toBe('yellow')
    expect(multiplierRatingFor('red', 200, 10, cfg).rating).toBe('green')
  })

  it('returns the numeric multiplier alongside the rating', () => {
    expect(multiplierRatingFor('green', 123, 10, cfg).multiplier).toBeCloseTo(12.3)
  })
})

describe('isValidLevelMultipliers', () => {
  it('accepts the default config', () => {
    expect(isValidLevelMultipliers(DEFAULT_LEVEL_MULTIPLIERS)).toBe(true)
  })

  it('accepts fractional thresholds with min < good', () => {
    const cfg: LevelMultipliersConfig = {
      green: { min: 2.5, good: 5 },
      yellow: { min: 5, good: 7.5 },
      red: { min: 7.5, good: 10 },
    }
    expect(isValidLevelMultipliers(cfg)).toBe(true)
  })

  it('rejects when a band has min >= good', () => {
    expect(isValidLevelMultipliers({
      green: { min: 10, good: 10 },
      yellow: { min: 10, good: 15 },
      red: { min: 15, good: 20 },
    })).toBe(false)
  })

  it('rejects when any value is non-positive', () => {
    expect(isValidLevelMultipliers({
      green: { min: 0, good: 10 },
      yellow: { min: 10, good: 15 },
      red: { min: 15, good: 20 },
    })).toBe(false)
  })
})
