import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from '@anubis/ai-agent'
import type { ProfileConfig, ProfileOverride, ResolvedProfile } from './types.js'

function mergeConfig(base: ProfileConfig | undefined, patch: ProfileOverride | undefined): ProfileConfig {
  const merged: Partial<ProfileConfig> = { ...(base ?? {}) }
  if (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v
    }
  }
  return merged as ProfileConfig
}

export function resolveLayers(layers: Array<ProfileConfig | ProfileOverride | undefined>): ResolvedProfile {
  let acc: ProfileConfig | undefined
  for (const layer of layers) {
    if (!layer) continue
    acc = mergeConfig(acc, layer)
  }
  if (!acc || !acc.agent) {
    throw new Error('Profile resolution failed: agent is required')
  }
  if (!acc.model) acc.model = DEFAULT_MODEL[acc.agent]
  if (!acc.reasoningEffort) acc.reasoningEffort = DEFAULT_REASONING_EFFORT
  return acc as ResolvedProfile
}
