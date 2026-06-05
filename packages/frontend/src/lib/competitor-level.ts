import type {
  CompetitorLevel,
  CompetitorLevelOverride,
  CompetitorLevelsConfig,
} from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, effectiveLevel } from '@anubis/shared'

/** Tier colors, shared by every surface that conveys a competitor level. */
export const LEVEL_COLOR: Record<CompetitorLevel, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  red: '#B5483E',
  black: '#1B1D22',
  unknown: '#6B6F78',
}

/** The level actually shown for a competitor (manual override wins over followers). */
export function resolveLevel(
  followers: number | null | undefined,
  levelOverride: CompetitorLevelOverride | null | undefined,
  config?: CompetitorLevelsConfig,
): CompetitorLevel {
  return effectiveLevel(levelOverride, followers, config ?? DEFAULT_COMPETITOR_LEVELS)
}

/**
 * Background wash carrying the level color. `card` sits over the solid card
 * surface; `row` is translucent so it composes with table striping/selection.
 */
export function levelTint(level: CompetitorLevel, surface: 'card' | 'row'): string {
  const pct = surface === 'card' ? '10%' : '8%'
  const base = surface === 'card' ? 'var(--card)' : 'transparent'
  return `color-mix(in oklab, ${LEVEL_COLOR[level]} ${pct}, ${base})`
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return n.toLocaleString()
}

/** Hover text describing the level — kept now that the visible dot is gone. */
export function levelTip(
  followers: number | null | undefined,
  levelOverride: CompetitorLevelOverride | null | undefined,
  config?: CompetitorLevelsConfig,
): string {
  const cfg = config ?? DEFAULT_COMPETITOR_LEVELS
  if (levelOverride) return `Manually set — ${levelOverride}`
  const level = resolveLevel(followers, levelOverride, cfg)
  if (level === 'unknown') return 'No follower count yet — capture to see level'
  if (level === 'black') {
    if (followers != null && followers < cfg.minActive) {
      return `Too small — under ${formatK(cfg.minActive)} followers`
    }
    return `Too big — over ${formatK(cfg.maxActive)} followers`
  }
  if (level === 'green') return `Green — ${formatK(cfg.minActive)}–${formatK(cfg.greenMax)} followers`
  if (level === 'yellow') return `Yellow — ${formatK(cfg.greenMax)}–${formatK(cfg.yellowMax)} followers`
  return `Red — ${formatK(cfg.yellowMax)}–${formatK(cfg.maxActive)} followers`
}
