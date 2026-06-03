import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/* ============================================================
   Application-level configuration
   ============================================================
   Lives at {dataDir}/config.json and stores per-machine knobs
   the user can change at runtime. Today it just holds two
   Chrome-related fields used by the research-crawler:

     - loginProfileDir: which Chrome user-data dir to launch
       when a flow asks for the 'login' profile (e.g. the
       user's Profile 3 where they're already signed into IG)
     - chromePath:     optional path to chrome.exe / Chrome
       binary if it's not on PATH

   Both are persisted as a flat object; partial PATCHes merge.
   Empty strings collapse to "unset" so the form can clear
   values cleanly.
   ============================================================ */

export interface AppConfig {
  chromePath?: string
  loginProfileDir?: string
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
  const loginProfileDir =
    typeof obj.loginProfileDir === 'string' ? obj.loginProfileDir.trim() : ''
  if (chromePath) out.chromePath = chromePath
  if (loginProfileDir) out.loginProfileDir = loginProfileDir
  return out
}
