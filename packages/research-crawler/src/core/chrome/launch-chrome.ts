import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  defaultDirFor,
  defaultPortFor,
  LEGACY_PROFILE_DIR,
  resolveProfile,
  type ProfileName
} from './profile-resolver.js'

export type LaunchChromeInput = {
  url?: string
  profile?: ProfileName
  profileDir?: string
  remoteDebuggingPort?: number
  chromePath?: string
  headless?: boolean
  forceHeadless?: boolean
}

export type LaunchChromeResult = {
  ok: true
  pid: number | null
  reused: boolean
  remoteDebuggingPort: number
  profile: ProfileName
  profileDir: string
  url: string
  headless: boolean
  warnings: string[]
}

export async function launchChrome(input: LaunchChromeInput = {}): Promise<LaunchChromeResult> {
  const { profile, usedLegacyDir } = resolveProfile({
    name: input.profile,
    fallback: 'login',
    overrideDir: input.profileDir,
    overridePort: input.remoteDebuggingPort
  })

  const headless = resolveHeadless(input, profile)
  if (profile.name === 'login' && headless && !input.forceHeadless) {
    throw new Error('Refusing to launch login profile headless. Pass --force-headless to override (you will not be able to complete login flows).')
  }

  const warnings: string[] = []
  if (usedLegacyDir) {
    warnings.push(`Using legacy profile dir "${LEGACY_PROFILE_DIR}". Run open-chrome --profile ${profile.name} to seed a new dir at ${defaultDirFor(profile.name)}.`)
  }

  const url = input.url?.trim() || 'https://www.instagram.com/'
  const reuse = await probeExistingChrome(profile.port)
  if (reuse.alive) {
    if (reuse.profileDir && !pathsMatch(reuse.profileDir, profile.dir)) {
      throw new Error(`Port ${profile.port} is in use by a Chrome with a different profile dir (${reuse.profileDir}). Use --remote-debugging-port to pick a different port.`)
    }
    return {
      ok: true,
      pid: null,
      reused: true,
      remoteDebuggingPort: profile.port,
      profile: profile.name,
      profileDir: profile.dir,
      url,
      headless,
      warnings
    }
  }

  const chrome = input.chromePath?.trim() || findChromeExecutable()
  if (!chrome) throw new Error('Chrome executable not found. Pass chromePath.')

  await mkdir(profile.dir, { recursive: true })
  const args = [`--remote-debugging-port=${profile.port}`, `--user-data-dir=${profile.dir}`]
  if (headless) args.push('--headless=new', '--disable-gpu')
  args.push(url)
  const child = spawn(chrome, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: headless
  })
  child.unref()

  const deadline = Date.now() + 10000
  let started = false
  while (Date.now() < deadline) {
    const check = await probeExistingChrome(profile.port)
    if (check.alive) {
      started = true
      break
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Chrome process exited immediately with code ${child.exitCode}.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  if (!started) {
    throw new Error(`Chrome started with PID ${child.pid} but failed to open remote debugging port ${profile.port} within 10 seconds.`)
  }

  return {
    ok: true,
    pid: child.pid ?? null,
    reused: false,
    remoteDebuggingPort: profile.port,
    profile: profile.name,
    profileDir: profile.dir,
    url,
    headless,
    warnings
  }
}

function resolveHeadless(input: LaunchChromeInput, profile: { defaultHeadless: boolean }): boolean {
  if (typeof input.headless === 'boolean') return input.headless
  return profile.defaultHeadless
}

async function probeExistingChrome(port: number): Promise<{ alive: boolean; profileDir?: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) })
    if (!response.ok) return { alive: false }
    const payload = (await response.json()) as { 'User-Data-Dir'?: string; userDataDir?: string }
    const profileDir = typeof payload['User-Data-Dir'] === 'string'
      ? payload['User-Data-Dir']
      : typeof payload.userDataDir === 'string'
        ? payload.userDataDir
        : undefined
    return { alive: true, profileDir }
  } catch {
    return { alive: false }
  }
}

function pathsMatch(left: string, right: string): boolean {
  const norm = (value: string) => value.replace(/[\\/]+$/, '').toLowerCase()
  return norm(left) === norm(right)
}

export function findChromeExecutable(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

export function defaultChromeOriginFor(name: ProfileName): string {
  return `http://127.0.0.1:${defaultPortFor(name)}`
}

/**
 * Kill the Chrome process that is listening on the given remote-debugging port.
 * If no Chrome is found on that port, resolves silently.
 */
export async function killChrome(port: number): Promise<void> {
  let pid: number | undefined
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
    if (response.ok) {
      const payload = (await response.json()) as { 'Browser'?: string; 'webSocketDebuggerUrl'?: string }
      // Try to extract pid from the webSocketDebuggerUrl (ws://127.0.0.1:<port>/devtools/browser/<guid>)
      // Chrome doesn't expose pid via /json/version directly, so we kill by port.
      void payload // parsed only to confirm it's a real Chrome
    }
  } catch {
    // Chrome already gone — nothing to do
    return
  }

  // Kill by port: find the pid that owns the TCP port, then kill it.
  try {
    if (process.platform === 'win32') {
      // netstat output: "  TCP    0.0.0.0:9222   ...   <pid>"
      const out = execSync(`netstat -ano -p TCP`, { timeout: 5000 }).toString()
      const regex = new RegExp(`\\s+TCP\\s+[\\d.]+:${port}\\s+[\\d.]+:\\d+\\s+LISTENING\\s+(\\d+)`, 'i')
      const match = regex.exec(out)
      if (match) pid = Number(match[1])
      if (pid) execSync(`taskkill /PID ${pid} /F /T`, { timeout: 5000 })
    } else {
      // lsof: find pids listening on the port
      const out = execSync(`lsof -ti tcp:${port}`, { timeout: 5000 }).toString().trim()
      if (out) {
        for (const rawPid of out.split('\n')) {
          const p = Number(rawPid.trim())
          if (p > 0) process.kill(p, 'SIGKILL')
        }
      }
    }
  } catch {
    // Best-effort — ignore errors during kill
  }
}
