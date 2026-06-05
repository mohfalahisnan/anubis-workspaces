import type { CompetitorLevel, CompetitorLevelOverride, CompetitorLevelsConfig, LevelMultipliersConfig, MultiplierRating } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, DEFAULT_LEVEL_MULTIPLIERS, effectiveLevel, multiplierRatingFor } from '@anubis/shared'
import { cn } from '@/lib/utils'

const RATING_COLOR: Record<MultiplierRating, string> = {
  green: '#5E8F55',
  yellow: '#C9A645',
  red: '#B5483E',
  unrated: '#6B6F78',
}

interface Props {
  likes: number | null | undefined
  competitorFollowers: number | null | undefined
  competitorAvgLikes: number | null | undefined
  competitorLevelOverride?: CompetitorLevelOverride | null
  levelsConfig?: CompetitorLevelsConfig
  multipliersConfig?: LevelMultipliersConfig
  className?: string
}

function tooltipFor(rating: MultiplierRating, multiplier: number | null, level: CompetitorLevel): string {
  if (rating === 'unrated') {
    if (level !== 'green' && level !== 'yellow' && level !== 'red') {
      return 'Unrated — competitor is out of range or has no level yet'
    }
    return 'Unrated — capture posts to get avgLikes'
  }
  return `${rating} — ${multiplier!.toFixed(1)}× avg likes (${level} competitor)`
}

export function PostMultiplierBadge({
  likes,
  competitorFollowers,
  competitorAvgLikes,
  competitorLevelOverride,
  levelsConfig,
  multipliersConfig,
  className,
}: Props) {
  const level = effectiveLevel(competitorLevelOverride, competitorFollowers, levelsConfig ?? DEFAULT_COMPETITOR_LEVELS)
  const { rating, multiplier } = multiplierRatingFor(
    level,
    likes,
    competitorAvgLikes,
    multipliersConfig ?? DEFAULT_LEVEL_MULTIPLIERS,
  )
  const tip = tooltipFor(rating, multiplier, level)
  return (
    <span
      aria-label={tip}
      title={tip}
      data-rating={rating}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[10px] tabular-nums',
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${RATING_COLOR[rating]} 50%, transparent)`,
        color: RATING_COLOR[rating],
      }}
    >
      <span aria-hidden className='size-1.5 rounded-full' style={{ background: RATING_COLOR[rating] }} />
      {multiplier === null ? '—' : `${multiplier.toFixed(1)}×`}
    </span>
  )
}
