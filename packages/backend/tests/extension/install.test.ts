import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureExtensionInstalled } from '../../src/extension/install.js'

let tmp: string, bundle: string, dest: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'anubis-install-'))
  bundle = join(tmp, 'bundle'); dest = join(tmp, 'dest')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(bundle, 'background.js'), 'console.log("bg")')
})
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('ensureExtensionInstalled', () => {
  it('copies the bundle to dest on first run + writes the version stamp', () => {
    const r = ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    expect(r.installed).toBe(true)
    expect(r.installedVersion).toBe('1.2.3')
    expect(readFileSync(join(dest, 'background.js'), 'utf8')).toContain('bg')
    expect(readFileSync(join(dest, '.anubis-version'), 'utf8')).toBe('1.2.3')
  })
  it('skips re-copy when stamp matches', () => {
    ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    writeFileSync(join(dest, 'background.js'), 'mutated')
    const r2 = ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    expect(r2.installed).toBe(false)
    expect(readFileSync(join(dest, 'background.js'), 'utf8')).toBe('mutated')
  })
  it('re-copies when stamp differs', () => {
    ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version: '1.2.4' }))
    const r = ensureExtensionInstalled({ bundleDir: bundle, destDir: dest })
    expect(r.installed).toBe(true)
    expect(r.installedVersion).toBe('1.2.4')
  })
  it('returns installed=false when bundleDir is missing', () => {
    const r = ensureExtensionInstalled({ bundleDir: join(tmp, 'does-not-exist'), destDir: dest })
    expect(r.installed).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })
})
