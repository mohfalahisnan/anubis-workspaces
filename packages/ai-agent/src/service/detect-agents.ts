import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { extname, join } from 'node:path'

export interface AgentAvailability {
  available: boolean
  path?: string
  /** When `source` is 'env-override' the caller supplied a command via
   *  env var; we trust it without re-checking the path on disk. */
  source: 'detected' | 'env-override'
}

const IS_WIN = platform() === 'win32'
const lookupCmd = IS_WIN ? 'where.exe' : 'which'

/**
 * On Windows, `where.exe` returns every match for a binary across PATH —
 * for an npm-installed CLI that means both the extension-less Unix-style
 * shim (a sh script Node can't execute via `spawn`, → ENOENT) AND the
 * `.cmd` shim that Windows actually runs. Pick the executable one.
 *
 * Order of preference: .cmd > .exe > .bat > .ps1 > anything with an
 * extension > extension-less (worst on Windows). On non-Windows we just
 * take the first match.
 */
function pickBestPath(stdout: string, isWin: boolean): string {
  const paths = stdout.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)
  if (!isWin || paths.length <= 1) return paths[0]!
  const rank = (p: string): number => {
    const ext = extname(p).toLowerCase()
    if (ext === '.cmd') return 0
    if (ext === '.exe') return 1
    if (ext === '.bat') return 2
    if (ext === '.ps1') return 3
    if (ext !== '') return 4
    return 5 // extension-less Unix-style shim — last resort
  }
  return [...paths].sort((a, b) => rank(a) - rank(b))[0]!
}

/** Exposed for unit tests only. */
export const __test__pickBestPath = pickBestPath

function lookup(binary: string): AgentAvailability {
  try {
    const r = spawnSync(lookupCmd, [binary], { encoding: 'utf8', timeout: 2000 })
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      const path = pickBestPath(r.stdout, IS_WIN)
      return { available: true, path, source: 'detected' }
    }
  } catch {
    // swallow — treat any failure as "not detected"
  }
  return { available: false, source: 'detected' }
}

/**
 * Well-known `agy` install locations to probe when it isn't on PATH. The
 * Antigravity installer drops the binary here but does not always add it to
 * PATH (the user must run `agy install`), so a bare `where agy` / `which agy`
 * misses it. Checked only as a fallback after the PATH lookup.
 */
function antigravityFallbackPaths(): string[] {
  const home = homedir()
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [join(localAppData, 'agy', 'bin', 'agy.exe')]
  }
  return [
    join(home, '.local', 'bin', 'agy'),
    join(home, '.agy', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
  ]
}

function lookupAntigravity(): AgentAvailability {
  const onPath = lookup('agy')
  if (onPath.available) return onPath
  for (const p of antigravityFallbackPaths()) {
    if (existsSync(p)) return { available: true, path: p, source: 'detected' }
  }
  return { available: false, source: 'detected' }
}

export function detectAgents(): Record<'claude' | 'codex' | 'antigravity' | 'gpt-web', AgentAvailability> {
  const claudeCmd = process.env.ANUBIS_CLAUDE_COMMAND
  const codexCmd = process.env.ANUBIS_CODEX_COMMAND
  const antigravityCmd = process.env.ANUBIS_ANTIGRAVITY_COMMAND
  return {
    claude: claudeCmd
      ? { available: true, path: claudeCmd, source: 'env-override' }
      : lookup('claude'),
    codex: codexCmd
      ? { available: true, path: codexCmd, source: 'env-override' }
      : lookup('codex'),
    antigravity: antigravityCmd
      ? { available: true, path: antigravityCmd, source: 'env-override' }
      : lookupAntigravity(),
    'gpt-web': { available: true, source: 'detected' },
  }
}
