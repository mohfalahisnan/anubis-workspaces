import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Resolve the vendored model cache dir for offline embedding.
 *
 * In the packaged Electron app the model is shipped to `resources/models` (via
 * electron-builder `extraResources`), which sits outside the asar — the
 * package-relative path below would point inside the asar where the model isn't.
 * The Electron main process forwards the real location to the backend child
 * through `ANUBIS_MODELS_DIR`, so prefer that when present.
 *
 * Otherwise fall back to the package-relative `models/` dir, which works from
 * both src (dev/tsx) and dist since `models/` sits at the package root beside both.
 */
export function bundledModelCacheDir(): string {
  const fromEnv = process.env.ANUBIS_MODELS_DIR
  if (fromEnv) return fromEnv
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', 'models')
}
