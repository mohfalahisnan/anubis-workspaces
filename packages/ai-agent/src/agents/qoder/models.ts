import type { ModelInfo, ModelCategory } from '../catalog.js'

/**
 * Subset of the Qoder SDK's `ModelInfo` (see
 * `@qoder-ai/qoder-agent-sdk` → `protocol/common.d.ts`) that we read when
 * mapping the live catalog into our own {@link ModelInfo} shape.
 *
 * The full SDK type carries many more fields (context windows, efforts,
 * thinking config, BYOK creds…); we deliberately depend on only the handful
 * that drive the picker so a wire-shape change elsewhere can't break us.
 */
export interface QoderSdkModel {
  /** Model id to pass back as the `model` option (e.g. `qmodel_latest`). */
  value: string
  /** Human-readable label (e.g. `Qwen3.7-Max`). */
  displayName?: string
  description?: string
  /** Server-designated default for the current scene. */
  isDefault?: boolean
  /** Appears under the "New Models" tab in the Qoder UI. */
  isNew?: boolean
  isFree?: boolean
  isReasoning?: boolean
  /** Accepts multimodal / vision input. */
  isVl?: boolean
  /** Credit multiplier, e.g. `0.6` → 0.60x credit consumption. */
  priceFactor?: number
  /** `'system'` (Qoder catalog) or `'user'` (BYOK). */
  source?: string
  isEnabled?: boolean
}

/** Build the descriptive suffix shown after the model name in the picker. */
function describe(m: QoderSdkModel): string {
  // The SDK already ships a nicely formatted description
  // (e.g. "Reasoning · Vision · New · 0.60x Credit"). Prefer it; only
  // synthesise one if the server omits it.
  if (m.description && m.description.trim()) return m.description.trim()
  const parts: string[] = []
  if (m.isReasoning) parts.push('Reasoning')
  if (m.isVl) parts.push('Vision')
  if (m.isNew) parts.push('New')
  if (typeof m.priceFactor === 'number') parts.push(`${m.priceFactor.toFixed(2)}x Credit`)
  return parts.join(' · ')
}

function categorize(m: QoderSdkModel): ModelCategory {
  // The standard tiers (auto/ultimate/performance/…) are the everyday
  // recommendation; the freshly-shipped named models go under "alternative"
  // so the proven defaults sort first.
  return m.isNew ? 'alternative' : 'recommended'
}

/**
 * Map the live Qoder model catalog (`getAvailableModels()`) into our
 * {@link ModelInfo} list. Disabled models are dropped; `isDefault` /
 * non-new tiers are listed first so the picker leads with the stable
 * defaults, then the newer named models, each preserving server order.
 */
export function mapQoderModels(models: QoderSdkModel[]): ModelInfo[] {
  const usable = models.filter(
    (m) => typeof m.value === 'string' && m.value.trim() !== '' && m.isEnabled !== false,
  )
  const rank = (m: QoderSdkModel): number => (m.isDefault ? 0 : m.isNew ? 2 : 1)
  return usable
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map(({ m }) => ({
      id: m.value,
      category: categorize(m),
      description: describe(m),
      displayName: m.displayName && m.displayName.trim() ? m.displayName.trim() : undefined,
    }))
}
