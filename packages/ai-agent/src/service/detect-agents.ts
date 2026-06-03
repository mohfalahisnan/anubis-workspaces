import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'

export interface AgentAvailability {
  available: boolean
  path?: string
  /** When `source` is 'env-override' the caller supplied a command via
   *  env var; we trust it without re-checking the path on disk. */
  source: 'detected' | 'env-override'
}

const lookupCmd = platform() === 'win32' ? 'where.exe' : 'which'

function lookup(binary: string): AgentAvailability {
  try {
    const r = spawnSync(lookupCmd, [binary], { encoding: 'utf8', timeout: 2000 })
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      const path = r.stdout.split(/\r?\n/)[0]!.trim()
      return { available: true, path, source: 'detected' }
    }
  } catch {
    // swallow — treat any failure as "not detected"
  }
  return { available: false, source: 'detected' }
}

export function detectAgents(): Record<'claude' | 'codex', AgentAvailability> {
  const claudeCmd = process.env.ANUBIS_CLAUDE_COMMAND
  const codexCmd = process.env.ANUBIS_CODEX_COMMAND
  return {
    claude: claudeCmd
      ? { available: true, path: claudeCmd, source: 'env-override' }
      : lookup('claude'),
    codex: codexCmd
      ? { available: true, path: codexCmd, source: 'env-override' }
      : lookup('codex'),
  }
}
