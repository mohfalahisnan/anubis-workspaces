import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import matter from 'gray-matter'
import { unzipSync } from 'fflate'
import type { SkillSource } from './types.js'

/* ============================================================
   Skill import.

   Copies a SKILL.md-bearing skill into the user skills tree so
   the SkillLoader picks it up. The category decides which root
   (and therefore which source/behavior) it lands in:

     - 'auto'   → {userSkillsRoot}/auto-inject  → source user-auto
     - 'opt-in' → {userSkillsRoot}/opt-in       → source user-opt-in
     - 'user'   → {userSkillsRoot}              → source user

   Source can be a directory (folder import) or a .zip file. Both
   must contain exactly one SKILL.md (either at the root or one
   level down). The skill name comes from the SKILL.md frontmatter
   `name`, falling back to the containing folder name.
   ============================================================ */

const SKILL_FILE = 'SKILL.md'

export type SkillCategory = 'auto' | 'opt-in' | 'user'

const CATEGORY_SOURCE: Record<SkillCategory, SkillSource> = {
  auto: 'user-auto',
  'opt-in': 'user-opt-in',
  user: 'user',
}

export interface ImportSkillOpts {
  /** Absolute path to a folder or a .zip file. */
  sourcePath: string
  kind: 'folder' | 'zip'
  category: SkillCategory
  /** Root of the user skills tree, e.g. {dataDir}/skills. */
  userSkillsRoot: string
}

export interface ImportSkillResult {
  name: string
  source: SkillSource
  /** Absolute path the skill was written to. */
  dest: string
}

export class SkillImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillImportError'
  }
}

function destRootFor(userSkillsRoot: string, category: SkillCategory): string {
  switch (category) {
    case 'auto':
      return join(userSkillsRoot, 'auto-inject')
    case 'opt-in':
      return join(userSkillsRoot, 'opt-in')
    case 'user':
      return userSkillsRoot
  }
}

/** Derive a skill name from SKILL.md frontmatter, falling back to a folder name. */
function skillName(skillMd: string, fallback: string): string {
  const data = matter(skillMd).data as Record<string, unknown>
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const chosen = name || fallback
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(chosen)) {
    throw new SkillImportError(
      `Invalid skill name "${chosen}". Use letters, numbers, dot, dash or underscore.`,
    )
  }
  return chosen
}

/**
 * In a tree (folder or unzipped archive), find the directory that directly
 * contains a SKILL.md. Accepts the root itself or a single subdirectory.
 */
function findSkillDir(root: string): { dir: string; skillMd: string } {
  const rootFile = join(root, SKILL_FILE)
  if (existsSync(rootFile) && statSync(rootFile).isFile()) {
    return { dir: root, skillMd: readFileSync(rootFile, 'utf8') }
  }
  const subdirs = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory())
  const only = subdirs.length === 1 ? subdirs[0] : undefined
  if (only) {
    const dir = join(root, only.name)
    const file = join(dir, SKILL_FILE)
    if (existsSync(file) && statSync(file).isFile()) {
      return { dir, skillMd: readFileSync(file, 'utf8') }
    }
  }
  throw new SkillImportError(
    `No ${SKILL_FILE} found. Expected it at the top level or inside a single subfolder.`,
  )
}

/** Write an unzipped entry map to disk under `target`, guarding traversal. */
function extractZip(bytes: Uint8Array, target: string): void {
  const entries = unzipSync(bytes)
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue // directory entry
    // Reject absolute paths and any traversal outside the target.
    const rel = normalize(name)
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || rel.startsWith(sep)) {
      throw new SkillImportError(`Unsafe path in zip: ${name}`)
    }
    const out = join(target, rel)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, data)
  }
}

export function importSkill(opts: ImportSkillOpts): ImportSkillResult {
  if (!existsSync(opts.sourcePath)) {
    throw new SkillImportError(`Source does not exist: ${opts.sourcePath}`)
  }

  // Stage the incoming content into a temp dir alongside the destination so
  // we can validate it before committing, then move it into place.
  const stage = join(destRootFor(opts.userSkillsRoot, opts.category), `.import-${Date.now()}`)
  mkdirSync(stage, { recursive: true })
  try {
    if (opts.kind === 'zip') {
      const bytes = readFileSync(opts.sourcePath)
      extractZip(new Uint8Array(bytes), stage)
    } else {
      if (!statSync(opts.sourcePath).isDirectory()) {
        throw new SkillImportError('Folder import requires a directory.')
      }
      cpSync(opts.sourcePath, stage, { recursive: true })
    }

    const { dir, skillMd } = findSkillDir(stage)
    const fallback = dir === stage ? baseName(opts.sourcePath) : baseName(dir)
    const name = skillName(skillMd, fallback)

    const dest = join(destRootFor(opts.userSkillsRoot, opts.category), name)
    if (existsSync(dest)) {
      throw new SkillImportError(`A skill named "${name}" already exists in this category.`)
    }
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(dir, dest, { recursive: true })
    return { name, source: CATEGORY_SOURCE[opts.category], dest }
  } finally {
    rmStage(stage)
  }
}

function baseName(p: string): string {
  // strip trailing slashes, drop any .zip extension, take the last segment
  const trimmed = p.replace(/[\\/]+$/, '')
  const seg = trimmed.split(/[\\/]/).pop() ?? 'skill'
  return seg.replace(/\.zip$/i, '')
}

function rmStage(stage: string): void {
  try {
    rmSync(stage, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
}
