import { existsSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * Recursively collect every `.md` file under `root`, skipping symlinks (both
 * symlinked files and directories) so a link can never escape the workspace or
 * cause an infinite walk. Returns `[]` when `root` does not exist.
 */
export function walkMarkdown(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) out.push(...walkMarkdown(path))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') out.push(path)
  }
  return out
}
