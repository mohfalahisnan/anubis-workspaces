import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Resolve the vendored model cache dir (package-relative). Works from both
 * src (dev/tsx) and dist, since `models/` sits at the package root beside both.
 * The packaged-app (electron asar/resources) path is wired by the caller — see
 * the design doc §9 open item.
 */
export function bundledModelCacheDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', 'models')
}
