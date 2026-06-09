import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureWorkspaceStructure } from '../../src/util/workspace.js'

describe('ensureWorkspaceStructure', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'anubis-workspace-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates the entire standardized directory structure and default files', () => {
    ensureWorkspaceStructure(tempDir)

    // Verify system directories exist
    expect(existsSync(join(tempDir, '.agents'))).toBe(true)
    expect(existsSync(join(tempDir, '.codex'))).toBe(true)
    expect(existsSync(join(tempDir, '.claude'))).toBe(true)

    // Verify knowledge subdirectories
    expect(existsSync(join(tempDir, 'knowledge'))).toBe(true)
    expect(existsSync(join(tempDir, 'knowledge/brand'))).toBe(true)
    expect(existsSync(join(tempDir, 'knowledge/product'))).toBe(true)
    expect(existsSync(join(tempDir, 'knowledge/campaigns'))).toBe(true)

    // Verify inbox subdirectories
    expect(existsSync(join(tempDir, 'inbox'))).toBe(true)
    expect(existsSync(join(tempDir, 'inbox/raw'))).toBe(true)

    // Verify outputs subdirectories
    expect(existsSync(join(tempDir, 'outputs'))).toBe(true)
    expect(existsSync(join(tempDir, 'outputs/drafts'))).toBe(true)

    // Verify runtime subdirectories
    expect(existsSync(join(tempDir, 'runtime'))).toBe(true)
    expect(existsSync(join(tempDir, 'runtime/temp'))).toBe(true)

    // Verify datasets subdirectories
    expect(existsSync(join(tempDir, 'datasets'))).toBe(true)
    expect(existsSync(join(tempDir, 'datasets/snapshots'))).toBe(true)

    // Verify default files exist and have correct contents
    const anubisignore = readFileSync(join(tempDir, '.anubisignore'), 'utf8')
    expect(anubisignore).toContain('.agents/')
    expect(anubisignore).toContain('runtime/')

    const claudeMd = readFileSync(join(tempDir, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('workspace-level instructions')

    const agentsMd = readFileSync(join(tempDir, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Read [CLAUDE.md](CLAUDE.md)')

    const workspaceMd = readFileSync(join(tempDir, '_workspace.md'), 'utf8')
    expect(workspaceMd).toContain('# Workspace')
  })

  it('does not overwrite existing custom files', () => {
    // Write custom files beforehand
    const customAnubisignore = '# custom ignore file'
    const customClaudeMd = '# custom CLAUDE instructions'
    const customAgentsMd = '# custom AGENTS'
    const customWorkspaceMd = '# custom workspace'

    writeFileSync(join(tempDir, '.anubisignore'), customAnubisignore, 'utf8')
    writeFileSync(join(tempDir, 'CLAUDE.md'), customClaudeMd, 'utf8')
    writeFileSync(join(tempDir, 'AGENTS.md'), customAgentsMd, 'utf8')
    writeFileSync(join(tempDir, '_workspace.md'), customWorkspaceMd, 'utf8')

    ensureWorkspaceStructure(tempDir)

    // Verify they were not overwritten
    expect(readFileSync(join(tempDir, '.anubisignore'), 'utf8')).toBe(customAnubisignore)
    expect(readFileSync(join(tempDir, 'CLAUDE.md'), 'utf8')).toBe(customClaudeMd)
    expect(readFileSync(join(tempDir, 'AGENTS.md'), 'utf8')).toBe(customAgentsMd)
    expect(readFileSync(join(tempDir, '_workspace.md'), 'utf8')).toBe(customWorkspaceMd)
  })
})
