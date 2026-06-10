import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTS, DEFAULT_MODEL, MODELS } from './catalog.js'
import type { Agent, ModelCategory, ModelInfo } from './catalog.js'
import { getDataDir } from './data-dir.js'

/* -----------------------------------------------------------
   User-editable model catalog overrides
   -----------------------------------------------------------
   {dataDir}/models.json lets the user update the model lists
   without waiting for an app release. Shape:

     {
       "models": {
         "claude": [
           { "id": "claude-fable-5", "category": "recommended",
             "description": "Newest frontier model." }
         ]
       },
       "defaultModel": { "claude": "claude-fable-5" }
     }

   A per-agent "models" array REPLACES the built-in list for that
   agent; agents not mentioned keep the shipped catalog. The file
   is read on every catalog() call (it is tiny), so edits take
   effect on the next UI refresh without a backend restart.
   A missing or malformed file falls back to the shipped catalog.
   ----------------------------------------------------------- */

export const MODELS_FILE = 'models.json'

export interface CatalogModels {
  models: Record<Agent, ModelInfo[]>
  defaultModel: Record<Agent, string>
}

const CATEGORIES: readonly ModelCategory[] = [
  'recommended',
  'recommended_research_preview',
  'alternative',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeEntry(raw: unknown): ModelInfo | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null
  const category =
    typeof raw.category === 'string' && (CATEGORIES as readonly string[]).includes(raw.category)
      ? (raw.category as ModelCategory)
      : 'alternative'
  const description = typeof raw.description === 'string' ? raw.description : ''
  return { id: raw.id, category, description }
}

export function applyModelOverrides(base: CatalogModels, raw: unknown): CatalogModels {
  const out: CatalogModels = {
    models: { ...base.models },
    defaultModel: { ...base.defaultModel },
  }
  if (!isRecord(raw)) return out

  if (isRecord(raw.models)) {
    for (const agent of AGENTS) {
      const list = raw.models[agent]
      if (!Array.isArray(list)) continue
      const sanitized = list
        .map(sanitizeEntry)
        .filter((m): m is ModelInfo => m !== null)
      if (sanitized.length > 0) out.models[agent] = sanitized
    }
  }

  if (isRecord(raw.defaultModel)) {
    for (const agent of AGENTS) {
      const value = raw.defaultModel[agent]
      if (typeof value === 'string' && value.trim() !== '') {
        out.defaultModel[agent] = value
      }
    }
  }

  return out
}

export function loadCatalogModels(dataDir: string = getDataDir()): CatalogModels {
  const base: CatalogModels = { models: MODELS, defaultModel: DEFAULT_MODEL }
  let parsed: unknown = null
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, MODELS_FILE), 'utf8'))
  } catch {
    // missing or malformed file → shipped catalog
  }
  return applyModelOverrides(base, parsed)
}
