import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'

/* -----------------------------------------------------------
   Local system introspection
   -----------------------------------------------------------
   GET /system/chrome-profiles
     Walks the standard Chrome user-data directory for the
     current platform and returns the profiles installed
     locally — Default + every 'Profile N' subdir that holds
     real Chrome state. Profile display names come from the
     'Local State' JSON's profile.info_cache so the picker
     reads as "Profile 3 · Falah" instead of "Profile 3".
   ----------------------------------------------------------- */

export interface ChromeProfileInfo {
  /** Subdirectory name as Chrome stores it ('Default', 'Profile 3', …). */
  directory: string
  /** Human-friendly name from Local State, falling back to `directory`. */
  name: string
  /** Absolute path — what we save to AppConfig.loginProfileDir. */
  path: string
  /**
   * GAIA / email if Local State exposed one — useful disambiguation
   * on machines with multiple work profiles.
   */
  email?: string
}

export interface ChromeProfilesPayload {
  /** Whether the standard Chrome user-data dir exists at all. */
  ok: boolean
  /** The platform-detected user-data directory (or null if unknown). */
  userDataDir: string | null
  /** Detected profiles, ordered Default-first then numerically. */
  profiles: ChromeProfileInfo[]
}

interface LocalStateProfileCache {
  name?: string
  user_name?: string
  gaia_name?: string
  gaia_id?: string
  shortcut_name?: string
}

interface LocalState {
  profile?: {
    info_cache?: Record<string, LocalStateProfileCache>
  }
}

function chromeUserDataDir(): string | null {
  const home = homedir()
  switch (platform()) {
    case 'win32': {
      const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
      return join(local, 'Google', 'Chrome', 'User Data')
    }
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome')
    case 'linux':
      return join(home, '.config', 'google-chrome')
    default:
      return null
  }
}

function readLocalState(userDataDir: string): LocalState {
  const file = join(userDataDir, 'Local State')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LocalState
  } catch {
    return {}
  }
}

function isProfileDir(entry: string): boolean {
  return entry === 'Default' || /^Profile \d+$/.test(entry)
}

function listProfiles(): ChromeProfilesPayload {
  const userDataDir = chromeUserDataDir()
  if (!userDataDir || !existsSync(userDataDir)) {
    return { ok: false, userDataDir, profiles: [] }
  }

  const infoCache = readLocalState(userDataDir).profile?.info_cache ?? {}

  const profiles: ChromeProfileInfo[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(userDataDir)
  } catch {
    return { ok: true, userDataDir, profiles: [] }
  }

  for (const entry of entries) {
    if (!isProfileDir(entry)) continue
    const full = join(userDataDir, entry)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    // "Preferences" is the canonical marker that a profile dir actually
    // holds Chrome state; skip incidentally-named empty folders.
    if (!existsSync(join(full, 'Preferences'))) continue

    const meta = infoCache[entry] ?? {}
    const name =
      meta.name?.trim() ||
      meta.shortcut_name?.trim() ||
      meta.gaia_name?.trim() ||
      entry
    profiles.push({
      directory: entry,
      name,
      path: full,
      email: meta.user_name?.trim() || undefined,
    })
  }

  profiles.sort((a, b) => {
    if (a.directory === 'Default') return -1
    if (b.directory === 'Default') return 1
    const an = Number(a.directory.replace('Profile ', ''))
    const bn = Number(b.directory.replace('Profile ', ''))
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.directory.localeCompare(b.directory)
  })

  return { ok: true, userDataDir, profiles }
}

export const systemRoutes = new Hono()

systemRoutes.get('/chrome-profiles', (c) => {
  // payload.ok = whether the standard user-data dir actually exists;
  // we return that directly so the frontend can distinguish "Chrome
  // isn't installed" from "Chrome is installed but no profiles inside".
  return c.json(listProfiles())
})
