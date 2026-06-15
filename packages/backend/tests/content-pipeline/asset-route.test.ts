import { describe, expect, it } from 'vitest'
import { resolveItemAssetPath } from '../../src/content-items.js'

describe('resolveItemAssetPath', () => {
  const dataDir = '/data'

  it('resolves a plain filename within the item assets dir', () => {
    // `path.resolve` drive-prefixes on Windows (C:/data/…), so assert on the
    // relative tail rather than an exact absolute path.
    const p = resolveItemAssetPath(dataDir, 'c1', '0.jpg')
    expect(p?.replace(/\\/g, '/')).toMatch(/\/data\/content-pipeline\/c1\/assets\/0\.jpg$/)
  })

  it('rejects path traversal', () => {
    expect(resolveItemAssetPath(dataDir, 'c1', '../../etc/passwd')).toBeNull()
    expect(resolveItemAssetPath(dataDir, 'c1', '/etc/passwd')).toBeNull()
    expect(resolveItemAssetPath(dataDir, 'c1', 'sub/0.jpg')).toBeNull()
  })

  it('rejects non-image extensions', () => {
    expect(resolveItemAssetPath(dataDir, 'c1', 'video.mp4')).toBeNull()
    expect(resolveItemAssetPath(dataDir, 'c1', 'notes.txt')).toBeNull()
  })
})
