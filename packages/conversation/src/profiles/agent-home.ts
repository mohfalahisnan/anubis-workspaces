import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * The filename inside a profile's home that indicates a usable login session.
 * Encapsulated so a future CLI rename only needs editing here.
 */
export const CREDENTIAL_FILE: Record<'claude' | 'codex', string> = {
  claude: '.credentials.json',
  codex: 'auth.json',
}

export function hasCredentials(
  profileId: string,
  agent: 'claude' | 'codex',
  agentHomeRoot: string,
): boolean {
  const home = homePathFor(agentHomeRoot, profileId, agent)
  return existsSync(join(home, CREDENTIAL_FILE[agent]))
}

export interface CopyHomeOpts {
  systemSource: string
  profileId: string
  agent: 'claude' | 'codex'
  agentHomeRoot: string
}

export function copyHomeFromSystem(opts: CopyHomeOpts): { copied: boolean } {
  const dest = homePathFor(opts.agentHomeRoot, opts.profileId, opts.agent)
  if (hasCredentials(opts.profileId, opts.agent, opts.agentHomeRoot)) {
    return { copied: false }
  }
  if (!existsSync(opts.systemSource)) return { copied: false }
  mkdirSync(dest, { recursive: true })
  cpSync(opts.systemSource, dest, { recursive: true })
  return { copied: true }
}

/* ============================================================
   Profile-level instruction files.

   Instead of re-injecting the same system-prompt + skills block
   into every turn's user prompt (paid in tokens each turn), we
   write the content into the profile's agent home as files that
   Claude / Codex auto-discover when started with
   CLAUDE_CONFIG_DIR / CODEX_HOME pointing here.

   - CLAUDE.md  → the actual content (single source of truth)
   - AGENTS.md  → small pointer ("read CLAUDE.md"); not redundant

   Writes are idempotent: we no-op when content is unchanged.
   ============================================================ */

const CLAUDE_MD = 'CLAUDE.md'
const AGENTS_MD = 'AGENTS.md'
const AGENTS_MD_BODY = '# Agent instructions\n\nRead `CLAUDE.md` for all profile-level instructions and skills.\n'

/**
 * Write (or remove) the profile's instruction files in its agent home.
 * Pass an empty/undefined `content` to delete the files. Returns true
 * when something was actually written or removed (handy for logging
 * or for tests). No-op on equal-content rewrites.
 */
export function writeProfileInstructions(
  homePath: string,
  content: string | undefined,
): boolean {
  mkdirSync(homePath, { recursive: true })
  const claudePath = join(homePath, CLAUDE_MD)
  const agentsPath = join(homePath, AGENTS_MD)

  if (!content || content.trim() === '') {
    let changed = false
    if (existsSync(claudePath)) { rmSync(claudePath, { force: true }); changed = true }
    if (existsSync(agentsPath)) { rmSync(agentsPath, { force: true }); changed = true }
    return changed
  }

  const claudeBody = content.trim() + '\n'
  let changed = false
  if (!existsSync(claudePath) || readFileSync(claudePath, 'utf8') !== claudeBody) {
    writeFileSync(claudePath, claudeBody, 'utf8')
    changed = true
  }
  if (!existsSync(agentsPath) || readFileSync(agentsPath, 'utf8') !== AGENTS_MD_BODY) {
    writeFileSync(agentsPath, AGENTS_MD_BODY, 'utf8')
    changed = true
  }
  return changed
}

export interface CopyProfileHomeOpts {
  srcProfileId: string
  destProfileId: string
  agent: 'claude' | 'codex'
  agentHomeRoot: string
}

export function copyProfileHome(opts: CopyProfileHomeOpts): { copied: boolean } {
  const src = homePathFor(opts.agentHomeRoot, opts.srcProfileId, opts.agent)
  const dest = homePathFor(opts.agentHomeRoot, opts.destProfileId, opts.agent)
  if (!existsSync(src)) return { copied: false }
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  return { copied: true }
}
