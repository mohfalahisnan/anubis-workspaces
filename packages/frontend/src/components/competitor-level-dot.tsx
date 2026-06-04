import type { CompetitorLevel, CompetitorLevelOverride, CompetitorLevelsConfig } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, levelFor } from '@anubis/shared'
import { cn } from '@/lib/utils'

const LEVEL_COLOR: Record<CompetitorLevel, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  red: '#B5483E',
  black: '#1B1D22',
  unknown: '#6B6F78',
}

interface Props {
  followers: number | null | undefined
  levelOverride?: CompetitorLevelOverride | null
  config?: CompetitorLevelsConfig
  size?: 'sm' | 'md'
  className?: string
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return n.toLocaleString()
}

function tooltipFor(
  level: CompetitorLevel,
  followers: number | null | undefined,
  cfg: CompetitorLevelsConfig,
): string {
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

export function CompetitorLevelDot({ followers, levelOverride, config, size = 'sm', className }: Props) {
  const cfg = config ?? DEFAULT_COMPETITOR_LEVELS
  const level = levelOverride ?? levelFor(followers, cfg)
  const tip = levelOverride
    ? `Manually set — ${levelOverride}`
    : tooltipFor(level, followers, cfg)
  const dim = size === 'md' ? 10 : 8
  return (
    <span
      aria-label={tip}
      title={tip}
      data-level={level}
      className={cn('inline-block shrink-0 rounded-full ring-1 ring-black/20', className)}
      style={{
        background: LEVEL_COLOR[level],
        width: dim,
        height: dim,
      }}
    />
  )
}
