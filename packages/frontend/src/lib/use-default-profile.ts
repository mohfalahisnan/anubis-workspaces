import { useCallback, useMemo, useState } from 'react'
import type { ProfileSummary } from '@anubis/shared'

export const STORAGE_KEY = 'anubis:last-profile'

function pickInitial(profiles: ProfileSummary[]): ProfileSummary | null {
  if (profiles.length === 0) return null
  const stored = typeof window !== 'undefined'
    ? window.localStorage.getItem(STORAGE_KEY)
    : null
  if (stored) {
    const hit = profiles.find((p) => p.id === stored)
    if (hit) return hit
  }
  const mru = [...profiles].sort(
    (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  )
  if ((mru[0]?.lastUsedAt ?? 0) > 0) return mru[0] ?? null
  return profiles[0] ?? null
}

export function useDefaultProfile(
  profiles: ProfileSummary[],
): [ProfileSummary | null, (next: ProfileSummary) => void] {
  const initial = useMemo(() => pickInitial(profiles), [profiles])
  const [current, setCurrent] = useState<ProfileSummary | null>(initial)

  const effective = current ?? initial

  const set = useCallback((next: ProfileSummary) => {
    setCurrent(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next.id)
    }
  }, [])

  return [effective, set]
}
