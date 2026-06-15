import { describe, expect, it } from 'vitest'
import { buildCodexTurnInput } from '../../../src/agents/codex/run.js'

describe('buildCodexTurnInput', () => {
  it('returns just the text item with no files', () => {
    expect(buildCodexTurnInput('hi')).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('appends a localImage item per image file', () => {
    const out = buildCodexTurnInput('hi', ['/a/0.jpg', '/a/notes.txt', '/a/1.PNG'])
    expect(out).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'localImage', path: '/a/0.jpg' },
      { type: 'localImage', path: '/a/1.PNG' },
    ])
  })
})
