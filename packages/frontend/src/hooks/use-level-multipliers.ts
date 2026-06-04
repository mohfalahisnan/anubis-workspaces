import { useEffect, useState } from 'react'
import {
  DEFAULT_LEVEL_MULTIPLIERS,
  type LevelMultipliersConfig,
} from '@anubis/shared'
import { getAppConfig } from '@/api'

/* Module-local cache so multiple consumers (Content, Settings) share
   one fetch and re-render together when Settings saves a new config. */
let cached: LevelMultipliersConfig | null = null
const subscribers = new Set<(cfg: LevelMultipliersConfig) => void>()

function notify(next: LevelMultipliersConfig): void {
  cached = next
  for (const fn of subscribers) fn(next)
}

export function setLevelMultipliers(cfg: LevelMultipliersConfig): void {
  notify(cfg)
}

export function useLevelMultipliers(): LevelMultipliersConfig {
  const [config, setConfig] = useState<LevelMultipliersConfig>(
    cached ?? DEFAULT_LEVEL_MULTIPLIERS,
  )

  useEffect(() => {
    const sub = (next: LevelMultipliersConfig): void => setConfig(next)
    subscribers.add(sub)
    if (!cached) {
      void getAppConfig()
        .then((cfg) => notify(cfg.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS))
        .catch(() => notify(DEFAULT_LEVEL_MULTIPLIERS))
    }
    return () => {
      subscribers.delete(sub)
    }
  }, [])

  return config
}
