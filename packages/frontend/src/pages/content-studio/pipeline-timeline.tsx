import { useState } from 'react'
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Loader2, RefreshCw, UserCheck,
} from 'lucide-react'
import type {
  AiReview, ContentItemStatus, ContentLesson, ContentPipeline, DraftOutput,
  GenerationTask, HumanReview, ImprovedBrief, PipelineHistoryEntry, RawIdea, RefinedContent,
} from '@anubis/shared'
import { cn } from '@/lib/utils'
import { AiReviewSection, BriefSection, HumanReviewSection, RawIdeaSection, RefinedSection, LocalAssetStrip } from './sections'
import { DraftOutputSection, GenerationQueueSection } from './generation-sections'

type StepKey = 'extract' | 'breakdown' | 'refine' | 'ai-review' | 'human-review' | 'generation'
type StepState = 'completed' | 'active' | 'pending' | 'error'

const STEP_DEFS: { key: StepKey; label: string }[] = [
  { key: 'extract', label: 'Extract' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'refine', label: 'Refine' },
  { key: 'ai-review', label: 'AI Review' },
  { key: 'human-review', label: 'Human Review' },
  { key: 'generation', label: 'Generation' },
]

const RERUNNABLE = new Set<StepKey>(['breakdown', 'refine', 'ai-review'])
/** Item statuses that mean human review has been passed (i.e. approved). */
const PAST_HUMAN_REVIEW: ContentItemStatus[] = ['generating', 'draft', 'review', 'scheduled', 'published']

/** Map a backend agentProgress.step value onto a timeline step key. */
function progressKey(step: string | undefined): StepKey | undefined {
  switch (step) {
    case 'extract': return 'extract'
    case 'breakdown': return 'breakdown'
    case 'refine': return 'refine'
    case 'ai-review': case 'ai_review': return 'ai-review'
    case 'generation': return 'generation'
    default: return undefined
  }
}

/** Map a PipelineHistoryEntry.step value onto a timeline step key. */
function historyKey(step: string): StepKey | undefined {
  switch (step) {
    case 'extract': return 'extract'
    case 'breakdown': return 'breakdown'
    case 'refine': return 'refine'
    case 'ai_review': return 'ai-review'
    case 'human_review': return 'human-review'
    default: return undefined
  }
}

export interface PipelineTimelineProps {
  status: ContentItemStatus
  pipeline: ContentPipeline
  history: PipelineHistoryEntry[]
  lessons: ContentLesson[]
  gen: { tasks: GenerationTask[]; draftOutput: DraftOutput | null }
  busy: boolean
  onRerunStep: (step: 'breakdown' | 'refine' | 'ai-review') => void
  onApprove: () => void
  onReject: (reason: string, type: string) => void
  onStartGeneration: () => void
  onRetryTask: (taskId: string) => void
  onCancelTask: (taskId: string) => void
  onOpenConversation: (conversationId: string) => void
}

export function PipelineTimeline(props: PipelineTimelineProps) {
  const { status, pipeline, history } = props
  const [overrides, setOverrides] = useState<Partial<Record<StepKey, boolean>>>({})

  const ap = pipeline.agentProgress
  const runningKey = ap?.status === 'running' ? progressKey(ap.step) : undefined
  const errorKey = ap?.status === 'error' ? progressKey(ap.step) : undefined

  function stateFor(key: StepKey): StepState {
    // A live agent run / failure always wins — this is the authoritative
    // "current step" signal (fixes the stale runningAction bug).
    if (runningKey === key) return 'active'
    if (errorKey === key) return 'error'
    switch (key) {
      case 'extract': return pipeline.rawIdea ? 'completed' : 'pending'
      case 'breakdown': return pipeline.improvedBrief ? 'completed' : 'pending'
      case 'refine': return pipeline.refinedContent ? 'completed' : 'pending'
      case 'ai-review': return pipeline.aiReview ? 'completed' : 'pending'
      case 'human-review':
        if (PAST_HUMAN_REVIEW.includes(status)) return 'completed'
        if (status === 'human_review') return 'active'
        return 'pending'
      case 'generation':
        if (status === 'draft' || pipeline.draftOutput) return 'completed'
        if (status === 'generating') return 'active'
        return 'pending'
    }
  }

  function historyFor(key: StepKey): PipelineHistoryEntry[] {
    return history.filter((h) => historyKey(h.step) === key)
  }

  return (
    <div className='py-1'>
      {STEP_DEFS.map((def, i) => {
        const state = stateFor(def.key)
        const entries = historyFor(def.key)
        const latest = entries[entries.length - 1]
        const isLast = i === STEP_DEFS.length - 1
        const expanded = overrides[def.key] ?? state !== 'pending'

        return (
          <div key={def.key} className='flex gap-3'>
            {/* Rail: dot + connector */}
            <div className='flex flex-col items-center'>
              <StepDot state={state} stepKey={def.key} />
              {!isLast && (
                <div className={cn('w-px flex-1 my-1', state === 'completed' ? 'bg-[var(--anubis-success)]/40' : 'bg-border')} />
              )}
            </div>

            {/* Content */}
            <div className={cn('min-w-0 flex-1', isLast ? 'pb-1' : 'pb-5')}>
              <button
                type='button'
                onClick={() => setOverrides((o) => ({ ...o, [def.key]: !expanded }))}
                className='flex w-full items-center gap-2 text-left'
              >
                {expanded ? <ChevronDown className='size-3.5 shrink-0 text-muted-foreground' /> : <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />}
                <span className={cn(
                  'text-[13.5px] font-semibold',
                  state === 'completed' && 'text-foreground',
                  state === 'active' && 'text-[var(--anubis-gold)]',
                  state === 'error' && 'text-destructive',
                  state === 'pending' && 'text-muted-foreground/70',
                )}>
                  {def.label}
                </span>
                <StateBadge state={state} stepKey={def.key} />
                {latest ? <Timestamp ts={latest.createdAt} /> : null}
                {latest?.agent ? (
                  <span className='rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground'>{latest.agent}</span>
                ) : null}
                {state === 'active' && ap?.status === 'running' && runningKey === def.key && ap.message ? (
                  <span className='truncate text-[11px] text-[var(--anubis-gold)]/90'>· {ap.message}</span>
                ) : null}
                {RERUNNABLE.has(def.key) && state !== 'pending' && !props.busy ? (
                  <span
                    role='button'
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); props.onRerunStep(def.key as 'breakdown' | 'refine' | 'ai-review') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); props.onRerunStep(def.key as 'breakdown' | 'refine' | 'ai-review') } }}
                    className='ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-[var(--anubis-gold)]'
                    title={`Re-run ${def.label}`}
                  >
                    <RefreshCw className='size-3' /> Re-run
                  </span>
                ) : null}
              </button>

              {expanded ? (
                <div className='mt-2 space-y-2'>
                  <StepBody stepKey={def.key} state={state} {...props} />
                  <PriorAttempts stepKey={def.key} entries={entries} lessons={props.lessons} />
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StepDot({ state, stepKey }: { state: StepState; stepKey: StepKey }) {
  if (state === 'completed') return <CheckCircle2 className='size-6 text-[var(--anubis-success)]' />
  if (state === 'error') return <AlertCircle className='size-6 text-destructive' />
  if (state === 'active') {
    // Human review awaits a person — show a distinct icon, not a spinner.
    if (stepKey === 'human-review') {
      return (
        <span className='relative flex items-center justify-center'>
          <span className='absolute inset-0 animate-ping rounded-full bg-[var(--anubis-gold)]/30' style={{ animationDuration: '1.5s' }} />
          <UserCheck className='size-6 text-[var(--anubis-gold)]' />
        </span>
      )
    }
    return <Loader2 className='size-6 animate-spin text-[var(--anubis-gold)]' />
  }
  return <Circle className='size-6 text-muted-foreground/35' strokeWidth={1.5} />
}

function StateBadge({ state, stepKey }: { state: StepState; stepKey: StepKey }) {
  const label =
    state === 'completed' ? 'Done'
      : state === 'error' ? 'Error'
        : state === 'pending' ? 'Pending'
          : stepKey === 'human-review' ? 'Awaiting you'
            : stepKey === 'generation' ? 'Generating'
              : 'Running'
  const tone =
    state === 'completed' ? 'border-[var(--anubis-success)]/40 text-[var(--anubis-success)]'
      : state === 'error' ? 'border-destructive/45 text-destructive'
        : state === 'active' ? 'border-[var(--anubis-gold)]/45 text-[var(--anubis-gold)]'
          : 'border-border text-muted-foreground/70'
  return <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', tone)}>{label}</span>
}

function Timestamp({ ts }: { ts: number }) {
  return (
    <span className='inline-flex items-center gap-1 text-[10.5px] text-muted-foreground'>
      <Clock className='size-3' /> {new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

function StepBody({ stepKey, state, ...props }: { stepKey: StepKey; state: StepState } & PipelineTimelineProps) {
  const { pipeline, status, lessons, gen, busy } = props
  switch (stepKey) {
    case 'extract':
      return pipeline.rawIdea
        ? <RawIdeaSection raw={pipeline.rawIdea} itemId={pipeline.contentId} />
        : <Empty text='Not extracted yet. Run Auto-run to pull the raw idea from the reference.' />
    case 'breakdown':
      return pipeline.improvedBrief
        ? (
          <>
            {pipeline.rawIdea ? <LocalAssetStrip raw={pipeline.rawIdea as RawIdea} itemId={pipeline.contentId} /> : null}
            <BriefSection brief={pipeline.improvedBrief} lessonsUsed={lessons.map((l) => l.howToImprove)} />
          </>
        )
        : <Empty text='No brief yet.' />
    case 'refine':
      return pipeline.refinedContent
        ? <RefinedSection refined={pipeline.refinedContent} />
        : <Empty text='No refined content yet.' />
    case 'ai-review':
      return pipeline.aiReview
        ? <AiReviewSection review={pipeline.aiReview} />
        : <Empty text='No AI review yet.' />
    case 'human-review':
      if (status === 'human_review') {
        return <HumanReviewSection busy={busy} onApprove={props.onApprove} onReject={props.onReject} />
      }
      if (pipeline.humanReview && PAST_HUMAN_REVIEW.includes(status)) {
        return <HumanDecision review={pipeline.humanReview} />
      }
      return <Empty text='Reaches here after the AI review approves the content.' />
    case 'generation':
      return (
        <div className='space-y-2'>
          <GenerationQueueSection
            tasks={gen.tasks}
            busy={busy}
            onStart={props.onStartGeneration}
            onRetry={props.onRetryTask}
            onCancel={props.onCancelTask}
            onOpenConversation={props.onOpenConversation}
          />
          <DraftOutputSection draft={gen.draftOutput} />
        </div>
      )
  }
}

/** Render a single historic snapshot using the matching section renderer. */
function HistoryOutput({ entry }: { entry: PipelineHistoryEntry }) {
  const key = historyKey(entry.step)
  const id = `hist-${entry.id}`
  switch (key) {
    case 'extract': return <RawIdeaSection raw={entry.data as RawIdea} id={id} itemId={entry.contentId} />
    case 'breakdown': return <BriefSection brief={entry.data as ImprovedBrief} lessonsUsed={[]} id={id} />
    case 'refine': return <RefinedSection refined={entry.data as RefinedContent} id={id} />
    case 'ai-review': return <AiReviewSection review={entry.data as AiReview} id={id} />
    case 'human-review': return <HumanDecision review={entry.data as HumanReview} />
    default: return null
  }
}

/** Collapsible list of prior iterations for a step (everything but the latest). */
function PriorAttempts({ stepKey, entries, lessons: _lessons }: { stepKey: StepKey; entries: PipelineHistoryEntry[]; lessons: ContentLesson[] }) {
  const prior = entries.slice(0, -1)
  const [open, setOpen] = useState(false)
  if (prior.length === 0) return null
  return (
    <div className='rounded-md border border-dashed border-border/70 bg-muted/20'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground'
      >
        {open ? <ChevronDown className='size-3' /> : <ChevronRight className='size-3' />}
        {prior.length} previous attempt{prior.length > 1 ? 's' : ''}
      </button>
      {open ? (
        <div className='space-y-3 px-3 pb-3'>
          {prior.map((entry) => (
            <div key={entry.id}>
              <div className='mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground'>
                <span className='rounded border border-border px-1.5 py-0.5'>iteration {entry.iteration}</span>
                {entry.agent ? <span className='rounded border border-border px-1.5 py-0.5'>{entry.agent}</span> : null}
                <Timestamp ts={entry.createdAt} />
              </div>
              <HistoryOutput entry={entry} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function HumanDecision({ review }: { review: HumanReview }) {
  const approved = review.decision === 'approved'
  return (
    <div className={cn(
      'rounded-md border px-3 py-2 text-[12.5px]',
      approved
        ? 'border-[var(--anubis-success)]/45 bg-[var(--anubis-success)]/10 text-[var(--anubis-success)]'
        : 'border-destructive/45 bg-destructive/10 text-destructive',
    )}>
      <span className='font-semibold'>{approved ? 'Approved' : 'Rejected'}</span>
      {review.reason ? <span className='text-foreground/80'> — {review.reason}</span> : null}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className='rounded-md border border-dashed border-border/60 px-3 py-2 text-[12px] text-muted-foreground'>{text}</p>
}
