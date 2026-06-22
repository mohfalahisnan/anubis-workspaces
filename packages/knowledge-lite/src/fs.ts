import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** ISO-8601 UTC timestamp, seconds precision, e.g. 2026-06-22T10:00:00Z. */
export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Source path relative to sourceRoot, forward-slashed, e.g. "brand/voice.md". */
export function toSourcePath(sourceRoot: string, absPath: string): string {
  return relative(sourceRoot, absPath).split(sep).join('/')
}

/** All *.md files under sourceRoot (recursive), sorted by lowercased relative path. */
export function scanMarkdownFiles(sourceRoot: string): string[] {
  if (!existsSync(sourceRoot)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(abs)
      }
    }
  }
  walk(sourceRoot)
  out.sort((a, b) => toSourcePath(sourceRoot, a).toLowerCase().localeCompare(toSourcePath(sourceRoot, b).toLowerCase()))
  return out
}

/** True when path is a directory (false if it does not exist). */
export function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}
