import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

// Resolve the package root so profile dirs (`data/chrome-profile-*`) land in
// the right place regardless of `process.cwd()` when the backend imports the
// crawler package.
const PKG_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

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
    dir = overrideDir
  } else if (existsSync(targetDir)) {
    dir = targetDir
  } else if (name === 'login' && existsSync(legacyDir)) {
    dir = legacyDir
    usedLegacyDir = true
  } else {
    dir = targetDir
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
  const dir = name === 'login'
    ? LOGIN_PROFILE_DIR
    : name === 'public'
      ? PUBLIC_PROFILE_DIR
      : FLOW_PROFILE_DIR
  return resolve(join(PKG_ROOT, dir))
}
