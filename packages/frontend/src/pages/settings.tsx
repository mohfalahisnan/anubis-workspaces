import { useEffect, useMemo, useState } from 'react'
import { CodeIcon, FolderOpenIcon, SaveIcon } from 'lucide-react'

import type { AppConfig } from '@anubis/shared'

import { getAppConfig, updateAppConfig } from '@/api'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
  const [initial, setInitial] = useState<AppConfig | null>(null)
  const [form, setForm] = useState<AppConfig>({})
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    let active = true
    getAppConfig()
      .then((cfg) => {
        if (!active) return
        setInitial(cfg)
        setForm(cfg)
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
          title='Research-crawler'
          hint='Where the crawler should find Chrome and which signed-in profile to use.'
        >
          <Field
            label='Login profile directory'
            htmlFor='cfg-profile-dir'
            hint='Full path to the Chrome user-data dir where you are signed into Instagram. On Windows this looks like “C:\\Users\\<you>\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 3”. Used whenever a flow asks for the login profile (e.g. discovery, or capture with Logged-in mode).'
          >
            <div className='relative'>
              <FolderOpenIcon
                className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground'
                strokeWidth={1.8}
              />
              <input
                id='cfg-profile-dir'
                type='text'
                value={form.loginProfileDir ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, loginProfileDir: e.target.value }))
                }
                placeholder='C:\Users\you\AppData\Local\Google\Chrome\User Data\Profile 3'
                spellCheck={false}
                className={cn(textInput, 'pl-9 font-mono text-[12.5px]')}
              />
            </div>
          </Field>

          <Field
            label='Chrome executable path'
            htmlFor='cfg-chrome-path'
            hint='Optional. Only needed when Chrome is not on the system PATH. Point at chrome.exe (Windows), Google Chrome.app/Contents/MacOS/Google Chrome (macOS), or google-chrome (Linux).'
          >
            <div className='relative'>
              <CodeIcon
                className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground'
                strokeWidth={1.8}
              />
              <input
                id='cfg-chrome-path'
                type='text'
                value={form.chromePath ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, chromePath: e.target.value }))
                }
                placeholder='C:\Program Files\Google\Chrome\Application\chrome.exe'
                spellCheck={false}
                className={cn(textInput, 'pl-9 font-mono text-[12.5px]')}
              />
            </div>
          </Field>

          <details className='group rounded-md border border-border bg-card p-3.5 text-[12.5px]'>
            <summary className='cursor-pointer select-none font-medium text-foreground'>
              How to find your Chrome profile directory
            </summary>
            <div className='mt-2 space-y-2 text-muted-foreground'>
              <p>
                Open Chrome, hit <code className='font-mono text-foreground/80'>chrome://version</code>
                {' '}in the address bar, and look at the{' '}
                <span className='font-medium text-foreground/90'>Profile Path</span> row.
                That's the full path — paste it above.
              </p>
              <p>
                Common layouts:
              </p>
              <ul className='ml-5 list-disc space-y-1'>
                <li>
                  <span className='font-mono text-foreground/80'>
                    Windows: %LOCALAPPDATA%\Google\Chrome\User Data\Profile N
                  </span>
                </li>
                <li>
                  <span className='font-mono text-foreground/80'>
                    macOS: ~/Library/Application Support/Google/Chrome/Profile N
                  </span>
                </li>
                <li>
                  <span className='font-mono text-foreground/80'>
                    Linux: ~/.config/google-chrome/Profile N
                  </span>
                </li>
              </ul>
              <p>
                <span className='font-medium text-foreground/90'>Heads up:</span>{' '}
                Chrome can't be running with that profile already open — the crawler
                opens its own window. Close any Chrome windows using Profile N first,
                or use a profile you don't keep open day-to-day.
              </p>
            </div>
          </details>
        </Section>
      </div>
    </div>
  )
}

/* ---------- presentational bits ---------- */

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className='mt-8 border-t border-border pt-6'>
      <div className='mb-4'>
        <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
          {title}
        </h2>
        {hint && <p className='mt-1 text-[12.5px] text-muted-foreground'>{hint}</p>}
      </div>
      <div className='flex flex-col gap-5'>{children}</div>
    </section>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label
        htmlFor={htmlFor}
        className='text-[12.5px] font-medium tracking-[-0.005em] text-foreground'
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className='text-[11.5px] leading-relaxed text-muted-foreground'>{hint}</p>
      )}
    </div>
  )
}

const textInput =
  'h-10 w-full rounded-md border border-border bg-card px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'
