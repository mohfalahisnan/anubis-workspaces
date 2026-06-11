import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { LOGIN_PROFILE_PORT, PUBLIC_PROFILE_PORT } from '@anubis/research-crawler'
import type { AppConfig } from '@anubis/conversation'

/**
 * The three Chrome profiles, as one source of truth. `login`/`public` capture
 * Instagram (headed-authenticated / headless-anonymous); `flow` drives Google
 * Flow. Every route that accepts a profile validates against this schema rather
 * than re-declaring the enum, so the set can never drift between routes.
 */
export const crawlerProfileSchema = z.enum(['login', 'public', 'flow'])
export type CrawlerProfileName = z.infer<typeof crawlerProfileSchema>

type ChromeInput = {
  profileDir?: string
  [key: string]: unknown
}

const PROFILE_DIRS: Record<CrawlerProfileName, string> = {
  login: 'chrome-profile-login',
  public: 'chrome-profile-public',
  flow: 'chrome-profile-flow',
}

const LEGACY_LOGIN_PROFILE_DIR = 'chrome-profile'

/**
 * Reuse Chrome profiles from a standalone research-crawler checkout when
 * configured. The setting accepts either:
 * - the project root: D:/.../research-crawler
 * - its data dir:    D:/.../research-crawler/data
 * - a direct profile dir, e.g. .../chrome-profile-login
 */
export function withCrawlerProfileDefaults<T extends ChromeInput>(
  input: T,
  profile: CrawlerProfileName,
  config: AppConfig,
  appDataDir?: string,
): T {
  if (input.profileDir?.trim()) return input
  const profileDir = appDataDir
    ? resolveAppCrawlerProfileDir(appDataDir, profile)
    : resolveCrawlerProfileDir(config.crawlerProfileRoot, profile)
  return profileDir ? { ...input, profileDir } : input
}

export function resolveAppCrawlerProfileDir(
  appDataDir: string,
  profile: CrawlerProfileName,
): string {
  return resolve(join(appDataDir, 'chrome-profiles', PROFILE_DIRS[profile]))
}

export function resolveCrawlerProfileDir(
  rawRoot: string | undefined,
  profile: CrawlerProfileName,
): string | undefined {
  const root = rawRoot?.trim()
  if (!root) return undefined

  const absolute = resolve(root)
  const wanted = PROFILE_DIRS[profile]
  const absoluteBasename = basename(absolute).toLowerCase()
  if (
    absoluteBasename === wanted.toLowerCase()
    || (profile === 'login' && absoluteBasename === LEGACY_LOGIN_PROFILE_DIR)
  ) {
    return absolute
  }

  const directFromData = resolve(join(absolute, wanted))
  const legacyLoginFromData = resolve(join(absolute, LEGACY_LOGIN_PROFILE_DIR))

  if (profile === 'login' && shouldUseLegacyLoginProfile(legacyLoginFromData, directFromData)) {
    return legacyLoginFromData
  }

  if (existsSync(directFromData) || basename(absolute).toLowerCase() === 'data') {
    return directFromData
  }

  const nestedFromProject = resolve(join(absolute, 'data', wanted))
  const legacyLoginFromProject = resolve(join(absolute, 'data', LEGACY_LOGIN_PROFILE_DIR))
  if (profile === 'login' && shouldUseLegacyLoginProfile(legacyLoginFromProject, nestedFromProject)) {
    return legacyLoginFromProject
  }

  return nestedFromProject
}

function shouldUseLegacyLoginProfile(legacyProfileDir: string, targetProfileDir: string): boolean {
  if (!existsSync(legacyProfileDir)) return false
  if (hasInstagramAuthCookie(targetProfileDir)) return false
  return true
}

function hasInstagramAuthCookie(profileDir: string): boolean {
  for (const cookiePath of [
    join(profileDir, 'Default', 'Network', 'Cookies'),
    join(profileDir, 'Network', 'Cookies'),
  ]) {
    if (!existsSync(cookiePath)) continue
    try {
      const content = readFileSync(cookiePath, 'latin1')
      if (
        content.includes('instagram.com')
        && (content.includes('sessionid') || content.includes('ds_user_id'))
      ) {
        return true
      }
    } catch {
      // Chrome can lock cookie stores while a profile is open. If the active
      // profile cannot be read, leave resolution to the explicit path checks.
    }
  }
  return false
}

/**
 * Resolve the profile for an Instagram *capture*. An explicit profile wins;
 * otherwise the remote-debugging port decides, defaulting to the anonymous
 * `public` profile. The port comparison uses the crawler's canonical
 * {@link LOGIN_PROFILE_PORT}, so the backend and crawler cannot disagree on
 * which port means which profile.
 */
export function inferCaptureProfile(
  profile: CrawlerProfileName | undefined,
  port: number | undefined,
): CrawlerProfileName {
  if (profile) return profile
  return port === LOGIN_PROFILE_PORT ? 'login' : 'public'
}

/**
 * Resolve the profile for competitor *discovery*. Defaults to the logged-in
 * `login` profile unless the port points at the anonymous `public` one
 * ({@link PUBLIC_PROFILE_PORT}).
 */
export function inferDiscoverProfile(
  profile: CrawlerProfileName | undefined,
  port: number | undefined,
): CrawlerProfileName {
  if (profile) return profile
  return port === PUBLIC_PROFILE_PORT ? 'public' : 'login'
}
