import { useEffect, useState } from 'react'
import { RotateCcw, FileDown } from 'lucide-react'
import type { PipelineAiStep, PipelinePromptDefaults, PipelineStepSettings, ReasoningEffort } from '@anubis/shared'
import { getPipelineSettings, updatePipelineSettings } from '@/api'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Steps = Partial<Record<PipelineAiStep, PipelineStepSettings>>

const STEP_TABS: { key: PipelineAiStep; label: string; placeholders: string }[] = [
  { key: 'brief', label: 'Breakdown', placeholders: '{{source}} · {{brand}} · {{lessons}} · {{kb}}' },
  { key: 'refine', label: 'Refine', placeholders: '{{brief}} · {{brand}}' },
  { key: 'ai_review', label: 'AI Review', placeholders: '{{content}} · {{brand}} · {{niche}}' },
]

const EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

/** Drop empty string / NaN fields so we never persist a blank as an override. */
function clean(steps: Steps): Steps {
  const out: Steps = {}
  for (const [key, s] of Object.entries(steps) as [PipelineAiStep, PipelineStepSettings][]) {
    if (!s) continue
    const next: PipelineStepSettings = {}
    if (s.promptTemplate && s.promptTemplate.trim()) next.promptTemplate = s.promptTemplate
    if (s.model && s.model.trim()) next.model = s.model.trim()
    if (s.reasoningEffort) next.reasoningEffort = s.reasoningEffort
    if (typeof s.temperature === 'number' && !Number.isNaN(s.temperature)) next.temperature = s.temperature
    if (typeof s.maxJsonAttempts === 'number' && !Number.isNaN(s.maxJsonAttempts)) next.maxJsonAttempts = s.maxJsonAttempts
    if (Object.keys(next).length) out[key] = next
  }
  return out
}

export function PipelineSettingsDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean
  projectId: string
  onClose: () => void
}) {
  const [steps, setSteps] = useState<Steps>({})
  const [defaults, setDefaults] = useState<PipelinePromptDefaults | null>(null)
  const [active, setActive] = useState<PipelineAiStep>('brief')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getPipelineSettings(projectId).then(({ settings, defaults: d }) => {
      if (cancelled) return
      setSteps(settings.steps ?? {})
      setDefaults(d)
    })
    return () => { cancelled = true }
  }, [open, projectId])

  const cur = steps[active] ?? {}
  function patch(p: Partial<PipelineStepSettings>) {
    setSteps((s) => ({ ...s, [active]: { ...s[active], ...p } }))
  }

  async function save() {
    setBusy(true)
    try {
      await updatePipelineSettings(projectId, clean(steps))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const tab = STEP_TABS.find((t) => t.key === active)!
  const usingDefault = !cur.promptTemplate?.trim()

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className='sm:max-w-3xl bg-card'>
        <DialogHeader>
          <DialogTitle>Pipeline Settings</DialogTitle>
        </DialogHeader>

        <p className='-mt-1 text-[12px] text-muted-foreground'>
          Per-project prompts and agent parameters for each AI step. Applies to every item in this project.
        </p>

        {/* Step tabs */}
        <div className='flex gap-1 border-b border-border'>
          {STEP_TABS.map((t) => (
            <button
              key={t.key}
              type='button'
              onClick={() => setActive(t.key)}
              className={cn(
                'px-3 py-1.5 text-[12.5px] font-medium border-b-2 -mb-px',
                active === t.key
                  ? 'border-[var(--anubis-gold)] text-[var(--anubis-gold)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className='max-h-[58vh] space-y-4 overflow-y-auto pr-1'>
          {/* Prompt template */}
          <div>
            <div className='mb-1 flex items-center justify-between'>
              <span className='text-[12px] font-medium text-muted-foreground'>
                Prompt template {usingDefault ? <span className='text-[11px]'>· using default</span> : <span className='text-[11px] text-[var(--anubis-gold)]'>· customized</span>}
              </span>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => defaults && patch({ promptTemplate: defaults[active] })}
                  className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
                  title='Load the default template into the editor so you can tweak it'
                >
                  <FileDown className='size-3' /> Edit from default
                </button>
                <button
                  type='button'
                  onClick={() => patch({ promptTemplate: undefined })}
                  disabled={usingDefault}
                  className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40'
                  title='Discard the override and use the shipped default'
                >
                  <RotateCcw className='size-3' /> Reset to default
                </button>
              </div>
            </div>
            <textarea
              value={cur.promptTemplate ?? ''}
              onChange={(e) => patch({ promptTemplate: e.target.value })}
              rows={12}
              placeholder={defaults ? defaults[active] : '(loading default…)'}
              className='w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--anubis-gold)]/60'
            />
            <p className='mt-1 text-[11px] text-muted-foreground'>
              Placeholders: <span className='font-mono'>{tab.placeholders}</span>. Leave blank to use the default shown above.
            </p>
          </div>

          {/* Parameters */}
          <div className='grid grid-cols-2 gap-3'>
            <label className='block'>
              <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Model</span>
              <input
                type='text'
                value={cur.model ?? ''}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder='(profile default)'
                className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
              />
            </label>
            <label className='block'>
              <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Reasoning effort</span>
              <select
                value={cur.reasoningEffort ?? ''}
                onChange={(e) => patch({ reasoningEffort: (e.target.value || undefined) as ReasoningEffort | undefined })}
                className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
              >
                <option value=''>(profile default)</option>
                {EFFORTS.map((eff) => <option key={eff} value={eff}>{eff}</option>)}
              </select>
            </label>
            <label className='block'>
              <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Temperature</span>
              <input
                type='number'
                min={0}
                max={2}
                step={0.1}
                value={cur.temperature ?? ''}
                onChange={(e) => patch({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder='(default)'
                className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
              />
              <span className='mt-0.5 block text-[10.5px] text-muted-foreground'>Best-effort — only agents that support sampling apply it.</span>
            </label>
            <label className='block'>
              <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>JSON repair attempts</span>
              <input
                type='number'
                min={1}
                max={6}
                step={1}
                value={cur.maxJsonAttempts ?? ''}
                onChange={(e) => patch({ maxJsonAttempts: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder='3'
                className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
              />
              <span className='mt-0.5 block text-[10.5px] text-muted-foreground'>Auto-retries when the agent returns malformed/truncated JSON.</span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <button type='button' onClick={onClose} className='inline-flex h-9 items-center rounded-md border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-muted'>Cancel</button>
          <button type='button' onClick={() => void save()} disabled={busy} className='inline-flex h-9 items-center rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
