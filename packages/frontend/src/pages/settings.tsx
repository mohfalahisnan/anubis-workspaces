import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2Icon,
  CodeIcon,
  RefreshCwIcon,
  SaveIcon,
  UserRoundIcon,
} from 'lucide-react'

import type { AppConfig, ChromeProfileInfo, ChromeProfilesPayload } from '@anubis/shared'

import {
  getAppConfig,
  listLocalChromeProfiles,
  updateAppConfig,
} from '@/api'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
  const [initial, setInitial] = useState<AppConfig | null>(null)
  const [form, setForm] = useState<AppConfig>({})
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [chrome, setChrome] = useState<ChromeProfilesPayload | null>(null)
  const [chromeLoading, setChromeLoading] = useState(true)
  const [customPath, setCustomPath] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([getAppConfig(), listLocalChromeProfiles()])
      .then(([cfg, chromeInfo]) => {
        if (!active) return
        setInitial(cfg)
        setForm(cfg)
        setChrome(chromeInfo)
        // If the saved login path is NOT one of the detected profiles,
        // surface the custom-path input so the user can see what's set.
        const knownPaths = new Set(chromeInfo.profiles.map((p) => p.path))
        if (cfg.loginProfileDir && !knownPaths.has(cfg.loginProfileDir)) {
          setCustomPath(true)
        }
      })
      .catch((e: unknown) => {
        if (!active) return
        setBanner({
          kind: 'error',
          message:
            e instanceof Error
              ? `Couldn't load settings: ${e.message}`
              : 'Could not load settings.',
        })
      })
      .finally(() => {
        if (active) setChromeLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const dirty = useMemo(() => {
    if (!initial) return false
    return (
      (form.chromePath ?? '') !== (initial.chromePath ?? '') ||
      (form.loginProfileDir ?? '') !== (initial.loginProfileDir ?? '')
    )
  }, [form, initial])

  async function refreshChrome() {
    setChromeLoading(true)
    try {
      const next = await listLocalChromeProfiles()
      setChrome(next)
    } finally {
      setChromeLoading(false)
    }
  }

  async function handleSave() {
    setBusy(true)
    setBanner(null)
    try {
      const merged = await updateAppConfig({
        chromePath: form.chromePath ?? '',
        loginProfileDir: form.loginProfileDir ?? '',
      })
      setInitial(merged)
      setForm(merged)
      setBanner({ kind: 'success', message: 'Saved.' })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not save.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[860px] px-7 pb-16'>
        {/* Header */}
        <div className='flex flex-col gap-4 pt-7'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>
                Settings
              </h1>
              <p className='mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground'>
                Per-machine knobs. Saved to{' '}
                <code className='font-mono text-foreground/80'>config.json</code> next
                to the database.
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <button
                type='button'
                onClick={() => void handleSave()}
                disabled={!dirty || busy}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                  !dirty || busy
                    ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                    : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
                )}
              >
                <SaveIcon className='size-[15px]' strokeWidth={2} />
                {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          </div>
        </div>

        {banner && (
          <div
            role='status'
            className={cn(
              'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
              banner.kind === 'error'
                ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
                : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
            )}
          >
            {banner.message}
          </div>
        )}

        <Section
          title='Research-crawler · Chrome profile'
          hint='Which Chrome profile to launch when a flow asks for the “login” profile (e.g. Find competitors, or capture with Logged-in mode).'
          right={
            <button
              type='button'
              onClick={() => void refreshChrome()}
              disabled={chromeLoading}
              className='inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon
                className={cn('size-[13px]', chromeLoading && 'animate-spin')}
                strokeWidth={2}
              />
              Rescan
            </button>
          }
        >
          {chromeLoading && chrome === null ? (
            <ProfilesSkeleton />
          ) : chrome === null || !chrome.ok ? (
            <NotInstalled detectedDir={chrome?.userDataDir ?? null} />
          ) : chrome.profiles.length === 0 ? (
            <NoProfiles userDataDir={chrome.userDataDir} />
          ) : (
            <>
              <ProfileGrid
                profiles={chrome.profiles}
                selected={form.loginProfileDir ?? ''}
                onPick={(path) => {
                  setCustomPath(false)
                  setForm((f) => ({ ...f, loginProfileDir: path }))
                }}
              />
              <p className='mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground'>
                User data dir:{' '}
                <span className='text-foreground/80'>{chrome.userDataDir}</span>
              </p>
              <button
                type='button'
                onClick={() => setCustomPath((v) => !v)}
                className='self-start text-[12px] text-[var(--anubis-gold)] hover:underline'
              >
                {customPath ? 'Use a detected profile instead' : 'Use a custom path…'}
              </button>
              {customPath && (
                <input
                  type='text'
                  value={form.loginProfileDir ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, loginProfileDir: e.target.value }))
                  }
                  placeholder='C:\Users\you\AppData\Local\Google\Chrome\User Data\Profile 3'
                  spellCheck={false}
                  className={cn(textInput, 'font-mono text-[12.5px]')}
                />
              )}
            </>
          )}
        </Section>

        <Section
          title='Chrome executable path'
          hint='Optional. Only set this if Chrome is not on the system PATH (mostly only Windows quirks).'
        >
          <Field htmlFor='cfg-chrome-path' hint=''>
            <div className='relative'>
              <CodeIcon
                className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground'
                strokeWidth={1.8}
              />
              <input
                id='cfg-chrome-path'
                type='text'
                value={form.chromePath ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, chromePath: e.target.value }))}
                placeholder='C:\Program Files\Google\Chrome\Application\chrome.exe'
                spellCheck={false}
                className={cn(textInput, 'pl-9 font-mono text-[12.5px]')}
              />
            </div>
          </Field>
        </Section>

        <p className='mt-6 text-[11.5px] leading-relaxed text-muted-foreground'>
          <span className='font-medium text-foreground/80'>Heads up:</span> Chrome
          can't be running with the selected profile already open — the crawler
          launches its own window. Close any browser windows using that profile
          first, or use one you don't keep open day-to-day.
        </p>
      </div>
    </div>
  )
}

/* ---------- Chrome-profile picker ---------- */

function ProfileGrid({
  profiles,
  selected,
  onPick,
}: {
  profiles: ChromeProfileInfo[]
  selected: string
  onPick: (path: string) => void
}) {
  return (
    <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
      {profiles.map((p) => {
        const isSelected = p.path === selected
        return (
          <button
            key={p.directory}
            type='button'
            onClick={() => onPick(p.path)}
            aria-pressed={isSelected}
            className={cn(
              'group flex items-start gap-3 rounded-md border bg-card p-3 text-left transition-all',
              isSelected
                ? 'border-[var(--anubis-gold)] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)]'
                : 'border-border hover:border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] hover:bg-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                isSelected
                  ? 'bg-[var(--anubis-gold)] text-[#0B0C0F]'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {p.name.slice(0, 1).toUpperCase() || (
                <UserRoundIcon className='size-4' strokeWidth={1.5} />
              )}
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-1.5'>
                <span className='truncate text-[13.5px] font-medium text-foreground'>
                  {p.name}
                </span>
                {isSelected && (
                  <CheckCircle2Icon
                    className='size-3.5 shrink-0 text-[var(--anubis-gold)]'
                    strokeWidth={2}
                  />
                )}
              </div>
              <div className='truncate font-mono text-[10.5px] text-muted-foreground'>
                {p.directory}
              </div>
              {p.email && (
                <div className='truncate text-[11px] text-muted-foreground/80'>
                  {p.email}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function ProfilesSkeleton() {
  return (
    <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className='h-[68px] animate-pulse rounded-md border border-border bg-card'
        />
      ))}
    </div>
  )
}

function NotInstalled({ detectedDir }: { detectedDir: string | null }) {
  return (
    <div className='rounded-md border border-dashed border-border bg-card/50 p-4 text-[13px] text-muted-foreground'>
      <p className='text-foreground'>Couldn't find Google Chrome.</p>
      <p className='mt-1.5'>
        {detectedDir ? (
          <>
            Expected the user-data dir at{' '}
            <code className='font-mono text-foreground/80'>{detectedDir}</code>,
            but it doesn't exist. Install Chrome, sign into Instagram in any
            profile, then click <span className='font-medium'>Rescan</span>.
          </>
        ) : (
          <>
            Your platform isn't one Anubis knows how to auto-detect. Use{' '}
            <span className='font-medium'>Use a custom path…</span> below to
            paste your profile directory manually.
          </>
        )}
      </p>
    </div>
  )
}

function NoProfiles({ userDataDir }: { userDataDir: string | null }) {
  return (
    <div className='rounded-md border border-dashed border-border bg-card/50 p-4 text-[13px] text-muted-foreground'>
      Found Chrome at{' '}
      <code className='font-mono text-foreground/80'>{userDataDir ?? '—'}</code>, but
      no profiles inside it. Open Chrome, sign into the account you want to use
      for Instagram captures, then click Rescan.
    </div>
  )
}

/* ---------- generic bits ---------- */

function Section({
  title,
  hint,
  right,
  children,
}: {
  title: string
  hint?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className='mt-8 border-t border-border pt-6'>
      <div className='mb-4 flex items-start justify-between gap-4'>
        <div>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
            {title}
          </h2>
          {hint && (
            <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
              {hint}
            </p>
          )}
        </div>
        {right}
      </div>
      <div className='flex flex-col gap-3'>{children}</div>
    </section>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label?: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      {label && (
        <label
          htmlFor={htmlFor}
          className='text-[12.5px] font-medium tracking-[-0.005em] text-foreground'
        >
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p className='text-[11.5px] leading-relaxed text-muted-foreground'>{hint}</p>
      )}
    </div>
  )
}

const textInput =
  'h-10 w-full rounded-md border border-border bg-card px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'
