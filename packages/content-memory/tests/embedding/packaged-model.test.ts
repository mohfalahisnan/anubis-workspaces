import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundledModelCacheDir } from '../../src/embedding/model-path.js'
import { XenovaEmbedder } from '../../src/embedding/xenova-embedder.js'

// Regression guard for issue #12: in the packaged Electron app the vendored
// model lives at resources/models, the Electron main process forwards that path
// via ANUBIS_MODELS_DIR, and the embedder loads it with allowRemoteModels:false.
// This reproduces that exact path: resolve the cache dir from the env var and
// load the model fully offline. Needs the model vendored first
// (`pnpm --filter @anubis/content-memory build`), so it is opt-in via
// RUN_MODEL_TESTS=1 like the sibling real-model test.
const run = process.env.RUN_MODEL_TESTS ? describe : describe.skip

run('packaged model load (offline, ANUBIS_MODELS_DIR)', () => {
  const ENV = 'ANUBIS_MODELS_DIR'
  const original = process.env[ENV]
  // Point at the package-vendored models/ dir to stand in for resources/models.
  const vendored = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'models')

  beforeAll(() => {
    process.env[ENV] = vendored
  })
  afterAll(() => {
    if (original === undefined) delete process.env[ENV]
    else process.env[ENV] = original
  })

  it('resolves the cache dir from ANUBIS_MODELS_DIR and embeds offline', async () => {
    expect(bundledModelCacheDir()).toBe(vendored)
    const embedder = new XenovaEmbedder({
      cacheDir: bundledModelCacheDir(),
      allowRemoteModels: false,
    })
    const vec = await embedder.embed('offline embedding smoke test')
    expect(vec).toHaveLength(384)
  }, 120_000)
})
