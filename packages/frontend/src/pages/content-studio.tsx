import { useEffect, useMemo, useState } from 'react'
import { PlayIcon, RefreshCwIcon, ScanTextIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react'
import type { ContentItemStatus, ContentItemSummary, ContentLesson, ContentPipeline } from '@anubis/shared'
import {
  extractRawIdea, getContentPipeline, getJob, listContentItems,
  runPipeline, runPipelineStep, submitHumanReview,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import {
  AiReviewSection, BriefSection, HumanReviewSection, LessonHistorySection,
  PhaseTwoPlaceholder, RawIdeaSection, RefinedSection,
} from './content-studio/sections'
import { BrandContextDialog } from './content-studio/brand-context-dialog'

const IN_PROGRESS: ContentItemStatus[] = ['raw_extracted', 'brief', 'content_refined', 'ai_review', 'human_review']

const STATUS_LABEL: Partial<Record<ContentItemStatus, string>> = {
  idea: 'Idea', raw_extracted: 'Raw', brief: 'Brief', content_refined: 'Refined',
  ai_review: 'AI Review', human_review: 'Human Review',
}

export function ContentStudioPage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id || 'default'
  const [items, setItems] = useState<ContentItemSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [data, setData] = useState<{ pipeline: ContentPipeline; lessons: ContentLesson[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)

  async function refreshItems() {
    const next = await listContentItems({ projectId, limit: 200 })
    setItems(next)
  }

  async function loadPipeline(id: string) {
    setData(await getContentPipeline(id))
  }

  useEffect(() => { void refreshItems() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])
  useEffect(() => {
    if (!selectedId) { setData(null); return }
    void loadPipeline(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const { ideas, inProgress } = useMemo(() => {
    return {
      ideas: items.filter((i) => i.status === 'idea'),
      inProgress: items.filter((i) => IN_PROGRESS.includes(i.status)),
    }
  }, [items])

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(true)
    setBanner(null)
    try {
      await fn()
    } catch (err) {
      setBanner(err instanceof Error ? err.message : `Failed: ${label}`)
    } finally {
      setBusy(false)
    }
  }

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
        <div className='flex items-center justify-between border-b border-border px-6 py-4'>
          <div>
            <h1 className='text-[22px] font-semibold tracking-[-0.02em]'>Content Studio</h1>
            <p className='mt-0.5 text-[12.5px] text-muted-foreground'>Idea → raw → brief → refined → AI review → human review.</p>
          </div>
          <button type='button' onClick={() => setBrandOpen(true)} className={secondaryButton}>
            <SparklesIcon className='size-4' /> Brand Context
          </button>
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

            {/* Controls */}
            <div className='mb-5 flex flex-wrap items-center gap-2'>
              <span className='mr-1 text-[13px] font-medium'>{selected.title}</span>
              <span className='rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground'>{STATUS_LABEL[selected.status] ?? selected.status}</span>
              <div className='flex-1' />
              <button type='button' disabled={busy} onClick={() => void withBusy('extract', async () => {
                await extractRawIdea(selected.id); await reselectAfter(selected.id)
              })} className={secondaryButton}>
                <ScanTextIcon className='size-4' /> Extract raw idea
              </button>
              <button type='button' disabled={busy} onClick={() => void withBusy('run', async () => {
                const jobId = await runPipeline(selected.id)
                await pollJob(jobId)
                await reselectAfter(selected.id)
                setBanner('Pipeline finished. Review the result below.')
              })} className={primaryButton}>
                <PlayIcon className='size-4' /> Run to human review
              </button>
            </div>

            <div className='mb-5 flex flex-wrap gap-2'>
              <StepButton label='Re-run breakdown' disabled={busy} onClick={() => void withBusy('breakdown', async () => {
                await runPipelineStep(selected.id, 'breakdown'); await reselectAfter(selected.id)
              })} />
              <StepButton label='Re-run refine' disabled={busy} onClick={() => void withBusy('refine', async () => {
                await runPipelineStep(selected.id, 'refine'); await reselectAfter(selected.id)
              })} />
              <StepButton label='Re-run AI review' disabled={busy} onClick={() => void withBusy('ai-review', async () => {
                await runPipelineStep(selected.id, 'ai-review'); await reselectAfter(selected.id)
              })} />
            </div>

            {/* Sections */}
            <div className='space-y-4'>
              {data?.pipeline.rawIdea ? <RawIdeaSection raw={data.pipeline.rawIdea} /> : null}
              {data?.pipeline.improvedBrief ? (
                <BriefSection brief={data.pipeline.improvedBrief} lessonsUsed={(data.lessons ?? []).map((l) => l.howToImprove)} />
              ) : null}
              {data?.pipeline.refinedContent ? <RefinedSection refined={data.pipeline.refinedContent} /> : null}
              {data?.pipeline.aiReview ? <AiReviewSection review={data.pipeline.aiReview} /> : null}
              {selected.status === 'human_review' || data?.pipeline.aiReview?.decision === 'approved' ? (
                <HumanReviewSection
                  busy={busy}
                  onApprove={() => void withBusy('approve', async () => {
                    await submitHumanReview(selected.id, { decision: 'approved' }); await reselectAfter(selected.id)
                    setBanner('Approved — ready for generation (Phase 2).')
                  })}
                  onReject={(reason, type) => void withBusy('reject', async () => {
                    await submitHumanReview(selected.id, { decision: 'rejected', reason, type }); await reselectAfter(selected.id)
                    setBanner('Rejected — lesson saved, sent back to brief.')
                  })}
                />
              ) : null}
              <PhaseTwoPlaceholder title='Generation Queue' note='Asset generation is built in Phase 2.' />
              <PhaseTwoPlaceholder title='Draft Output' note='The stitched draft package lands here in Phase 2.' />
              <LessonHistorySection lessons={data?.lessons ?? []} />
            </div>
          </div>
        )}
      </div>

      <BrandContextDialog open={brandOpen} projectId={projectId} onClose={() => setBrandOpen(false)} />
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

function StepButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type='button' disabled={disabled} onClick={onClick} className={cn(secondaryButton, 'text-[12px]')}>
      <WandSparklesIcon className='size-3.5' /> {label}
    </button>
  )
}

const primaryButton =
  'inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
