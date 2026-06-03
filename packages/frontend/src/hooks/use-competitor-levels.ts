import { useEffect, useState, useCallback } from 'react'
import {
  DEFAULT_COMPETITOR_LEVELS,
  levelFor as sharedLevelFor,
  type CompetitorLevel,
  type CompetitorLevelsConfig,
} from '@anubis/shared'
import { getAppConfig } from '@/api'

/* Module-local cache so multiple consumers (Competitors, Content,
   Settings) share one fetch and re-render together when Settings
   saves a new config. */
let cached: CompetitorLevelsConfig | null = null
const subscribers = new Set<(cfg: CompetitorLevelsConfig) => void>()

function notify(next: CompetitorLevelsConfig): void {
  cached = next
  for (const fn of subscribers) fn(next)
}

export function setCompetitorLevels(cfg: CompetitorLevelsConfig): void {
  notify(cfg)
}

export interface UseCompetitorLevels {
  config: CompetitorLevelsConfig
  levelFor: (followers: number | null | undefined) => CompetitorLevel
  reload: () => Promise<void>
}

export function useCompetitorLevels(): UseCompetitorLevels {
  const [config, setConfig] = useState<CompetitorLevelsConfig>(
    cached ?? DEFAULT_COMPETITOR_LEVELS,
  )

  useEffect(() => {
    const sub = (next: CompetitorLevelsConfig): void => setConfig(next)
    subscribers.add(sub)
    if (!cached) {
      void getAppConfig()
        .then((cfg) => notify(cfg.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS))
        .catch(() => notify(DEFAULT_COMPETITOR_LEVELS))
    }
    return () => {
      subscribers.delete(sub)
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const cfg = await getAppConfig()
      notify(cfg.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
    } catch {
      notify(DEFAULT_COMPETITOR_LEVELS)
    }
  }, [])

  const levelForCb = useCallback(
    (followers: number | null | undefined) => sharedLevelFor(followers, config),
    [config],
  )

  return { config, levelFor: levelForCb, reload }
}
