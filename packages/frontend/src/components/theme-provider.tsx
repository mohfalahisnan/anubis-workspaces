import * as React from 'react'

export type Theme = 'dark' | 'light' | 'system'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  /** The theme actually applied to the document, resolving `system`. */
  resolvedTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void
}

const ThemeProviderContext = React.createContext<ThemeProviderState | null>(null)

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'anubis-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme
    return (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme
  })

  const [resolvedTheme, setResolvedTheme] = React.useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'light'
    return theme === 'system' ? getSystemTheme() : theme
  })

  React.useEffect(() => {
    const root = window.document.documentElement
    const applied = theme === 'system' ? getSystemTheme() : theme

    root.classList.toggle('dark', applied === 'dark')
    root.style.colorScheme = applied
    setResolvedTheme(applied)
  }, [theme])

  // Follow OS changes while in `system` mode.
  React.useEffect(() => {
    if (theme !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const applied = getSystemTheme()
      window.document.documentElement.classList.toggle('dark', applied === 'dark')
      window.document.documentElement.style.colorScheme = applied
      setResolvedTheme(applied)
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = React.useCallback(
    (next: Theme) => {
      localStorage.setItem(storageKey, next)
      setThemeState(next)
    },
    [storageKey],
  )

  const value = React.useMemo<ThemeProviderState>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
