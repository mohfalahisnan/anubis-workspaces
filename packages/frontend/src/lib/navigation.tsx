import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/* -----------------------------------------------------------
   Lightweight in-app navigation. No external router — the
   Electron renderer is single-window and we keep state in
   React. URL hash sync can be added later if deep-linking
   becomes a requirement.
   ----------------------------------------------------------- */

export type Route =
  | { page: 'home' }
  | { page: 'conversations'; selectedId?: string }
  | { page: 'active-conversation'; conversationId?: string }
  | { page: 'content' }
  | { page: 'profiles' }
  | { page: 'profile-editor'; profileId: string }
  | { page: 'skills' }
  | { page: 'competitors' }
  | { page: 'scheduled' }
  | { page: 'settings' }
  | { page: 'workflow-demo' }
  | { page: 'workflows' }
  | { page: 'workflow-editor'; workflowId: string }
  | { page: 'crawler-playground' }

export type PageKey = Route['page']

interface NavigationState {
  route: Route
  navigate: (next: Route) => void
}

const NavigationContext = createContext<NavigationState | null>(null)

export function NavigationProvider({
  children,
  initial = { page: 'home' },
}: {
  children: ReactNode
  initial?: Route
}) {
  const [route, setRoute] = useState<Route>(initial)

  const navigate = useCallback((next: Route) => {
    setRoute(next)
    // Scroll the renderer to top on every nav — feels like a fresh page load.
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }, [])

  const value = useMemo<NavigationState>(() => ({ route, navigate }), [route, navigate])

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationState {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used inside <NavigationProvider>')
  return ctx
}
