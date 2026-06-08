import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SkillDefinition } from '../skills/types.js'
import type { AgentKind } from './types.js'

/* ============================================================
   Per-profile agent home directories.

   Each profile gets its own isolated config/auth/session
   directory at:

     {agentHomeRoot}/{profileId}/{claude|codex}/

   The conversation service ensures the directory exists before
   each turn and injects the canonical env var so the spawned
   CLI reads/writes everything there:

     - codex       → CODEX_HOME
     - claude      → CLAUDE_CONFIG_DIR
     - antigravity → GEMINI_DIR (agy is built on the Gemini CLI,
                     whose home is ~/.gemini; see note in `envFor`)

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
  agent: AgentKind,
): string {
  return join(agentHomeRoot, profileId, agent)
}

export function ensureAgentHome(
  agentHomeRoot: string,
  profileId: string,
  agent: AgentKind,
): EnsureResult {
  const path = homePathFor(agentHomeRoot, profileId, agent)
  if (existsSync(path)) return { path, isNew: false }
  mkdirSync(path, { recursive: true })
  return { path, isNew: true }
}

export function envFor(
  agent: AgentKind,
  homePath: string,
): Record<string, string> {
  if (agent === 'codex') return { CODEX_HOME: homePath }
  if (agent === 'gpt-web' || agent === 'qwen-web') return {}
  // The Antigravity CLI (`agy`) is built on the Gemini CLI and relocates its
  // home (config + per-project state under ~/.gemini) via GEMINI_DIR — verified
  // against the agy v1.0.5 binary. This isolates a profile's config/state, but
  // NOT its login: agy keeps credentials in the OS keyring, which is global to
  // the user (see hasCredentials). If a future build renames the var, edit here.
  if (agent === 'antigravity') return { GEMINI_DIR: homePath }
  // Claude Code CLI honours CLAUDE_CONFIG_DIR in recent versions.
  return { CLAUDE_CONFIG_DIR: homePath }
}

export function resetProfileHome(
  agentHomeRoot: string,
  profileId: string,
  agent: AgentKind,
): { existed: boolean } {
  const path = homePathFor(agentHomeRoot, profileId, agent)
  if (!existsSync(path)) return { existed: false }
  rmSync(path, { recursive: true, force: true })
  return { existed: true }
}

/**
 * The filename inside a profile's home that indicates a usable login session.
 * Encapsulated so a future CLI rename only needs editing here. Only the
 * file-based agents (claude, codex) appear here — agy stores its login in the
 * OS keyring, so there is no on-disk marker to look for (see hasCredentials).
 */
export const CREDENTIAL_FILE: Record<'claude' | 'codex', string> = {
  claude: '.credentials.json',
  codex: 'auth.json',
}

export function hasCredentials(
  profileId: string,
  agent: AgentKind,
  agentHomeRoot: string,
): boolean {
  // agy (Antigravity) keeps credentials in the OS keyring (Keychain / Windows
  // Credential Manager / libsecret), not a file under its config dir. There is
  // nothing on disk to detect, so we don't gate antigravity turns on a marker
  // file — auth is handled globally via `agy` login or an API key in the env.
  // Returning true here avoids falsely blocking every run with NoCredentials.
  if (agent === 'antigravity' || agent === 'gpt-web' || agent === 'qwen-web') return true
  const home = homePathFor(agentHomeRoot, profileId, agent)
  return existsSync(join(home, CREDENTIAL_FILE[agent as 'claude' | 'codex']))
}

export interface CopyHomeOpts {
  systemSource: string
  profileId: string
  agent: AgentKind
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
   the CLI auto-discovers when started with CLAUDE_CONFIG_DIR /
   CODEX_HOME / GEMINI_DIR pointing here.

   - CLAUDE.md  → the actual content (single source of truth)
   - AGENTS.md  → small pointer ("read CLAUDE.md"); not redundant
   - GEMINI.md  → the actual content again, for agy/Gemini, which
                  reads GEMINI.md (not CLAUDE.md/AGENTS.md)

   Writes are idempotent: we no-op when content is unchanged.
   ============================================================ */

const CLAUDE_MD = 'CLAUDE.md'
const AGENTS_MD = 'AGENTS.md'
const GEMINI_MD = 'GEMINI.md'
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
  const geminiPath = join(homePath, GEMINI_MD)

  if (!content || content.trim() === '') {
    let changed = false
    if (existsSync(claudePath)) { rmSync(claudePath, { force: true }); changed = true }
    if (existsSync(agentsPath)) { rmSync(agentsPath, { force: true }); changed = true }
    if (existsSync(geminiPath)) { rmSync(geminiPath, { force: true }); changed = true }
    return changed
  }

  const fullBody = content.trim() + '\n'
  let changed = false
  if (!existsSync(claudePath) || readFileSync(claudePath, 'utf8') !== fullBody) {
    writeFileSync(claudePath, fullBody, 'utf8')
    changed = true
  }
  if (!existsSync(agentsPath) || readFileSync(agentsPath, 'utf8') !== AGENTS_MD_BODY) {
    writeFileSync(agentsPath, AGENTS_MD_BODY, 'utf8')
    changed = true
  }
  // agy/Gemini reads GEMINI.md, so it gets the full content (like CLAUDE.md).
  if (!existsSync(geminiPath) || readFileSync(geminiPath, 'utf8') !== fullBody) {
    writeFileSync(geminiPath, fullBody, 'utf8')
    changed = true
  }
  return changed
}

/* ============================================================
   Skill files.

   Rather than inlining every active skill's full body into the
   instruction file (paid in always-on context), we materialise
   each skill as files under `<targetDir>/.agents/skills/<name>/`. The
   instruction file keeps only a short pointer (see
   buildSkillsPointer) that references `.agents/skills/<name>/SKILL.md`.

   We write these into the conversation workspace (the agent's
   cwd), so that relative pointer resolves for every agent —
   Claude and Codex alike — instead of relying on a per-agent
   config-dir auto-scan.

   The directory is kept in sync with the active set each turn:
   stale skill dirs are pruned and changed ones re-copied. Writes
   are skipped when a skill's SKILL.md already matches on disk, so
   the common (unchanged) case touches nothing.
   ============================================================ */

const SKILLS_DIR = join('.agents', 'skills')
const SKILL_FILE = 'SKILL.md'

/**
 * Materialise the given skills under `{targetDir}/.agents/skills/<name>/`,
 * pruning any skill dirs that are no longer in the active set.
 * Returns true when anything was written or removed.
 */
export function writeProfileSkills(
  targetDir: string,
  skills: SkillDefinition[],
): boolean {
  const skillsRoot = join(targetDir, SKILLS_DIR)
  const active = new Map(skills.map(s => [s.name, s]))
  let changed = false

  // Prune skill dirs that are no longer active.
  if (existsSync(skillsRoot)) {
    for (const e of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      if (!active.has(e.name)) {
        rmSync(join(skillsRoot, e.name), { recursive: true, force: true })
        changed = true
      }
    }
  }

  // Copy / refresh each active skill from its source directory.
  for (const skill of skills) {
    const dest = join(skillsRoot, skill.name)
    const destFile = join(dest, SKILL_FILE)
    const srcBody = readFileSync(skill.path, 'utf8')
    if (existsSync(destFile) && readFileSync(destFile, 'utf8') === srcBody) {
      continue // unchanged — leave the dir (and any helper files) alone
    }
    mkdirSync(skillsRoot, { recursive: true })
    rmSync(dest, { recursive: true, force: true })
    cpSync(dirname(skill.path), dest, { recursive: true })
    changed = true
  }

  return changed
}

export interface CopyProfileHomeOpts {
  srcProfileId: string
  destProfileId: string
  agent: AgentKind
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
