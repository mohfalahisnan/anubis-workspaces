import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppConfigService } from '../src/config/app-config.js'

let dataDir: string

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

describe('AppConfigService extensionSecret', () => {
  it('auto-generates a 64-hex-char secret on first construction', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'anubis-cfg-'))
    const svc = new AppConfigService(dataDir)
    const cfg = svc.get()
    expect(cfg.extensionSecret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('preserves the secret across construction (no clobber)', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'anubis-cfg-'))
    const first = new AppConfigService(dataDir).get().extensionSecret
    const second = new AppConfigService(dataDir).get().extensionSecret
    expect(second).toBe(first)
  })
})
