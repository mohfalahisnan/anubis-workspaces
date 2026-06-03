import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The detector reads its root from the platform's standard Chrome path.
 * We can't override that without mocks, so this test focuses on the
 * adjacent parsing logic: directory recognition + Local State name
 * resolution. We do this by constructing a fake user-data dir and
 * temporarily exporting it as the working dir, then exercising the
 * route via app.request().
 *
 * NOTE: on Windows CI the standard Chrome dir is under %LOCALAPPDATA%.
 * We temporarily redirect LOCALAPPDATA to a fixture before importing
 * the system module so its homedir-derived paths point at our scratch
 * dir. On macOS / Linux the same trick uses HOME.
 */

const fixtureRoot = mkdtempSync(join(tmpdir(), 'anubis-chrome-fixture-'))

function userDataPath(): string {
  if (process.platform === 'win32') {
    return join(fixtureRoot, 'Google', 'Chrome', 'User Data')
  }
  if (process.platform === 'darwin') {
    return join(fixtureRoot, 'Library', 'Application Support', 'Google', 'Chrome')
  }
  return join(fixtureRoot, '.config', 'google-chrome')
}

beforeAll(() => {
  const userData = userDataPath()
  mkdirSync(userData, { recursive: true })

  // Pretend Local State has a name for Profile 3.
  writeFileSync(
    join(userData, 'Local State'),
    JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: 'Person 1', user_name: 'me@example.com' },
          'Profile 3': { name: 'Falah' },
          'Profile 7': { name: '' },
        },
      },
    }),
  )

  // A valid profile dir needs a 'Preferences' file.
  for (const dir of ['Default', 'Profile 3', 'Profile 7']) {
    mkdirSync(join(userData, dir), { recursive: true })
    writeFileSync(join(userData, dir, 'Preferences'), '{}')
  }

  // Stray folder that looks like a profile but isn't (no Preferences).
  mkdirSync(join(userData, 'Profile 99'), { recursive: true })
  // Unrelated folder that shouldn't be picked up.
  mkdirSync(join(userData, 'Crash Reports'), { recursive: true })

  // Redirect the home / localappdata so the detector finds our fixture.
  if (process.platform === 'win32') {
    process.env.LOCALAPPDATA = fixtureRoot
  } else {
    process.env.HOME = fixtureRoot
    process.env.USERPROFILE = fixtureRoot
  }
})

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('GET /system/chrome-profiles', () => {
  it('lists Default + Profile 3 + Profile 7 (in that order) and skips the empty one', async () => {
    // Import lazily so the redirected env is in effect.
    const { default: app } = await import('../src/app.js')
    const res = await app.request('/system/chrome-profiles')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      userDataDir: string
      profiles: { directory: string; name: string; path: string; email?: string }[]
    }
    expect(body.ok).toBe(true)
    expect(body.userDataDir).toBe(userDataPath())
    expect(body.profiles.map((p) => p.directory)).toEqual([
      'Default',
      'Profile 3',
      'Profile 7',
    ])
    // 'Profile 99' had no Preferences, so it must be skipped.
    expect(body.profiles.map((p) => p.directory)).not.toContain('Profile 99')

    const byDir = Object.fromEntries(body.profiles.map((p) => [p.directory, p]))
    expect(byDir['Default']!.name).toBe('Person 1')
    expect(byDir['Default']!.email).toBe('me@example.com')
    expect(byDir['Profile 3']!.name).toBe('Falah')
    // Empty-string name falls back to the directory name.
    expect(byDir['Profile 7']!.name).toBe('Profile 7')

    // Paths join the user-data dir with the directory name.
    expect(byDir['Profile 3']!.path).toBe(join(userDataPath(), 'Profile 3'))
  })

  // Restore the env we tampered with so other tests run normal.
  afterAll(() => {
    if (process.platform === 'win32') {
      delete process.env.LOCALAPPDATA
    } else {
      process.env.HOME = homedir()
    }
  })
})
