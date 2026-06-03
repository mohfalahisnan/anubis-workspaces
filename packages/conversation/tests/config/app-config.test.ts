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
