import { describe, it, expect } from 'vitest'
import { extractImageReferencesFromUnknown } from '../src/index.js'

describe('extractImageReferencesFromUnknown', () => {
  it('ignores free-text tool output that merely ends with an image extension', () => {
    // A Bash `ls -la` result line ends in `.png` but is not an image path.
    const result = '-rw-r--r-- 1 User 197121 949284 Jun 11 18:45 ronin-reference.png'
    expect(extractImageReferencesFromUnknown(result)).toEqual([])
  })

  it('ignores prose that ends with an image filename', () => {
    expect(
      extractImageReferencesFromUnknown('Saved the reference to ronin-reference.png'),
    ).toEqual([])
  })

  it('detects a bare single-token image path', () => {
    const refs = extractImageReferencesFromUnknown('/workspace/out/render.png')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.src).toBe('/workspace/out/render.png')
  })

  it('detects a bare https image url', () => {
    const refs = extractImageReferencesFromUnknown('https://example.com/a.png')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.src).toBe('https://example.com/a.png')
  })

  it('detects a data image url', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo='
    const refs = extractImageReferencesFromUnknown(dataUri)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.src).toBe(dataUri)
  })

  it('still detects structured image path fields even when they contain spaces', () => {
    const refs = extractImageReferencesFromUnknown({ path: 'C:\\Users\\My Folder\\image.png' })
    expect(refs).toHaveLength(1)
    expect(refs[0]?.src).toBe('C:\\Users\\My Folder\\image.png')
  })
})
