import { useCallback, useState } from 'react'

export const STORAGE_KEY = 'anubis:prompt-injection-card-expanded'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === 'true'
}

/**
 * Global default expand/collapse state for the prompt-injection card, persisted
 * across sessions. Shared by every card on the page — toggling one updates the
 * single stored preference. Defaults to collapsed.
 */
export function usePromptCardExpanded(): [boolean, (next: boolean) => void] {
  const [expanded, setExpanded] = useState<boolean>(readInitial)

  const set = useCallback((next: boolean) => {
    setExpanded(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    }
  }, [])

  return [expanded, set]
}
