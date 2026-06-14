import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hasCredentials,
  copyHomeFromSystem,
  copyProfileHome,
  envFor,
  writeProfileInstructions,
  writeProfileSkills,
  CREDENTIAL_FILE,
} from '../../src/profiles/agent-home.js'
import type { SkillDefinition } from '../../src/skills/types.js'

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

  it('always reports antigravity as authed (creds live in the OS keyring, not a file)', () => {
    // No file is planted and the home does not exist — agy auth is global.
    expect(hasCredentials('p1', 'antigravity', root)).toBe(true)
  })

  it('reports qoder as authed (auth is a personal access token / qodercli session, not a home file)', () => {
    // qoder has no entry in CREDENTIAL_FILE; hasCredentials must not pass
    // `undefined` to join(), and must not gate on a per-profile home file.
    expect(hasCredentials('p1', 'qoder', root)).toBe(true)
  })
})

describe('envFor', () => {
  it('injects the per-agent config-dir env var', () => {
    expect(envFor('claude', '/home/p')).toEqual({ CLAUDE_CONFIG_DIR: '/home/p' })
    expect(envFor('codex', '/home/p')).toEqual({ CODEX_HOME: '/home/p' })
    expect(envFor('antigravity', '/home/p')).toEqual({ GEMINI_DIR: '/home/p' })
  })

  it('injects no config-dir env for SDK/browser agents (qoder, gpt-web, qwen-web)', () => {
    expect(envFor('qoder', '/home/p')).toEqual({})
    expect(envFor('gpt-web', '/home/p')).toEqual({})
    expect(envFor('qwen-web', '/home/p')).toEqual({})
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

describe('writeProfileInstructions', () => {
  it('writes CLAUDE.md + GEMINI.md with the content and AGENTS.md as a pointer', () => {
    const home = join(root, 'p1', 'claude')
    const wrote = writeProfileInstructions(home, 'Be terse. Always cite sources.')
    expect(wrote).toBe(true)

    const claude = readFileSync(join(home, 'CLAUDE.md'), 'utf8')
    const agents = readFileSync(join(home, 'AGENTS.md'), 'utf8')
    const gemini = readFileSync(join(home, 'GEMINI.md'), 'utf8')

    expect(claude).toContain('Be terse. Always cite sources.')
    // agy reads GEMINI.md, so it carries the full content (like CLAUDE.md).
    expect(gemini).toContain('Be terse. Always cite sources.')
    // AGENTS.md must NOT duplicate the instructions; it just points to CLAUDE.md
    expect(agents).not.toContain('Be terse')
    expect(agents.toLowerCase()).toContain('claude.md')
  })

  it('is idempotent on identical content', () => {
    const home = join(root, 'p1', 'claude')
    expect(writeProfileInstructions(home, 'rule X')).toBe(true)
    // Second call with same content: nothing to do.
    expect(writeProfileInstructions(home, 'rule X')).toBe(false)
  })

  it('overwrites when content changes', () => {
    const home = join(root, 'p1', 'claude')
    writeProfileInstructions(home, 'rule X')
    writeProfileInstructions(home, 'rule Y')
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toContain('rule Y')
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).not.toContain('rule X')
  })

  it('removes the files when content goes empty', () => {
    const home = join(root, 'p1', 'codex')
    writeProfileInstructions(home, 'rule X')
    expect(existsSync(join(home, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(home, 'AGENTS.md'))).toBe(true)

    const changed = writeProfileInstructions(home, undefined)
    expect(changed).toBe(true)
    expect(existsSync(join(home, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(home, 'AGENTS.md'))).toBe(false)
  })

  it('creates the home dir if missing', () => {
    const home = join(root, 'fresh', 'claude')
    expect(existsSync(home)).toBe(false)
    writeProfileInstructions(home, 'hello')
    expect(existsSync(join(home, 'CLAUDE.md'))).toBe(true)
  })
})

describe('writeProfileSkills', () => {
  // Build a skill on disk in a source dir and return its SkillDefinition.
  function makeSkill(name: string, body: string, extraFiles: Record<string, string> = {}): SkillDefinition {
    const srcDir = join(root, 'src-skills', name)
    mkdirSync(srcDir, { recursive: true })
    const file = join(srcDir, 'SKILL.md')
    writeFileSync(file, body)
    for (const [rel, content] of Object.entries(extraFiles)) {
      writeFileSync(join(srcDir, rel), content)
    }
    return { name, description: '', source: 'user', path: file, body }
  }

  it('materialises each skill under .agents/skills/<name>/ including helper files', () => {
    const home = join(root, 'p1', 'claude')
    const a = makeSkill('alpha', '# Alpha', { 'run.js': 'console.log(1)' })
    const changed = writeProfileSkills(home, [a])
    expect(changed).toBe(true)
    expect(readFileSync(join(home, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('# Alpha')
    expect(existsSync(join(home, '.agents', 'skills', 'alpha', 'run.js'))).toBe(true)
  })

  it('is idempotent when skill bodies are unchanged', () => {
    const home = join(root, 'p1', 'claude')
    const a = makeSkill('alpha', '# Alpha')
    expect(writeProfileSkills(home, [a])).toBe(true)
    expect(writeProfileSkills(home, [a])).toBe(false)
  })

  it('prunes skill dirs that are no longer active', () => {
    const home = join(root, 'p1', 'claude')
    const a = makeSkill('alpha', '# Alpha')
    const b = makeSkill('beta', '# Beta')
    writeProfileSkills(home, [a, b])
    expect(existsSync(join(home, '.agents', 'skills', 'beta'))).toBe(true)

    const changed = writeProfileSkills(home, [a])
    expect(changed).toBe(true)
    expect(existsSync(join(home, '.agents', 'skills', 'beta'))).toBe(false)
    expect(existsSync(join(home, '.agents', 'skills', 'alpha'))).toBe(true)
  })

  it('re-copies when a skill body changes', () => {
    const home = join(root, 'p1', 'claude')
    writeProfileSkills(home, [makeSkill('alpha', '# Alpha v1')])
    const changed = writeProfileSkills(home, [makeSkill('alpha', '# Alpha v2')])
    expect(changed).toBe(true)
    expect(readFileSync(join(home, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('# Alpha v2')
  })
})
