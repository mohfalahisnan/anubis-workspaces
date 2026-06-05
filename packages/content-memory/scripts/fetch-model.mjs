import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pipeline, env } from '@xenova/transformers'

// Download into the package-local models/ dir at BUILD time (network here only).
const here = dirname(fileURLToPath(import.meta.url))
env.cacheDir = join(here, '..', 'models')
env.allowRemoteModels = true

await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
console.log('vendored model →', env.cacheDir)
