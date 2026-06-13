import { describe, expect, it } from 'vitest'
import { readSection, writeSections } from '../../src/documents/markdown-sections.js'

describe('Markdown document sections', () => {
  it('ignores matching headings inside fenced code blocks', () => {
    const body = [
      '## Draft',
      '',
      'Before the example.',
      '',
      '```md',
      '## Draft',
      'Inside the example.',
      '```',
      '',
      'After the example.',
      '',
      '## Notes',
      '',
      'Keep this note.',
    ].join('\n')

    expect(readSection(body, 'Draft')).toContain('Before the example.')
    expect(readSection(body, 'Draft')).toContain('## Draft\nInside the example.')

    const updated = writeSections(body, { Draft: 'Replacement draft.' })
    expect(updated).toContain('## Draft\n\nReplacement draft.')
    expect(updated).toContain('## Notes\n\nKeep this note.')
    expect(updated).not.toContain('Inside the example.')
  })

  it('ignores headings inside tilde fences', () => {
    const body = '## Notes\n\nVisible\n\n~~~md\n## Notes\nHidden\n~~~\n'
    expect(readSection(body, 'Notes')).toContain('## Notes\nHidden')
  })
})
