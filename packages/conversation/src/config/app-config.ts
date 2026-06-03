import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/* ============================================================
   Application-level configuration
   ============================================================
   Lives at {dataDir}/config.json. Holds per-machine knobs the
   user can tweak at runtime:

     - chromePath:           optional path to chrome.exe (when
                             not on PATH)
     - extensionSecret:      shared secret for the Anubis Chrome
                             extension. Auto-generated on first
                             construction.
     - extensionPort:        WS port the backend bound to
                             (47891–47900). Persisted so the
                             extension can probe-and-find.
     - extensionPairedAt:    epoch ms of the most recent
                             successful extension `hello`.

   Persisted as a flat object; partial PATCHes merge. Empty
   strings collapse to "unset" for clean form-clear behaviour.
   ============================================================ */

export interface AppConfig {
  chromePath?: string
  extensionSecret?: string
  extensionPort?: number
  extensionPairedAt?: number
}

const CONFIG_FILE = 'config.json'

export class AppConfigService {
  private readonly path: string
  private cache: AppConfig | null = null

  constructor(dataDir: string) {
    this.path = join(dataDir, CONFIG_FILE)
    // Auto-generate the extension secret on first run so the user
    // can paste it into the extension Options page without us ever
    // having a code path where it's missing.
    const current = this.get()
    if (!current.extensionSecret) {
      this.update({ extensionSecret: randomHex(32) })
    }
  }

  get(): AppConfig {
    if (this.cache) return this.cache
    if (!existsSync(this.path)) {
      this.cache = {}
      return this.cache
    }
    try {
      const raw = readFileSync(this.path, 'utf8')
      this.cache = sanitize(JSON.parse(raw) as Record<string, unknown>)
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  update(patch: Partial<AppConfig>): AppConfig {
    const merged = sanitize({ ...this.get(), ...patch })
    writeFileSync(this.path, JSON.stringify(merged, null, 2))
    this.cache = merged
    return merged
  }
}

function sanitize(obj: Record<string, unknown>): AppConfig {
  const out: AppConfig = {}
  const chromePath = typeof obj.chromePath === 'string' ? obj.chromePath.trim() : ''
  if (chromePath) out.chromePath = chromePath
  const secret = typeof obj.extensionSecret === 'string' ? obj.extensionSecret.trim() : ''
  if (/^[0-9a-f]{32,}$/i.test(secret)) out.extensionSecret = secret
  if (typeof obj.extensionPort === 'number' && obj.extensionPort > 0 && obj.extensionPort < 65536) {
    out.extensionPort = Math.floor(obj.extensionPort)
  }
  if (typeof obj.extensionPairedAt === 'number' && obj.extensionPairedAt > 0) {
    out.extensionPairedAt = Math.floor(obj.extensionPairedAt)
  }
  return out
}

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
