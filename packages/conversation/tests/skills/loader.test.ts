import { describe, it, expect, beforeEach } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SkillLoader } from '../../src/skills/loader.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOTS = {
  autoInject: join(here, '..', 'fixtures', 'skills', 'auto-inject'),
  optIn: join(here, '..', 'fixtures', 'skills', 'opt-in'),
  user: join(here, '..', 'fixtures', 'skills', 'user'),
  userAutoInject: join(here, '..', 'fixtures', 'skills', 'user-auto'),
  userOptIn: join(here, '..', 'fixtures', 'skills', 'user-opt-in'),
}

describe('SkillLoader', () => {
  let loader: SkillLoader
  beforeEach(() => { loader = new SkillLoader(ROOTS) })

  it('discovers skills from all roots with correct sources', () => {
    const all = loader.discoverAll()
    const map = Object.fromEntries(all.map(s => [s.name, s.source]))
    expect(map['sample']).toBe('builtin-auto')
    expect(map['opt-sample']).toBe('builtin-opt-in')
    expect(map['usr-sample']).toBe('user')
    expect(map['usr-auto-sample']).toBe('user-auto')
    expect(map['usr-opt-sample']).toBe('user-opt-in')
  })

  it('parses frontmatter description and body', () => {
    const all = loader.discoverAll()
    const opt = all.find(s => s.name === 'opt-sample')!
    expect(opt.description).toBe('A test opt-in skill.')
    expect(opt.whenToUse).toBe('When the user asks for opt-sample.')
    expect(opt.body.trim()).toBe('Body text for opt-sample.')
  })

  it('byName returns undefined for unknown', () => {
    expect(loader.byName('nope')).toBeUndefined()
  })

  it('reload re-reads disk', () => {
    loader.discoverAll()
    loader.reload()
    expect(loader.discoverAll().length).toBeGreaterThan(0)
  })
})
