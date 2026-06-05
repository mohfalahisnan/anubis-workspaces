import { describe, it, expect } from 'vitest'
import { XenovaEmbedder } from '../../src/embedding/xenova-embedder.js'
import { cosine } from '../../src/embedding/vector.js'

// Downloads the model on first run; opt in with RUN_MODEL_TESTS=1.
const run = process.env.RUN_MODEL_TESTS ? describe : describe.skip

run('XenovaEmbedder (real model)', () => {
  it('produces 384-dim vectors where related text is closer than unrelated', async () => {
    const e = new XenovaEmbedder()
    const a = await e.embed('skincare routine for sensitive skin')
    const b = await e.embed('gentle skincare for sensitive skin')
    const c = await e.embed('how to fix a car engine')
    expect(a).toHaveLength(384)
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c))
  }, 120_000)
})
