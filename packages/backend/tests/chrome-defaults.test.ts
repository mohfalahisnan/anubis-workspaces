import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LOGIN_PROFILE_PORT, PUBLIC_PROFILE_PORT, FLOW_PROFILE_PORT } from '@anubis/research-crawler'
import {
  crawlerProfileSchema,
  inferCaptureProfile,
  inferDiscoverProfile,
  resolveAppCrawlerProfileDir,
  resolveCrawlerProfileDir,
} from '../src/chrome-defaults.js'

describe('crawler Chrome profile defaults', () => {
  it('stores default crawler profiles inside the app data dir', () => {
    const dataDir = resolve(join(tmpdir(), 'anubis-app-data'))
    expect(resolveAppCrawlerProfileDir(dataDir, 'login')).toBe(
      resolve(join(dataDir, 'chrome-profiles', 'chrome-profile-login')),
    )
    expect(resolveAppCrawlerProfileDir(dataDir, 'public')).toBe(
      resolve(join(dataDir, 'chrome-profiles', 'chrome-profile-public')),
    )
    expect(resolveAppCrawlerProfileDir(dataDir, 'flow')).toBe(
      resolve(join(dataDir, 'chrome-profiles', 'chrome-profile-flow')),
    )
  })

  it('uses the authenticated legacy login profile from a crawler project root', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'anubis-crawler-root-'))
    try {
      writeCookieStore(
        join(projectRoot, 'data', 'chrome-profile', 'Default', 'Network', 'Cookies'),
        'instagram.com sessionid ds_user_id',
      )
      writeCookieStore(
        join(projectRoot, 'data', 'chrome-profile-login', 'Default', 'Network', 'Cookies'),
        'instagram.com csrftoken',
      )

      expect(resolveCrawlerProfileDir(projectRoot, 'login')).toBe(
        resolve(join(projectRoot, 'data', 'chrome-profile')),
      )
      expect(resolveCrawlerProfileDir(projectRoot, 'public')).toBe(
        resolve(join(projectRoot, 'data', 'chrome-profile-public')),
      )
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

describe('crawler profile schema (single source of truth)', () => {
  it('accepts the three profiles and rejects anything else', () => {
    expect(crawlerProfileSchema.options).toEqual(['login', 'public', 'flow'])
    expect(crawlerProfileSchema.safeParse('login').success).toBe(true)
    expect(crawlerProfileSchema.safeParse('flow').success).toBe(true)
    expect(crawlerProfileSchema.safeParse('nope').success).toBe(false)
  })
})

describe('port-based profile inference', () => {
  it('honours an explicit profile regardless of port', () => {
    expect(inferCaptureProfile('flow', LOGIN_PROFILE_PORT)).toBe('flow')
    expect(inferDiscoverProfile('flow', PUBLIC_PROFILE_PORT)).toBe('flow')
  })

  it('captures default to public, login only on the login port', () => {
    expect(inferCaptureProfile(undefined, LOGIN_PROFILE_PORT)).toBe('login')
    expect(inferCaptureProfile(undefined, PUBLIC_PROFILE_PORT)).toBe('public')
    expect(inferCaptureProfile(undefined, FLOW_PROFILE_PORT)).toBe('public')
    expect(inferCaptureProfile(undefined, undefined)).toBe('public')
  })

  it('discovery defaults to login, public only on the public port', () => {
    expect(inferDiscoverProfile(undefined, PUBLIC_PROFILE_PORT)).toBe('public')
    expect(inferDiscoverProfile(undefined, LOGIN_PROFILE_PORT)).toBe('login')
    expect(inferDiscoverProfile(undefined, undefined)).toBe('login')
  })
})

function writeCookieStore(path: string, content: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
