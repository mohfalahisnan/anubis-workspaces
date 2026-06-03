import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hasCredentials,
  copyHomeFromSystem,
  copyProfileHome,
  CREDENTIAL_FILE,
} from '../../src/profiles/agent-home.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'anubis-agent-home-'))
})

describe('hasCredentials', () => {
  it('returns false when the profile home does not exist', () => {
    expect(hasCredentials('p1', 'claude', root)).toBe(false)
  })

  it('returns false when the home exists but the marker file does not', () => {
    mkdirSync(join(root, 'p1', 'claude'), { recursive: true })
    expect(hasCredentials('p1', 'claude', root)).toBe(false)
  })

  it('returns true when the marker file exists', () => {
    const home = join(root, 'p1', 'claude')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, CREDENTIAL_FILE.claude), '{}')
    expect(hasCredentials('p1', 'claude', root)).toBe(true)
  })

  it('uses the codex-specific marker file', () => {
    const home = join(root, 'p1', 'codex')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, CREDENTIAL_FILE.codex), '{}')
    expect(hasCredentials('p1', 'codex', root)).toBe(true)
  })
})

describe('copyHomeFromSystem', () => {
  it('returns copied:false when the system source does not exist', () => {
    const r = copyHomeFromSystem({
      systemSource: join(root, 'nonexistent'),
      profileId: 'p1',
      agent: 'claude',
      agentHomeRoot: root,
    })
    expect(r.copied).toBe(false)
  })

  it('copies the system tree into the profile home and returns true', () => {
    const src = join(root, 'system-claude')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, CREDENTIAL_FILE.claude), '{"token":"abc"}')
    writeFileSync(join(src, 'config.json'), '{}')
    const r = copyHomeFromSystem({
      systemSource: src,
      profileId: 'p1',
      agent: 'claude',
      agentHomeRoot: root,
    })
    expect(r.copied).toBe(true)
    const destCreds = join(root, 'p1', 'claude', CREDENTIAL_FILE.claude)
    expect(readFileSync(destCreds, 'utf8')).toContain('abc')
  })

  it('no-ops if the destination already has credentials', () => {
    const src = join(root, 'system-claude')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, CREDENTIAL_FILE.claude), '{"token":"new"}')
    const destHome = join(root, 'p1', 'claude')
    mkdirSync(destHome, { recursive: true })
    writeFileSync(join(destHome, CREDENTIAL_FILE.claude), '{"token":"existing"}')
    const r = copyHomeFromSystem({
      systemSource: src,
      profileId: 'p1',
      agent: 'claude',
      agentHomeRoot: root,
    })
    expect(r.copied).toBe(false)
    expect(readFileSync(join(destHome, CREDENTIAL_FILE.claude), 'utf8')).toContain('existing')
  })
})

describe('copyProfileHome', () => {
  it('copies one profile home to another', () => {
    const src = join(root, 'src-id', 'claude')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, CREDENTIAL_FILE.claude), '{"id":"orig"}')
    const r = copyProfileHome({
      srcProfileId: 'src-id',
      destProfileId: 'dst-id',
      agent: 'claude',
      agentHomeRoot: root,
    })
    expect(r.copied).toBe(true)
    const destCreds = join(root, 'dst-id', 'claude', CREDENTIAL_FILE.claude)
    expect(existsSync(destCreds)).toBe(true)
  })

  it('returns copied:false when the source has no home', () => {
    const r = copyProfileHome({
      srcProfileId: 'src-empty',
      destProfileId: 'dst-id',
      agent: 'claude',
      agentHomeRoot: root,
    })
    expect(r.copied).toBe(false)
  })
})
