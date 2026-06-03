import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The bug we are pinning down: the research-crawler routes used to do
 *   { ...overrides, ...input }
 * which wiped the configured profileDir/chromePath with the
 * present-but-undefined values from the request body. This test mocks
 * the underlying crawler functions and asserts that the resolved input
 * carries the configured Profile path when the caller asked for the
 * 'login' profile and did NOT supply a profileDir of their own.
 */

const launchSpy = vi.fn()
const captureSpy = vi.fn()
const discoverSpy = vi.fn()

vi.mock('@anubis/research-crawler', async () => {
  const actual = await vi.importActual<typeof import('@anubis/research-crawler')>(
    '@anubis/research-crawler',
  )
  return {
    ...actual,
    launchChrome: (input: unknown) => {
      launchSpy(input)
      return Promise.resolve({ ok: true })
    },
    captureInstagramData: (input: unknown) => {
      captureSpy(input)
      return Promise.resolve({
        ok: true,
        schemaVersion: '1.0',
        output: { profiles: [], posts: [] },
        meta: { profileCount: 0, postCount: 0, warnings: [] },
      })
    },
    discoverInstagramCompetitors: (input: unknown) => {
      discoverSpy(input)
      return Promise.resolve({
        ok: true,
        schemaVersion: '1.0',
        output: { profiles: [], posts: [] },
        meta: { profileCount: 0, postCount: 0, warnings: [] },
      })
    },
  }
})

let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-merge-test-'))
  process.env.ANUBIS_DATA_DIR = dataDir

  // Seed the config via the route so we go through the real persistence.
  const { default: app } = await import('../src/app.js')
  await app.request('/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      loginProfileDir: '/fake/User Data/Profile 3',
      chromePath: '/fake/chrome',
    }),
  })
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('crawler route config merge', () => {
  it('chrome/open with profile=login splits the saved path into user-data + profile-directory', async () => {
    const { default: app } = await import('../src/app.js')
    launchSpy.mockClear()
    await app.request('/research-crawler/chrome/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'login' }),
    })
    expect(launchSpy).toHaveBeenCalledTimes(1)
    const arg = launchSpy.mock.calls[0]?.[0] as {
      profileDir?: string
      profileDirectory?: string
      chromePath?: string
    }
    // user-data-dir is the parent of the saved profile path…
    expect(arg.profileDir).toBe('/fake/User Data')
    // …and --profile-directory carries the subdir name so Chrome
    // actually loads Profile 3 instead of creating a blank Default
    // inside it.
    expect(arg.profileDirectory).toBe('Profile 3')
    expect(arg.chromePath).toBe('/fake/chrome')
  })

  it('an explicit profileDir on the request beats the configured one', async () => {
    const { default: app } = await import('../src/app.js')
    launchSpy.mockClear()
    await app.request('/research-crawler/chrome/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'login', profileDir: '/explicit/path' }),
    })
    const arg = launchSpy.mock.calls[0]?.[0] as { profileDir?: string }
    expect(arg.profileDir).toBe('/explicit/path')
  })

  it('profile=public does NOT use the configured loginProfileDir', async () => {
    const { default: app } = await import('../src/app.js')
    launchSpy.mockClear()
    await app.request('/research-crawler/chrome/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'public' }),
    })
    const arg = launchSpy.mock.calls[0]?.[0] as { profileDir?: string; chromePath?: string }
    expect(arg.profileDir).toBeUndefined()
    // chromePath is still applied since it isn't profile-scoped.
    expect(arg.chromePath).toBe('/fake/chrome')
  })

  it('discover with profile=login passes the split user-data + profile-directory pair', async () => {
    const { default: app } = await import('../src/app.js')
    discoverSpy.mockClear()
    await app.request('/research-crawler/instagram/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'explore', profile: 'login', targetCompetitors: 5 }),
    })
    const arg = discoverSpy.mock.calls[0]?.[0] as {
      profileDir?: string
      profileDirectory?: string
    }
    expect(arg.profileDir).toBe('/fake/User Data')
    expect(arg.profileDirectory).toBe('Profile 3')
  })

  it('instagram/capture-profile with profile=login passes the split pair', async () => {
    const { default: app } = await import('../src/app.js')
    captureSpy.mockClear()
    await app.request('/research-crawler/instagram/capture-profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'falah.isnan', profile: 'login' }),
    })
    const arg = captureSpy.mock.calls[0]?.[0] as {
      profileDir?: string
      profileDirectory?: string
    }
    expect(arg.profileDir).toBe('/fake/User Data')
    expect(arg.profileDirectory).toBe('Profile 3')
  })
})
