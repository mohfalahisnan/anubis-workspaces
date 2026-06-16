import { useEffect, useState } from 'react'
import {
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  FolderSearchIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  SaveIcon,
} from 'lucide-react'
import type { AppConfig, CompetitorLevelsConfig, LevelMultipliersConfig, MultiplierBand } from '@anubis/shared'
import { DEFAULT_COMPETITOR_LEVELS, DEFAULT_LEVEL_MULTIPLIERS, isValidCompetitorLevels, isValidLevelMultipliers } from '@anubis/shared'
import {
  getAppConfig,
  updateAppConfig,
} from '@/api'
import { setCompetitorLevels } from '@/hooks/use-competitor-levels'
import { setLevelMultipliers } from '@/hooks/use-level-multipliers'
import { cn } from '@/lib/utils'
import { EXECUTABLE_FILTERS, isElectron, pickFile } from '@/lib/pick-file'
import { isUpdaterAvailable, requestUpdateCheck } from '@/components/update'

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

  const effectiveMultipliers: LevelMultipliersConfig =
    form.levelMultipliers ?? config?.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS

  const chromePathDirty = config !== null && (form.chromePath ?? '') !== (config.chromePath ?? '')
  const engineBinaryPathDirty =
    config !== null && (form.engineBinaryPath ?? '') !== (config.engineBinaryPath ?? '')
  const extractorBinaryPathDirty =
    config !== null && (form.extractorBinaryPath ?? '') !== (config.extractorBinaryPath ?? '')
  const levelsDirty =
    config !== null &&
    JSON.stringify(form.competitorLevels ?? config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS) !==
    JSON.stringify(config.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
  const levelsValid = isValidCompetitorLevels(effectiveLevels)

  const multipliersDirty =
    config !== null &&
    JSON.stringify(form.levelMultipliers ?? config.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS) !==
    JSON.stringify(config.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS)
  const multipliersValid = isValidLevelMultipliers(effectiveMultipliers)

  const notificationsDirty =
    config !== null &&
    (form.enableNotifications ?? true) !== (config.enableNotifications ?? true)

  const promptCardDirty =
    config !== null &&
    (form.showPromptInjectionCard ?? true) !== (config.showPromptInjectionCard ?? true)

  const qoderApiKeyDirty =
    config !== null &&
    (form.qoderApiKey ?? '') !== (config.qoderApiKey ?? '')

  const dirty = chromePathDirty || engineBinaryPathDirty || extractorBinaryPathDirty || levelsDirty || multipliersDirty || notificationsDirty || promptCardDirty || qoderApiKeyDirty
  const canSave = dirty && levelsValid && multipliersValid

  async function handleSave() {
    setBusy(true); setBanner(null)
    try {
      const next = await updateAppConfig({
        chromePath: form.chromePath ?? '',
        engineBinaryPath: form.engineBinaryPath ?? '',
        extractorBinaryPath: form.extractorBinaryPath ?? '',
        competitorLevels: form.competitorLevels ?? config?.competitorLevels,
        levelMultipliers: form.levelMultipliers ?? config?.levelMultipliers,
        enableNotifications: form.enableNotifications ?? true,
        showPromptInjectionCard: form.showPromptInjectionCard ?? true,
        qoderApiKey: form.qoderApiKey ?? '',
      })
      setConfig(next)
      setForm((f) => ({
        ...f,
        chromePath: next.chromePath ?? '',
        engineBinaryPath: next.engineBinaryPath ?? '',
        extractorBinaryPath: next.extractorBinaryPath ?? '',
        competitorLevels: next.competitorLevels,
        levelMultipliers: next.levelMultipliers,
        enableNotifications: next.enableNotifications ?? true,
        showPromptInjectionCard: next.showPromptInjectionCard ?? true,
        qoderApiKey: next.qoderApiKey ?? '',
      }))
      setCompetitorLevels(next.competitorLevels ?? DEFAULT_COMPETITOR_LEVELS)
      setLevelMultipliers(next.levelMultipliers ?? DEFAULT_LEVEL_MULTIPLIERS)
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

        {isUpdaterAvailable() && (
          <section className='mt-8 border-t border-border pt-6'>
            <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Application updates</h2>
            <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
              Anubis checks for updates automatically at launch. Run a manual check to see if a newer version is available.
            </p>
            <button
              type='button'
              onClick={() => requestUpdateCheck()}
              className='mt-4 inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Check for updates
            </button>
          </section>
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
          <BinaryPathField
            value={form.chromePath ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, chromePath: v }))}
            placeholder='C:\Program Files\Google\Chrome\Application\chrome.exe'
            pickerTitle='Select Chrome executable'
          />
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>External binaries</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Paths to user-installed CLI tools Anubis operates but does not bundle. Leave blank to disable that feature; errors surface at first use.
          </p>

          <div className='mt-4 flex flex-col gap-1.5'>
            <label className='text-[12.5px] font-medium text-foreground'>Anubis Engine (Knowledge Base)</label>
            <BinaryPathField
              value={form.engineBinaryPath ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, engineBinaryPath: v }))}
              placeholder='C:\Path\To\anubis-engine.exe'
              pickerTitle='Select anubis-engine binary'
            />
            <p className='text-[12px] text-muted-foreground'>
              Required for indexing and searching each Project's Knowledge Base.
            </p>
          </div>

          <div className='mt-4 flex flex-col gap-1.5'>
            <label className='text-[12.5px] font-medium text-foreground'>Anubis Extractor (OCR &amp; Transcribe)</label>
            <BinaryPathField
              value={form.extractorBinaryPath ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, extractorBinaryPath: v }))}
              placeholder='C:\Path\To\anubis-extractor.exe'
              pickerTitle='Select anubis-extractor binary'
            />
            <p className='text-[12px] text-muted-foreground'>
              Required for OCR and transcription. Output is cached as <code className='font-mono text-foreground/80'>*.anubis.txt</code> next to the source file; the Knowledge Base picks these up on re-index.
            </p>
          </div>
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>AI Provider Keys</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            API keys for cloud-based AI providers. Stored locally in <code className='font-mono text-foreground/80'>config.json</code> alongside other settings.
          </p>

          <div className='mt-4 flex flex-col gap-1.5'>
            <label className='text-[12.5px] font-medium text-foreground'>Qoder Personal Access Token</label>
            <ApiKeyField
              value={form.qoderApiKey ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, qoderApiKey: v }))}
              placeholder='qoder_pat_xxxxxxxxxxxxxxxx'
            />
            <p className='text-[12px] text-muted-foreground'>
              Required to use the Qoder agent. Generate a token at{' '}
              <a
                href='https://app.qoder.com/settings/tokens'
                target='_blank'
                rel='noreferrer'
                className='text-foreground/80 underline underline-offset-2 hover:text-foreground'
              >
                app.qoder.com/settings/tokens
              </a>.
            </p>
          </div>
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Desktop Notifications</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Enable system-level notifications for workflow completion, approval requests, and scheduled background tasks.
          </p>
          <div className='mt-4 flex items-center gap-3'>
            <input
              type='checkbox'
              id='enable-notifications'
              checked={form.enableNotifications ?? true}
              onChange={(e) => setForm((f) => ({ ...f, enableNotifications: e.target.checked }))}
              className='size-4 rounded border-border text-[var(--anubis-gold)] bg-card outline-none focus:ring-0 focus:ring-offset-0 accent-[var(--anubis-gold)] cursor-pointer'
            />
            <label htmlFor='enable-notifications' className='text-[13px] font-medium text-foreground cursor-pointer select-none'>
              Enable local notifications
            </label>
          </div>
        </section>

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Conversation display</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Show the collapsible prompt-injection card under user messages, revealing the retrieved context pack and the improved prompt sent to the agent.
          </p>
          <div className='mt-4 flex items-center gap-3'>
            <input
              type='checkbox'
              id='show-prompt-injection-card'
              checked={form.showPromptInjectionCard ?? true}
              onChange={(e) => setForm((f) => ({ ...f, showPromptInjectionCard: e.target.checked }))}
              className='size-4 rounded border-border text-[var(--anubis-gold)] bg-card outline-none focus:ring-0 focus:ring-offset-0 accent-[var(--anubis-gold)] cursor-pointer'
            />
            <label htmlFor='show-prompt-injection-card' className='text-[13px] font-medium text-foreground cursor-pointer select-none'>
              Show prompt-injection card in conversations
            </label>
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

        <section className='mt-8 border-t border-border pt-6'>
          <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Level multipliers</h2>
          <p className='mt-1 text-[12.5px] leading-relaxed text-muted-foreground'>
            Per-post viral multiplier (<span className='font-mono'>post likes ÷ competitor avgLikes</span>) thresholds.
            For each competitor level: at or above <span className='font-mono'>min</span> is yellow, at or above <span className='font-mono'>good</span> is green; below <span className='font-mono'>min</span> is red.
          </p>

          <div className='mt-4 flex flex-col gap-3'>
            <MultiplierRow
              label='Green competitor'
              band={effectiveMultipliers.green}
              onChange={(band) => setForm((f) => ({ ...f, levelMultipliers: { ...effectiveMultipliers, green: band } }))}
            />
            <MultiplierRow
              label='Yellow competitor'
              band={effectiveMultipliers.yellow}
              onChange={(band) => setForm((f) => ({ ...f, levelMultipliers: { ...effectiveMultipliers, yellow: band } }))}
            />
            <MultiplierRow
              label='Red competitor'
              band={effectiveMultipliers.red}
              onChange={(band) => setForm((f) => ({ ...f, levelMultipliers: { ...effectiveMultipliers, red: band } }))}
            />
          </div>

          {!multipliersValid && (
            <p className='mt-3 text-[12px] text-destructive'>
              For each level, "min" and "good" must be &gt; 0 and min &lt; good.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function BinaryPathField({
  value,
  onChange,
  placeholder,
  pickerTitle,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  pickerTitle?: string
}) {
  const browseAvailable = isElectron()

  async function handleBrowse() {
    const picked = await pickFile({
      title: pickerTitle,
      filters: EXECUTABLE_FILTERS,
    })
    if (picked) onChange(picked)
  }

  return (
    <div className='mt-3 flex gap-2'>
      <div className='relative flex-1'>
        <CodeIcon className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground' strokeWidth={1.8} />
        <input
          type='text'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className='h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
        />
      </div>
      <button
        type='button'
        onClick={() => void handleBrowse()}
        disabled={!browseAvailable}
        title={browseAvailable ? 'Pick a file' : 'Available in the desktop app only'}
        className='inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] text-foreground transition-colors hover:bg-card/70 disabled:cursor-not-allowed disabled:opacity-50'
      >
        <FolderSearchIcon className='size-[15px]' strokeWidth={1.8} />
        Browse…
      </button>
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

function MultiplierRow({
  label,
  band,
  onChange,
}: {
  label: string
  band: MultiplierBand
  onChange: (band: MultiplierBand) => void
}) {
  return (
    <div className='grid grid-cols-[1fr_auto_auto] items-end gap-3 sm:grid-cols-[160px_1fr_1fr]'>
      <span className='text-[12.5px] font-medium text-foreground'>{label}</span>
      <MultiplierInput
        label='Min (yellow)'
        value={band.min}
        onChange={(n) => onChange({ ...band, min: n })}
      />
      <MultiplierInput
        label='Good (green)'
        value={band.good}
        onChange={(n) => onChange({ ...band, good: n })}
      />
    </div>
  )
}

function MultiplierInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-[12px] text-muted-foreground'>{label}</span>
      <div className='relative'>
        <input
          type='number'
          min={0}
          step={0.5}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? Math.max(0, n) : 0)
          }}
          className='h-10 w-full rounded-md border border-border bg-card pl-3 pr-7 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
        />
        <span className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-muted-foreground'>×</span>
      </div>
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

function ApiKeyField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className='mt-3 flex gap-2'>
      <div className='relative flex-1'>
        <KeyRoundIcon className='pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground' strokeWidth={1.8} />
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete='off'
          spellCheck={false}
          className='h-10 w-full rounded-md border border-border bg-card pl-9 pr-10 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
        />
        <button
          type='button'
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? 'Hide key' : 'Show key'}
          className='absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground'
        >
          {revealed
            ? <EyeOffIcon className='size-[15px]' strokeWidth={1.8} />
            : <EyeIcon className='size-[15px]' strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  )
}
