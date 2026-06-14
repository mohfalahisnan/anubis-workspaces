import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCwIcon, SlidersHorizontalIcon, ZapIcon } from 'lucide-react'
import type { ContentItemStatus, ContentItemSummary, ContentLesson, ContentPipeline, DraftOutput, GenerationTask, PipelineHistoryEntry, PipelineStepProfileConfig, ProfileSummary } from '@anubis/shared'
import {
  cancelGenerationTask, getAppConfig, getContentPipeline, getGeneration, getJob, listContentItems, listProfiles,
  retryGenerationTask, runFullAuto, runPipelineStep, startGeneration, submitHumanReview, updateAppConfig,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { LessonHistorySection } from './content-studio/sections'
import { PipelineSettingsDialog } from './content-studio/pipeline-settings-dialog'
import { PipelineTimeline } from './content-studio/pipeline-timeline'
import { StepProfilePicker } from './content-studio/step-profile-picker'

const IN_PROGRESS: ContentItemStatus[] = ['raw_extracted', 'brief', 'content_refined', 'ai_review', 'human_review', 'generating', 'draft']

const STATUS_LABEL: Partial<Record<ContentItemStatus, string>> = {
  idea: 'Idea', raw_extracted: 'Raw', brief: 'Brief', content_refined: 'Refined',
  ai_review: 'AI Review', human_review: 'Human Review', generating: 'Generating', draft: 'Draft',
}

export function ContentStudioPage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id || 'default'
  const [items, setItems] = useState<ContentItemSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [data, setData] = useState<{ pipeline: ContentPipeline; lessons: ContentLesson[]; history: PipelineHistoryEntry[] } | null>(null)
  const [gen, setGen] = useState<{ tasks: GenerationTask[]; draftOutput: DraftOutput | null }>({ tasks: [], draftOutput: null })
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [pageStepProfiles, setPageStepProfiles] = useState<PipelineStepProfileConfig>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)

  // Poll for updates while any pipeline step (manual or auto-run) is active
  useEffect(() => {
    if ((!autoRunning && !busy) || !selectedId) return
    const interval = setInterval(() => {
      void loadPipeline(selectedId)
      void refreshItems()
    }, 2000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunning, busy, selectedId])

  async function refreshItems() {
    const next = await listContentItems({ projectId, limit: 200 })
    setItems(next)
  }

  async function loadPipeline(id: string) {
    const [p, g] = await Promise.all([getContentPipeline(id), getGeneration(id)])
    setData(p)
    setGen(g)
  }

  useEffect(() => { void refreshItems() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])
  useEffect(() => {
    if (!selectedId) { setData(null); return }
    void loadPipeline(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  useEffect(() => { void listProfiles().then(setProfiles) }, [])
  useEffect(() => {
    void getAppConfig().then((cfg) => setPageStepProfiles(cfg.pipelineStepProfiles ?? {}))
  }, [])

  const { ideas, inProgress } = useMemo(() => {
    return {
      ideas: items.filter((i) => i.status === 'idea'),
      inProgress: items.filter((i) => IN_PROGRESS.includes(i.status)),
    }
  }, [items])

  async function withBusy(action: string, fn: () => Promise<void>) {
    setBusy(true)
    setBanner(null)
    try {
      await fn()
    } catch (err) {
      setBanner(err instanceof Error ? err.message : `Failed: ${action}`)
    } finally {
      setBusy(false)
    }
  }

  const onPageStepProfilesChange = useCallback((next: PipelineStepProfileConfig) => {
    setPageStepProfiles(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void updateAppConfig({ pipelineStepProfiles: next })
    }, 500)
  }, [])

  async function pollJob(jobId: string) {
    for (;;) {
      const job = await getJob(jobId)
      if (!job || job.state === 'succeeded' || job.state === 'failed' || job.state === 'stopped') {
        if (job?.state === 'failed') throw new Error(job.error ?? 'Pipeline run failed.')
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  function reselectAfter(id: string) {
    return Promise.all([loadPipeline(id), refreshItems()]).then(() => undefined)
  }

  const selected = items.find((i) => i.id === selectedId) ?? null

  return (
    <div className='flex min-h-0 flex-1 overflow-hidden bg-background'>
      {/* Left rail */}
      <aside className='flex w-[300px] shrink-0 flex-col border-r border-border'>
        <div className='flex items-center justify-between border-b border-border px-4 py-3'>
          <h2 className='text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>Pipeline</h2>
          <button type='button' onClick={() => void refreshItems()} className='text-muted-foreground hover:text-foreground'>
            <RefreshCwIcon className='size-4' />
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto p-3'>
          <RailGroup title='Ideas' items={ideas} selectedId={selectedId} onSelect={setSelectedId} />
          <RailGroup title='In progress' items={inProgress} selectedId={selectedId} onSelect={setSelectedId} />
          {ideas.length === 0 && inProgress.length === 0 ? (
            <p className='px-1 py-6 text-center text-[12px] text-muted-foreground'>
              No ideas yet. Save a validated candidate from the Research page.
            </p>
          ) : null}
        </div>
      </aside>

      {/* Main */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex flex-col gap-3 border-b border-border px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div>
              <h1 className='text-[22px] font-semibold tracking-[-0.02em]'>Content Studio</h1>
              <p className='mt-0.5 text-[12.5px] text-muted-foreground'>Idea → raw → brief → refined → AI review → human review.</p>
            </div>
            <button type='button' onClick={() => setSettingsOpen(true)} className={secondaryButton}>
              <SlidersHorizontalIcon className='size-4' /> Pipeline Settings
            </button>
          </div>
          <StepProfilePicker
            profiles={profiles}
            stepProfiles={pageStepProfiles}
            onChange={onPageStepProfilesChange}
          />
        </div>

        {!selected ? (
          <div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
            Select an item to begin.
          </div>
        ) : (
          <div className='min-h-0 flex-1 overflow-y-auto p-6'>
            {banner ? (
              <div className='mb-4 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-[13px] text-destructive'>{banner}</div>
            ) : null}

            {/* Header: title + status */}
            <div className='mb-4 flex items-center gap-2'>
              <span className='text-[15px] font-semibold'>{selected.title}</span>
              <span className='rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground'>{STATUS_LABEL[selected.status] ?? selected.status}</span>
            </div>

            {/* Action buttons */}
            <div className='mb-5 flex flex-wrap items-center gap-2'>
              <button type='button' disabled={busy || autoRunning} onClick={() => {
                setAutoRunning(true)
                setBusy(true)
                setBanner(null)
                void (async () => {
                  try {
                    const jobId = await runFullAuto(selected.id)
                    await pollJob(jobId)
                    await reselectAfter(selected.id)
                    setBanner('Auto-run complete. Review the result below.')
                  } catch (err) {
                    setBanner(err instanceof Error ? err.message : 'Auto-run failed.')
                  } finally {
                    setAutoRunning(false)
                    setBusy(false)
                  }
                })()
              }} className={primaryButton}>
                <ZapIcon className='size-4' /> Auto-run
              </button>
              {autoRunning ? (
                <span className='text-[12px] text-[var(--anubis-gold)]'>
                  Auto-run: {STATUS_LABEL[selected.status] ?? selected.status}…
                </span>
              ) : null}
            </div>

            {/* Vertical pipeline timeline */}
            {data ? (
              <PipelineTimeline
                status={selected.status}
                pipeline={data.pipeline}
                history={data.history}
                lessons={data.lessons ?? []}
                gen={gen}
                busy={busy || autoRunning}
                onRerunStep={(step) => void withBusy(step, async () => {
                  const profileKey = step === 'ai-review' ? 'ai_review' : step === 'breakdown' ? 'brief' : 'refine'
                  await runPipelineStep(selected.id, step, pageStepProfiles[profileKey])
                  await reselectAfter(selected.id)
                })}
                onApprove={() => void withBusy('approve', async () => {
                  await submitHumanReview(selected.id, { decision: 'approved' }); await reselectAfter(selected.id)
                  setBanner('Approved — generation enqueued.')
                })}
                onReject={(reason, type) => void withBusy('reject', async () => {
                  await submitHumanReview(selected.id, { decision: 'rejected', reason, type }); await reselectAfter(selected.id)
                  setBanner('Rejected — lesson saved, sent back to brief.')
                })}
                onStartGeneration={() => void withBusy('generate', async () => {
                  const jobId = await startGeneration(selected.id)
                  await pollJob(jobId)
                  await reselectAfter(selected.id)
                  setBanner('Generation finished.')
                })}
                onRetryTask={(taskId) => void withBusy('retry', async () => {
                  await retryGenerationTask(selected.id, taskId); await reselectAfter(selected.id)
                })}
                onCancelTask={(taskId) => void withBusy('cancel', async () => {
                  await cancelGenerationTask(selected.id, taskId); await reselectAfter(selected.id)
                })}
              />
            ) : null}

            <div className='mt-5'>
              <LessonHistorySection lessons={data?.lessons ?? []} />
            </div>
          </div>
        )}
      </div>

      <PipelineSettingsDialog open={settingsOpen} projectId={projectId} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function RailGroup({
  title, items, selectedId, onSelect,
}: {
  title: string
  items: ContentItemSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className='mb-4'>
      <p className='mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>{title} · {items.length}</p>
      <div className='space-y-1.5'>
        {items.map((item) => (
          <button
            key={item.id}
            type='button'
            onClick={() => onSelect(item.id)}
            className={cn(
              'w-full rounded-md border p-2 text-left transition-colors',
              selectedId === item.id ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)]/10' : 'border-border bg-card hover:bg-muted/40',
            )}
          >
            <p className='line-clamp-2 text-[12px] font-medium leading-snug'>{item.title}</p>
            <div className='mt-1 flex items-center justify-between text-[10px] text-muted-foreground'>
              <span className='truncate font-mono'>{item.referencePost?.competitorHandle ?? item.referencePost?.username ?? 'reference'}</span>
              <span className='rounded border border-border px-1 py-0.5'>{STATUS_LABEL[item.status] ?? item.status}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

const primaryButton =
  'inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
