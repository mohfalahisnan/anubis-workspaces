import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/* -----------------------------------------------------------
   First-run install of the bundled extension into
   {ANUBIS_DATA_DIR}/extension/. We copy if either the dir is
   missing, or the version stamp differs.
   ----------------------------------------------------------- */

export interface InstallOpts {
  /** Path to a built extension directory (packages/extension/dist or an electron resources copy). */
  bundleDir: string
  /** Destination root (typically {ANUBIS_DATA_DIR}/extension/). */
  destDir: string
}
export interface InstallResult {
  destDir: string
  installed: boolean
  installedVersion: string | null
}

export function ensureExtensionInstalled(opts: InstallOpts): InstallResult {
  if (!existsSync(opts.bundleDir)) {
    return { destDir: opts.destDir, installed: false, installedVersion: null }
  }
  const bundleVersion = readManifestVersion(join(opts.bundleDir, 'manifest.json'))
  const installedVersion = existsSync(opts.destDir) ? readStamp(opts.destDir) : null

  if (installedVersion === bundleVersion) {
    return { destDir: opts.destDir, installed: false, installedVersion }
  }

  if (existsSync(opts.destDir)) rmSync(opts.destDir, { recursive: true, force: true })
  mkdirSync(opts.destDir, { recursive: true })
  copyTree(opts.bundleDir, opts.destDir)
  writeStamp(opts.destDir, bundleVersion)
  return { destDir: opts.destDir, installed: true, installedVersion: bundleVersion }
}

function readManifestVersion(path: string): string {
  const raw = readFileSync(path, 'utf8')
  const m = JSON.parse(raw) as { version?: string }
  return m.version ?? '0.0.0'
}
function readStamp(dir: string): string | null {
  const path = join(dir, '.anubis-version')
  if (!existsSync(path)) return null
  try { return readFileSync(path, 'utf8').trim() } catch { return null }
}
function writeStamp(dir: string, version: string): void {
  writeFileSync(join(dir, '.anubis-version'), version)
}
function copyTree(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    const srcChild = join(src, entry)
    const destChild = join(dest, entry)
    const st = statSync(srcChild)
    if (st.isDirectory()) {
      mkdirSync(destChild, { recursive: true })
      copyTree(srcChild, destChild)
    } else if (st.isFile()) {
      mkdirSync(dirname(destChild), { recursive: true })
      copyFileSync(srcChild, destChild)
    }
  }
}
