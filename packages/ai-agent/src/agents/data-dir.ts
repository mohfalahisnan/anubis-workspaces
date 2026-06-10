import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Per-machine Anubis data dir. Mirrors the resolution the Electron main
 * process uses when it sets ANUBIS_DATA_DIR for the packaged backend, so
 * the same paths work when the backend runs standalone (dev / tests).
 */
export function getDataDir(): string {
  if (process.env.ANUBIS_DATA_DIR) return process.env.ANUBIS_DATA_DIR
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'Anubis', 'anubis')
  }
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'anubis')
  const home = homedir()
  return home ? join(home, '.local', 'share', 'anubis') : join(tmpdir(), 'anubis')
}
