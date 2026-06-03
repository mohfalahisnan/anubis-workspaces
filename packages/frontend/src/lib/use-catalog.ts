import { useEffect, useState } from 'react'
import { getCatalog, type AgentCatalog } from '@/api'

interface CatalogState {
  catalog: AgentCatalog | null
  error: string | null
}

let cache: AgentCatalog | null = null
let inflight: Promise<AgentCatalog> | null = null

export function __resetCatalogCacheForTests(): void {
  cache = null
  inflight = null
}

export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({
    catalog: cache,
    error: null,
  })

  useEffect(() => {
    if (cache) return
    let cancelled = false
    const p = inflight ?? (inflight = getCatalog())
    p.then(
      (c) => {
        cache = c
        if (!cancelled) setState({ catalog: c, error: null })
      },
      (e: unknown) => {
        inflight = null
        if (!cancelled) {
          setState({
            catalog: null,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
