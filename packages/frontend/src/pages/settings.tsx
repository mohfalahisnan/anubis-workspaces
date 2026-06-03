import { useEffect, useState } from 'react'
import {
  CodeIcon,
  SaveIcon,
} from 'lucide-react'
import type { AppConfig, CompetitorLevelsConfig } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, isValidCompetitorLevels } from '@anubis/shared'
import {
  getAppConfig,
  updateAppConfig,
} from '@/api'
import { setCompetitorLevels } from '@/hooks/use-competitor-levels'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [form, setForm] = useState<AppConfig>({})
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    let alive = true
    void getAppConfig()
      .then((cfg) => {
        if (!alive) return
        setConfig(cfg); setForm(cfg)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setBanner({ kind: 'error', message: e instanceof Error ? `Couldn't load settings: ${e.message}` : 'Could not load settings.' })
      })
    return () => { alive = false }
  }, [])

  const effectiveLevels: CompetitorLevelsConfig =
    form.competitorLevels ?? config?.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS

  const chromePathDirty = config !== null && (form.chromePath ?? '') !== (config.chromePath ?? '')
  const levelsDirty =
    config !== null &&
    JSON.stringify(form.competitorLevels ?? config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS) !==
    JSON.stringify(config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
  const levelsValid = isValidCompetitorLevels(effectiveLevels)

  const dirty = chromePathDirty || levelsDirty
  const canSave = dirty && levelsValid

  async function handleSave() {
    setBusy(true); setBanner(null)
    try {
      const next = await updateAppConfig({
        chromePath: form.chromePath ?? '',
        competitorLevels: form.competitorLevels ?? config?.competitorLevels,
      })
      setConfig(next)
      setForm((f) => ({
        ...f,
        chromePath: next.chromePath ?? '',
        competitorLevels: next.competitorLevels,
      }))
      setCompetitorLevels(next.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
      setBanner({ kind: 'success', message: 'Saved.' })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      setBusy(false)
    }
  }

  if (!config) {
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
              disabled={!canSave || busy}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                !canSave || busy
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
              )}
            >
              <SaveIcon className='size-[15px]' strokeWidth={2} />
              {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
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
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Crawler Chrome profiles</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Instagram login, capture, discovery, and Flow Chrome profiles are stored automatically in the app data folder and reused across crawler tasks.
          </p>
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Chrome executable path</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Optional. Used by the research-crawler when it launches Chrome for logged-in, anonymous, and Flow collection.
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

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Competitor levels</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Follower-count bands that drive the colored dot on each competitor card and post.
            Below <span className='font-mono'>min</span> or above <span className='font-mono'>max</span> is "black" — out of competitive range.
          </p>

          <div className='mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <LevelInput
              label='Min followers'
              value={effectiveLevels.minActive}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, minActive: n },
              }))}
            />
            <LevelInput
              label='Green up to'
              value={effectiveLevels.greenMax}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, greenMax: n },
              }))}
            />
            <LevelInput
              label='Yellow up to'
              value={effectiveLevels.yellowMax}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, yellowMax: n },
              }))}
            />
            <LevelInput
              label='Max followers'
              value={effectiveLevels.maxActive}
              onChange={(n) => setForm((f) => ({
                ...f,
                competitorLevels: { ...effectiveLevels, maxActive: n },
              }))}
            />
          </div>

          <div className='mt-3 flex flex-wrap items-center gap-1.5'>
            <RangeChip color='#1B1D22' text={`< ${formatThreshold(effectiveLevels.minActive)}`} />
            <RangeChip color='#5E8F55' text={`${formatThreshold(effectiveLevels.minActive)} – ${formatThreshold(effectiveLevels.greenMax)}`} />
            <RangeChip color='#C9A645' text={`${formatThreshold(effectiveLevels.greenMax)} – ${formatThreshold(effectiveLevels.yellowMax)}`} />
            <RangeChip color='#B5483E' text={`${formatThreshold(effectiveLevels.yellowMax)} – ${formatThreshold(effectiveLevels.maxActive)}`} />
            <RangeChip color='#1B1D22' text={`> ${formatThreshold(effectiveLevels.maxActive)}`} />
          </div>

          {!levelsValid && (
            <p className='mt-3 text-[12px] text-destructive'>
              Each threshold must be greater than the one before it (min &lt; green &lt; yellow &lt; max), and all must be &gt; 0.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function LevelInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-[12.5px] font-medium text-foreground'>{label}</span>
      <input
        type='number'
        min={1}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0)
        }}
        className='h-10 w-full rounded-md border border-border bg-card px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
      />
    </label>
  )
}

function RangeChip({ color, text }: { color: string; text: string }) {
  return (
    <span className='inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11.5px] font-mono text-muted-foreground'>
      <span aria-hidden className='size-2 rounded-full ring-1 ring-black/20' style={{ background: color }} />
      {text}
    </span>
  )
}

function formatThreshold(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return n.toLocaleString()
}
