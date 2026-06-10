import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'

// Resolve the package root so profile dirs (`data/chrome-profile-*`) land in
// the right place regardless of `process.cwd()` when the MCP server is spawned
// by a host application.
//
// Two runtime contexts:
//   - ESM (dev / pnpm build dist)  — import.meta.url is a valid file:// URL.
//     The source/compiled file sits at <root>/src|dist/core/chrome/, so go 3 up.
//   - CJS bundle (Node SEA via esbuild) — esbuild sets import.meta to {}, so
//     import.meta.url is undefined (falsy). Anchor to process.execPath which
//     points to the executable inside <root>/release/. One level up is the root.
const PKG_ROOT = import.meta.url
  ? resolve(fileURLToPath(new URL('../../../', import.meta.url)))
  : resolve(dirname(process.execPath), '..')

export type ProfileName = 'login' | 'public' | 'flow'

export type ResolvedProfile = {
  name: ProfileName
  dir: string
  port: number
  defaultHeadless: boolean
}

export type ResolveProfileInput = {
  name?: ProfileName
  fallback: ProfileName
  overrideDir?: string
  overridePort?: number
}

export const LOGIN_PROFILE_DIR = 'data/chrome-profile-login'
export const PUBLIC_PROFILE_DIR = 'data/chrome-profile-public'
export const FLOW_PROFILE_DIR = 'data/chrome-profile-flow'
export const LEGACY_PROFILE_DIR = 'data/chrome-profile'

export const LOGIN_PROFILE_PORT = 9222
export const PUBLIC_PROFILE_PORT = 9223
export const FLOW_PROFILE_PORT = 9224

export type ResolveProfileResult = {
  profile: ResolvedProfile
  usedLegacyDir: boolean
}

export function resolveProfile(input: ResolveProfileInput): ResolveProfileResult {
  const name = input.name ?? input.fallback
  const overrideDir = input.overrideDir?.trim() ? resolve(input.overrideDir.trim()) : ''
  const targetDir = defaultDirFor(name)
  const legacyDir = resolve(join(PKG_ROOT, LEGACY_PROFILE_DIR))
  let dir: string
  let usedLegacyDir = false
  if (overrideDir) {
    dir = seedFromPackageDir(name, overrideDir)
  } else if (existsSync(targetDir)) {
    dir = targetDir
  } else if (name === 'login' && existsSync(legacyDir)) {
    dir = legacyDir
    usedLegacyDir = true
  } else {
    dir = seedFromPackageDir(name, targetDir)
  }
  const port = input.overridePort ?? defaultPortFor(name)
  return {
    profile: {
      name,
      dir,
      port,
      defaultHeadless: name === 'public'
    },
    usedLegacyDir
  }
}

export function defaultPortFor(name: ProfileName): number {
  if (name === 'login') return LOGIN_PROFILE_PORT
  if (name === 'public') return PUBLIC_PROFILE_PORT
  return FLOW_PROFILE_PORT
}

export function defaultDirFor(name: ProfileName): string {
  // Anchor profiles to the host app's data dir when it provides one (same
  // layout as the backend's resolveAppCrawlerProfileDir). Profiles must not
  // live under the packaged install dir: a Chrome still holding them keeps
  // file locks that block the NSIS installer/updater.
  const dataDir = process.env.ANUBIS_DATA_DIR?.trim()
  if (dataDir) {
    return resolve(join(dataDir, 'chrome-profiles', `chrome-profile-${name}`))
  }
  const dir = name === 'login'
    ? LOGIN_PROFILE_DIR
    : name === 'public'
      ? PUBLIC_PROFILE_DIR
      : FLOW_PROFILE_DIR
  return resolve(join(PKG_ROOT, dir))
}

/**
 * Earlier builds kept profiles under <pkg>/data, which sits inside the
 * packaged install dir. When the resolved dir is a standard chrome-profile-*
 * location that doesn't exist yet but the package-root one does, move the old
 * profile across so logins survive the relocation. If the move fails (profile
 * held open by a running Chrome, cross-volume rename), keep using the old dir
 * so the session keeps working; the next cold start retries the move.
 */
function seedFromPackageDir(name: ProfileName, targetDir: string): string {
  if (basename(targetDir) !== `chrome-profile-${name}`) return targetDir
  if (existsSync(targetDir)) return targetDir
  const packageDir = resolve(join(PKG_ROOT, 'data', `chrome-profile-${name}`))
  const samePath = process.platform === 'win32'
    ? packageDir.toLowerCase() === targetDir.toLowerCase()
    : packageDir === targetDir
  if (samePath || !existsSync(packageDir)) return targetDir
  try {
    mkdirSync(dirname(targetDir), { recursive: true })
    renameSync(packageDir, targetDir)
    return targetDir
  } catch {
    return packageDir
  }
}
