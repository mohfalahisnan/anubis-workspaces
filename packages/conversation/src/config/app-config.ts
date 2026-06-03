import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/* ============================================================
   Application-level configuration
   ============================================================
   Lives at {dataDir}/config.json. Holds per-machine knobs the
   user can tweak at runtime:

     - chromePath:           optional path to chrome.exe (when
                             not on PATH)
     - crawlerProfileRoot:   optional research-crawler project/data
                             root to reuse Chrome profiles from a
                             standalone crawler checkout.

   Persisted as a flat object; partial PATCHes merge. Empty
   strings collapse to "unset" for clean form-clear behaviour.
   ============================================================ */

export interface AppConfig {
  chromePath?: string
  crawlerProfileRoot?: string
}

const CONFIG_FILE = 'config.json'

export class AppConfigService {
  private readonly path: string
  private cache: AppConfig | null = null

  constructor(dataDir: string) {
    this.path = join(dataDir, CONFIG_FILE)
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
  const crawlerProfileRoot = typeof obj.crawlerProfileRoot === 'string' ? obj.crawlerProfileRoot.trim() : ''
  if (crawlerProfileRoot) out.crawlerProfileRoot = crawlerProfileRoot
  return out
}
