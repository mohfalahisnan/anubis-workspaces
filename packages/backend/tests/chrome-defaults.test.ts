import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveAppCrawlerProfileDir, resolveCrawlerProfileDir } from '../src/chrome-defaults.js'

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

function writeCookieStore(path: string, content: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
