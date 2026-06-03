import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { importSkill, SkillImportError } from '../../src/skills/import.js'
import { SkillLoader } from '../../src/skills/loader.js'

let root: string
let userSkillsRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'anubis-skill-import-'))
  userSkillsRoot = join(root, 'skills')
  mkdirSync(userSkillsRoot, { recursive: true })
})

const SKILL_MD = '---\nname: my-skill\ndescription: A test skill.\n---\n\nBody.\n'

function makeFolder(): string {
  const dir = join(root, 'incoming', 'my-skill')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), SKILL_MD)
  writeFileSync(join(dir, 'helper.js'), 'export const x = 1')
  return dir
}

describe('importSkill — folder', () => {
  it('copies a folder into the auto-inject root and is discoverable', () => {
    const r = importSkill({
      sourcePath: makeFolder(),
      kind: 'folder',
      category: 'auto',
      userSkillsRoot,
    })
    expect(r.name).toBe('my-skill')
    expect(r.source).toBe('user-auto')
    expect(existsSync(join(userSkillsRoot, 'auto-inject', 'my-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(userSkillsRoot, 'auto-inject', 'my-skill', 'helper.js'))).toBe(true)

    const loader = new SkillLoader({
      autoInject: join(root, 'nope-a'),
      optIn: join(root, 'nope-o'),
      user: userSkillsRoot,
      userAutoInject: join(userSkillsRoot, 'auto-inject'),
      userOptIn: join(userSkillsRoot, 'opt-in'),
    })
    expect(loader.byName('my-skill')?.source).toBe('user-auto')
  })

  it('routes opt-in and user categories to their roots', () => {
    const opt = importSkill({ sourcePath: makeFolder(), kind: 'folder', category: 'opt-in', userSkillsRoot })
    expect(opt.source).toBe('user-opt-in')
    expect(existsSync(join(userSkillsRoot, 'opt-in', 'my-skill', 'SKILL.md'))).toBe(true)

    const usr = importSkill({ sourcePath: makeFolder(), kind: 'folder', category: 'user', userSkillsRoot })
    expect(usr.source).toBe('user')
    expect(existsSync(join(userSkillsRoot, 'my-skill', 'SKILL.md'))).toBe(true)
  })

  it('refuses to clobber an existing skill in the same category', () => {
    importSkill({ sourcePath: makeFolder(), kind: 'folder', category: 'auto', userSkillsRoot })
    expect(() =>
      importSkill({ sourcePath: makeFolder(), kind: 'folder', category: 'auto', userSkillsRoot }),
    ).toThrow(SkillImportError)
  })

  it('rejects a folder without a SKILL.md', () => {
    const dir = join(root, 'empty')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.md'), 'nope')
    expect(() =>
      importSkill({ sourcePath: dir, kind: 'folder', category: 'user', userSkillsRoot }),
    ).toThrow(SkillImportError)
  })
})

describe('importSkill — zip', () => {
  function makeZip(entries: Record<string, string>): string {
    const data: Record<string, Uint8Array> = {}
    for (const [k, v] of Object.entries(entries)) data[k] = strToU8(v)
    const bytes = zipSync(data)
    const path = join(root, 'skill.zip')
    writeFileSync(path, bytes)
    return path
  }

  it('extracts a zip with SKILL.md at the root', () => {
    const r = importSkill({
      sourcePath: makeZip({ 'SKILL.md': SKILL_MD, 'helper.js': 'x' }),
      kind: 'zip',
      category: 'opt-in',
      userSkillsRoot,
    })
    expect(r.name).toBe('my-skill')
    expect(existsSync(join(userSkillsRoot, 'opt-in', 'my-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(userSkillsRoot, 'opt-in', 'my-skill', 'helper.js'))).toBe(true)
  })

  it('extracts a zip nested under a single folder', () => {
    const r = importSkill({
      sourcePath: makeZip({ 'my-skill/SKILL.md': SKILL_MD }),
      kind: 'zip',
      category: 'user',
      userSkillsRoot,
    })
    expect(r.name).toBe('my-skill')
    expect(existsSync(join(userSkillsRoot, 'my-skill', 'SKILL.md'))).toBe(true)
  })

  it('rejects zip entries that traverse outside the target', () => {
    expect(() =>
      importSkill({
        sourcePath: makeZip({ '../evil.txt': 'pwned', 'SKILL.md': SKILL_MD }),
        kind: 'zip',
        category: 'user',
        userSkillsRoot,
      }),
    ).toThrow(SkillImportError)
  })
})
