import type { GenerationProfileConfig } from '@anubis/shared'

/**
 * Per-field generation-profile precedence: project override → global config →
 * undefined. The `undefined` is deliberate — the caller (enqueue) applies the
 * built-in `'manual'` default, while the generators apply their own codex-* fallback.
 */
export function resolveGenerationProfiles(
  project: GenerationProfileConfig | undefined,
  global: GenerationProfileConfig | undefined,
): GenerationProfileConfig {
  return { image: project?.image ?? global?.image, video: project?.video ?? global?.video }
}
