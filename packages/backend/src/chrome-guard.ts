import { killChrome } from '@anubis/research-crawler'

/* -----------------------------------------------------------
   Fresh-launch guard for the login Chrome profile
   -----------------------------------------------------------
   launchChrome inside @anubis/research-crawler reuses an
   existing Chrome on port 9222 when one is alive — good for
   performance between back-to-back captures, bad when that
   existing process was started with a different user-data
   dir than the one we want now. (For example: the user just
   pointed the app at "Profile 3" in Settings but a stale
   crawler-default Chrome is still running on 9222, or an
   older /chrome/open call left one there.)

   Before any login-profile call, probe Chrome on 9222 and
   kill it if its profile dir doesn't match the configured
   one. The subsequent launchChrome call then starts fresh.
   ----------------------------------------------------------- */

export const LOGIN_PROFILE_PORT = 9222

function normalisePath(value: string): string {
  return value.replace(/[\\/]+$/, '').toLowerCase()
}

function pathsMatch(a: string, b: string): boolean {
  return normalisePath(a) === normalisePath(b)
}

async function probeChromeProfile(port: number): Promise<{
  alive: boolean
  profileDir?: string
}> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(700),
    })
    if (!response.ok) return { alive: false }
    const payload = (await response.json()) as { 'User-Data-Dir'?: unknown }
    const dir =
      typeof payload['User-Data-Dir'] === 'string'
        ? (payload['User-Data-Dir'] as string)
        : undefined
    return { alive: true, profileDir: dir }
  } catch {
    return { alive: false }
  }
}

export interface FreshLoginResult {
  /** True when we killed an existing Chrome to make room. */
  killed: boolean
  /** The dir of the Chrome we killed, when we could read it. */
  previousDir?: string
}

export async function ensureFreshLoginChrome(
  expectedDir: string | undefined,
): Promise<FreshLoginResult> {
  if (!expectedDir) return { killed: false }
  const probe = await probeChromeProfile(LOGIN_PROFILE_PORT)
  if (!probe.alive) return { killed: false }
  if (probe.profileDir && pathsMatch(probe.profileDir, expectedDir)) {
    return { killed: false }
  }
  await killChrome(LOGIN_PROFILE_PORT)
  return { killed: true, previousDir: probe.profileDir }
}
