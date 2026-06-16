import type { GenerationProfileConfig, PipelineStepProfileConfig } from '@anubis/shared'
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
     - competitorLevels:     follower-count bands for the Black/
                             Green/Yellow/Red badge. Dropped
                             silently if the invariant
                             0 < minActive < greenMax < yellowMax
                             < maxActive is not satisfied.

   Persisted as a flat object; partial PATCHes merge. Empty
   strings collapse to "unset" for clean form-clear behaviour.
   ============================================================ */

export interface CompetitorLevelsConfig {
  minActive: number
  greenMax: number
  yellowMax: number
  maxActive: number
}

export interface MultiplierBand {
  min: number
  good: number
}

export interface LevelMultipliersConfig {
  green: MultiplierBand
  yellow: MultiplierBand
  red: MultiplierBand
}

export interface AppConfig {
  chromePath?: string
  crawlerProfileRoot?: string
  competitorLevels?: CompetitorLevelsConfig
  levelMultipliers?: LevelMultipliersConfig
  engineBinaryPath?: string
  extractorBinaryPath?: string
  enableNotifications?: boolean
  enableContextInjection?: boolean
  contextInjectionProfileId?: string
  /** Whether the prompt-injection details card is shown in conversations. Defaults to true. */
  showPromptInjectionCard?: boolean
  /** Qoder personal access token stored in settings. */
  qoderApiKey?: string
  /** Project-level AI profile assignments for Content Studio pipeline steps. */
  pipelineStepProfiles?: PipelineStepProfileConfig
  /** AI profile assignments for Content Studio generation (image / video). */
  generationProfiles?: GenerationProfileConfig
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
      // Apply sanitize so boolean defaults (e.g. showPromptInjectionCard) hold
      // on a fresh install where no config.json exists yet.
      this.cache = sanitize({})
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
  const engineBinaryPath = typeof obj.engineBinaryPath === 'string' ? obj.engineBinaryPath.trim() : ''
  if (engineBinaryPath) out.engineBinaryPath = engineBinaryPath
  const extractorBinaryPath = typeof obj.extractorBinaryPath === 'string' ? obj.extractorBinaryPath.trim() : ''
  if (extractorBinaryPath) out.extractorBinaryPath = extractorBinaryPath
  const levels = sanitizeLevels(obj.competitorLevels)
  if (levels) out.competitorLevels = levels
  const multipliers = sanitizeMultipliers(obj.levelMultipliers)
  if (multipliers) out.levelMultipliers = multipliers

  if (typeof obj.enableNotifications === 'boolean') {
    out.enableNotifications = obj.enableNotifications
  } else if (obj.enableNotifications === undefined) {
    out.enableNotifications = true
  }

  if (typeof obj.enableContextInjection === 'boolean') {
    out.enableContextInjection = obj.enableContextInjection
  } else if (obj.enableContextInjection === undefined) {
    out.enableContextInjection = false
  }

  const contextInjectionProfileId = typeof obj.contextInjectionProfileId === 'string' ? obj.contextInjectionProfileId.trim() : ''
  if (contextInjectionProfileId) {
    out.contextInjectionProfileId = contextInjectionProfileId
  }

  if (typeof obj.showPromptInjectionCard === 'boolean') {
    out.showPromptInjectionCard = obj.showPromptInjectionCard
  } else if (obj.showPromptInjectionCard === undefined) {
    out.showPromptInjectionCard = true
  }

  const qoderApiKey = typeof obj.qoderApiKey === 'string' ? obj.qoderApiKey.trim() : ''
  if (qoderApiKey) out.qoderApiKey = qoderApiKey

  const pipelineStepProfiles = sanitizeStepProfiles(obj.pipelineStepProfiles)
  if (pipelineStepProfiles) out.pipelineStepProfiles = pipelineStepProfiles

  const generationProfiles = sanitizeGenerationProfiles(obj.generationProfiles)
  if (generationProfiles) out.generationProfiles = generationProfiles

  return out
}

function sanitizeGenerationProfiles(raw: unknown): GenerationProfileConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: GenerationProfileConfig = {}
  if (typeof r.image === 'string' && r.image) out.image = r.image
  if (typeof r.video === 'string' && r.video) out.video = r.video
  return Object.keys(out).length ? out : undefined
}

function sanitizeStepProfiles(raw: unknown): PipelineStepProfileConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: PipelineStepProfileConfig = {}
  if (typeof r.brief === 'string' && r.brief) out.brief = r.brief
  if (typeof r.refine === 'string' && r.refine) out.refine = r.refine
  if (typeof r.ai_review === 'string' && r.ai_review) out.ai_review = r.ai_review
  return Object.keys(out).length ? out : undefined
}

function sanitizeLevels(raw: unknown): CompetitorLevelsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const minActive = toPositiveInt(r.minActive)
  const greenMax = toPositiveInt(r.greenMax)
  const yellowMax = toPositiveInt(r.yellowMax)
  const maxActive = toPositiveInt(r.maxActive)
  if (
    minActive === undefined ||
    greenMax === undefined ||
    yellowMax === undefined ||
    maxActive === undefined
  ) {
    return undefined
  }
  if (!(minActive < greenMax && greenMax < yellowMax && yellowMax < maxActive)) {
    return undefined
  }
  return { minActive, greenMax, yellowMax, maxActive }
}

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  const i = Math.floor(n)
  return i > 0 ? i : undefined
}

function sanitizeMultipliers(raw: unknown): LevelMultipliersConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const green = sanitizeBand(r.green)
  const yellow = sanitizeBand(r.yellow)
  const red = sanitizeBand(r.red)
  if (!green || !yellow || !red) return undefined
  return { green, yellow, red }
}

function sanitizeBand(raw: unknown): MultiplierBand | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const min = toPositiveNumber(r.min)
  const good = toPositiveNumber(r.good)
  if (min === undefined || good === undefined) return undefined
  if (!(min < good)) return undefined
  return { min, good }
}

function toPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return n > 0 ? n : undefined
}
