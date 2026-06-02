import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/* ============================================================
   Per-profile agent home directories.

   Each profile gets its own isolated config/auth/session
   directory at:

     {agentHomeRoot}/{profileId}/{claude|codex}/

   The conversation service ensures the directory exists before
   each turn and injects the canonical env var so the spawned
   CLI reads/writes everything there:

     - codex   → CODEX_HOME
     - claude  → CLAUDE_CONFIG_DIR

   Resetting a profile (e.g. to switch logins) deletes that
   directory; the next run re-creates an empty one.

   `profile.env` always wins over the auto-injected vars so the
   user can override per profile if they need to point at a
   shared identity intentionally.
   ============================================================ */

export interface EnsureResult {
  path: string
  /** True when this call created the directory (no prior state). */
  isNew: boolean
}

export function homePathFor(
  agentHomeRoot: string,
  profileId: string,
  agent: 'claude' | 'codex',
): string {
  return join(agentHomeRoot, profileId, agent)
}

export function ensureAgentHome(
  agentHomeRoot: string,
  profileId: string,
  agent: 'claude' | 'codex',
): EnsureResult {
  const path = homePathFor(agentHomeRoot, profileId, agent)
  if (existsSync(path)) return { path, isNew: false }
  mkdirSync(path, { recursive: true })
  return { path, isNew: true }
}

export function envFor(
  agent: 'claude' | 'codex',
  homePath: string,
): Record<string, string> {
  if (agent === 'codex') return { CODEX_HOME: homePath }
  // Claude Code CLI honours CLAUDE_CONFIG_DIR in recent versions.
  return { CLAUDE_CONFIG_DIR: homePath }
}

export function resetProfileHome(
  agentHomeRoot: string,
  profileId: string,
  agent: 'claude' | 'codex',
): { existed: boolean } {
  const path = homePathFor(agentHomeRoot, profileId, agent)
  if (!existsSync(path)) return { existed: false }
  rmSync(path, { recursive: true, force: true })
  return { existed: true }
}
