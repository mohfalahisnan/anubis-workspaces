import { describe, expect, it } from 'vitest'
import { TextGenerator, GeneratorRegistry } from '../../src/content-generation/generators.js'
import type { GenerationTask } from '@anubis/shared'

const task = (over: Partial<GenerationTask> = {}): GenerationTask => ({
  id: 't1', contentId: 'c1', projectId: 'default', type: 'final_caption', capability: 'text',
  generator: '', inputPrompt: 'hello caption', status: 'pending', retryCount: 0, createdAt: 1, updatedAt: 1, ...over,
})

describe('TextGenerator', () => {
  it('carries the input prompt forward as output text', async () => {
    const out = await new TextGenerator().generate(task(), { contentId: 'c1', assetDir: '/tmp' })
    expect(out.text).toBe('hello caption')
  })
})

describe('GeneratorRegistry', () => {
  it('resolves a generator by capability, returns undefined for unmapped', () => {
    const reg = new GeneratorRegistry([new TextGenerator()])
    expect(reg.get('text')?.name).toBe('carry-forward-text')
    expect(reg.get('video')).toBeUndefined()
  })
})
