import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundledModelCacheDir } from '../../src/embedding/model-path.js'

const ENV = 'ANUBIS_MODELS_DIR'

describe('bundledModelCacheDir', () => {
  const original = process.env[ENV]

  afterEach(() => {
    if (original === undefined) delete process.env[ENV]
    else process.env[ENV] = original
  })

  it('prefers ANUBIS_MODELS_DIR when set (packaged Electron resources/models)', () => {
    const resourcesModels = join('opt', 'Anubis', 'resources', 'models')
    process.env[ENV] = resourcesModels
    expect(bundledModelCacheDir()).toBe(resourcesModels)
  })

  it('falls back to the package-relative models/ dir when unset (dev/tsx/test)', () => {
    delete process.env[ENV]
    // tests/embedding and src/embedding sit at the same depth under the package
    // root, so this mirrors what model-path.ts computes from its own location.
    const expected = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'models')
    expect(bundledModelCacheDir()).toBe(expected)
  })
})
