import { useEffect, useState } from 'react'
import {
  CheckCircle2Icon,
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  RotateCcwIcon,
  SaveIcon,
} from 'lucide-react'
import type { AppConfig, ExtensionStatus } from '@anubis/shared'
import {
  getAppConfig,
  updateAppConfig,
  getExtensionStatus,
  revealExtensionSecret,
  rotateExtensionSecret,
} from '@/api'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [form, setForm] = useState<AppConfig>({})
  const [status, setStatus] = useState<ExtensionStatus | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [secretRevealed, setSecretRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([getAppConfig(), getExtensionStatus()])
      .then(([cfg, s]) => {
        if (!alive) return
        setConfig(cfg); setForm(cfg); setStatus(s)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setBanner({ kind: 'error', message: e instanceof Error ? `Couldn't load settings: ${e.message}` : 'Could not load settings.' })
      })
    const id = window.setInterval(async () => {
      if (!alive) return
      try { setStatus(await getExtensionStatus()) } catch { /* swallow */ }
    }, 2000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const chromePathDirty = config !== null && (form.chromePath ?? '') !== (config.chromePath ?? '')

  async function handleSave() {
    setBusy(true); setBanner(null)
    try {
      const next = await updateAppConfig({ chromePath: form.chromePath ?? '' })
      setConfig(next); setForm((f) => ({ ...f, chromePath: next.chromePath ?? '' }))
      setBanner({ kind: 'success', message: 'Saved.' })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleReveal() {
    if (secretRevealed) { setSecretRevealed(false); return }
    try {
      const s = await revealExtensionSecret()
      setSecret(s); setSecretRevealed(true)
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Could not reveal secret.' })
    }
  }

  async function handleRotate() {
    if (!window.confirm('Rotate the pairing secret? The extension will disconnect until you paste the new value into its Options page.')) return
    try {
      const s = await rotateExtensionSecret()
      setSecret(s); setSecretRevealed(true)
      setBanner({ kind: 'success', message: 'Secret rotated. Paste the new value into the extension Options page.' })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Rotate failed.' })
    }
  }

  async function copyToClipboard(value: string) {
    try { await navigator.clipboard.writeText(value); setBanner({ kind: 'success', message: 'Copied.' }) } catch { /* swallow */ }
  }

  if (!config || !status) {
    return <div className='flex flex-1 items-center justify-center text-[13px] text-muted-foreground'>Loading…</div>
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[860px] px-7 pb-16'>
        <div className='flex flex-col gap-4 pt-7'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>Settings</h1>
              <p className='mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground'>
                Per-machine knobs. Saved to <code className='font-mono text-foreground/80'>config.json</code> next to the database.
              </p>
            </div>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={!chromePathDirty || busy}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                !chromePathDirty || busy
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
              )}
            >
              <SaveIcon className='size-[15px]' strokeWidth={2} />
              {busy ? 'Saving…' : chromePathDirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>

        {banner && (
          <div role='status' className={cn(
            'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
            banner.kind === 'error'
              ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
              : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
          )}>
            {banner.message}
          </div>
        )}

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
            Research-crawler · Chrome extension
          </h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Logged-in Instagram captures run inside your real Chrome session via the Anubis extension. The desktop app dispatches jobs to the extension over a localhost WebSocket.
          </p>
          <div className='mt-4 flex items-center gap-2 rounded-md border border-border bg-card p-3'>
            <span className={cn('h-2 w-2 rounded-full', status.connected ? 'bg-green-500' : 'bg-amber-500')} aria-hidden />
            <span className='text-[13.5px] font-medium'>
              {status.connected ? `Connected — extension v${status.extensionVersion ?? '?'}` : 'Offline'}
            </span>
            {status.connected && (
              <CheckCircle2Icon className='ml-1 size-3.5 text-[var(--anubis-gold)]' strokeWidth={2} />
            )}
          </div>
          <div className='mt-3 flex flex-col gap-2'>
            <div className='flex gap-2'>
              <button type='button' onClick={() => void handleReveal()}
                className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-muted'>
                {secretRevealed ? <EyeOffIcon className='size-3.5' /> : <EyeIcon className='size-3.5' />}
                {secretRevealed ? 'Hide pairing secret' : 'Reveal pairing secret'}
              </button>
              <button type='button' onClick={() => void handleRotate()}
                className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-muted'>
                <RotateCcwIcon className='size-3.5' /> Re-generate secret
              </button>
            </div>
            {secretRevealed && secret && (
              <div className='flex flex-col gap-1 rounded-md border border-border bg-card p-3 font-mono text-[12px]'>
                <code className='break-all'>{secret}</code>
                <button type='button' onClick={() => void copyToClipboard(secret)} className='self-start text-[11.5px] text-[var(--anubis-gold)] hover:underline'>
                  Copy to clipboard
                </button>
              </div>
            )}
            {window.anubis?.openExtensionFolder && (
              <button
                type='button'
                onClick={() => void window.anubis?.openExtensionFolder?.(status.dataDirPath)}
                className='inline-flex h-8 self-start items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-muted'
              >
                Open extension folder
              </button>
            )}
            <ol className='mt-2 ml-5 list-decimal text-[12.5px] leading-relaxed text-muted-foreground'>
              <li>Open <code className='font-mono'>chrome://extensions</code> in Chrome.</li>
              <li>Toggle <strong>Developer mode</strong> (top-right).</li>
              <li>Click <strong>Load unpacked</strong> → pick <code className='font-mono text-foreground/80'>{status.dataDirPath}</code>.</li>
              <li>Click the Anubis icon → <strong>Options</strong> → paste the secret above.</li>
            </ol>
          </div>
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Chrome executable path</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Optional. Only set this if Chrome isn’t on PATH (mostly only Windows quirks).
          </p>
          <div className='relative mt-3'>
            <CodeIcon className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground' strokeWidth={1.8} />
            <input
              type='text'
              value={form.chromePath ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, chromePath: e.target.value }))}
              placeholder='C:\Program Files\Google\Chrome\Application\chrome.exe'
              spellCheck={false}
              className='h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
            />
          </div>
        </section>
      </div>
    </div>
  )
}
