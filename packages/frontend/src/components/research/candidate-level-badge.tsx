import type { CandidateLevel } from '@anubis/shared'
import { cn } from '@/lib/utils'
import { CANDIDATE_LEVEL_COLOR, CANDIDATE_LEVEL_LABEL, formatScore } from '@/lib/research'

export function CandidateLevelBadge({
  level,
  score,
  className,
}: {
  level: CandidateLevel
  score?: number | null
  className?: string
}) {
  const color = CANDIDATE_LEVEL_COLOR[level]
  const label = CANDIDATE_LEVEL_LABEL[level]
  return (
    <span
      data-level={level}
      title={`${label}${score != null ? ` — ${formatScore(score)} baseline` : ''}`}
      className={cn(
        'inline-flex h-[20px] shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px]',
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, ${color} 50%, transparent)`,
        color,
      }}
    >
      <span aria-hidden className='size-1.5 rounded-full' style={{ background: color }} />
      {label}
      {score != null && <span className='tabular-nums opacity-80'>{formatScore(score)}</span>}
    </span>
  )
}
