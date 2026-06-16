import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppConfigService } from '../../src/config/app-config.js'

describe('AppConfigService — competitorLevels', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cfg-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a valid competitorLevels block', () => {
    const svc = new AppConfigService(dir)
    const next = svc.update({
      competitorLevels: {
        minActive: 5_000,
        greenMax: 20_000,
        yellowMax: 80_000,
        maxActive: 500_000,
      },
    })
    expect(next.competitorLevels).toEqual({
      minActive: 5_000,
      greenMax: 20_000,
      yellowMax: 80_000,
      maxActive: 500_000,
    })
  })

  it('persists the block to disk and reloads it', () => {
    new AppConfigService(dir).update({
      competitorLevels: {
        minActive: 1_000,
        greenMax: 10_000,
        yellowMax: 50_000,
        maxActive: 200_000,
      },
    })
    const reloaded = new AppConfigService(dir).get()
    expect(reloaded.competitorLevels?.greenMax).toBe(10_000)
  })

  it('drops the block when the invariant is broken (greenMax >= yellowMax)', () => {
    const svc = new AppConfigService(dir)
    const next = svc.update({
      competitorLevels: {
        minActive: 1_000,
        greenMax: 50_000,
        yellowMax: 50_000,
        maxActive: 100_000,
      },
    })
    expect(next.competitorLevels).toBeUndefined()
  })

  it('drops the block when any value is non-positive', () => {
    const svc = new AppConfigService(dir)
    const next = svc.update({
      competitorLevels: {
        minActive: 0,
        greenMax: 10_000,
        yellowMax: 20_000,
        maxActive: 30_000,
      },
    })
    expect(next.competitorLevels).toBeUndefined()
  })

  it('leaves chromePath untouched when updating competitorLevels', () => {
    const svc = new AppConfigService(dir)
    svc.update({ chromePath: 'C:\\chrome.exe' })
    const next = svc.update({
      competitorLevels: {
        minActive: 1_000,
        greenMax: 10_000,
        yellowMax: 50_000,
        maxActive: 200_000,
      },
    })
    expect(next.chromePath).toBe('C:\\chrome.exe')
  })

  it('falls back to empty when config.json holds a corrupt block', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        competitorLevels: { minActive: 'bogus', greenMax: 'x', yellowMax: 'y', maxActive: 'z' },
      }),
    )
    const cfg = new AppConfigService(dir).get()
    expect(cfg.competitorLevels).toBeUndefined()
  })
})

describe('AppConfigService — levelMultipliers', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cfg-mult-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const valid = {
    green: { min: 5, good: 10 },
    yellow: { min: 10, good: 15 },
    red: { min: 15, good: 20 },
  }

  it('accepts a valid levelMultipliers block and reloads it', () => {
    new AppConfigService(dir).update({ levelMultipliers: valid })
    const reloaded = new AppConfigService(dir).get()
    expect(reloaded.levelMultipliers).toEqual(valid)
  })

  it('accepts fractional thresholds', () => {
    const frac = {
      green: { min: 2.5, good: 5 },
      yellow: { min: 5, good: 7.5 },
      red: { min: 7.5, good: 10 },
    }
    const next = new AppConfigService(dir).update({ levelMultipliers: frac })
    expect(next.levelMultipliers).toEqual(frac)
  })

  it('drops the block when a band has min >= good', () => {
    const next = new AppConfigService(dir).update({
      levelMultipliers: {
        green: { min: 10, good: 10 },
        yellow: { min: 10, good: 15 },
        red: { min: 15, good: 20 },
      },
    })
    expect(next.levelMultipliers).toBeUndefined()
  })

  it('drops the block when any value is non-positive', () => {
    const next = new AppConfigService(dir).update({
      levelMultipliers: {
        green: { min: 0, good: 10 },
        yellow: { min: 10, good: 15 },
        red: { min: 15, good: 20 },
      },
    })
    expect(next.levelMultipliers).toBeUndefined()
  })

  it('drops the block when a level is missing', () => {
    const next = new AppConfigService(dir).update({
      // @ts-expect-error — deliberately incomplete to exercise sanitize
      levelMultipliers: { green: { min: 5, good: 10 } },
    })
    expect(next.levelMultipliers).toBeUndefined()
  })

  it('leaves competitorLevels untouched when updating levelMultipliers', () => {
    const svc = new AppConfigService(dir)
    svc.update({
      competitorLevels: { minActive: 1_000, greenMax: 10_000, yellowMax: 50_000, maxActive: 200_000 },
    })
    const next = svc.update({ levelMultipliers: valid })
    expect(next.competitorLevels?.greenMax).toBe(10_000)
    expect(next.levelMultipliers).toEqual(valid)
  })
})

describe('AppConfigService — showPromptInjectionCard', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anubis-cfg-card-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('defaults to true when unset', () => {
    expect(new AppConfigService(dir).get().showPromptInjectionCard).toBe(true)
  })

  it('round-trips false and reloads it', () => {
    new AppConfigService(dir).update({ showPromptInjectionCard: false })
    expect(new AppConfigService(dir).get().showPromptInjectionCard).toBe(false)
  })

  it('round-trips true', () => {
    const next = new AppConfigService(dir).update({ showPromptInjectionCard: true })
    expect(next.showPromptInjectionCard).toBe(true)
  })
})
