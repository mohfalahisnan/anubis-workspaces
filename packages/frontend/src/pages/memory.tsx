import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  BrainIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  RefreshCwIcon,
  ScrollTextIcon,
} from 'lucide-react'

import type { AgentRunSummary, ExperienceMemorySummary } from '@anubis/shared'

import { listAgentRuns, listExperienceMemories, promoteMemory } from '@/api'
import { useActiveWorkspace } from '@/lib/workspace'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Banner = { kind: 'error' | 'success'; message: string }

const STATUS_FILTERS = ['all', 'candidate', 'active', 'reinforced', 'deprecated'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export function MemoryPage() {
  const { activeWorkspaceId } = useActiveWorkspace()

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        <div className='pt-7'>
          <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>
            Memory
          </h1>
          <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
            Experience memories your agents have accumulated, and the log of past
            agent runs — scoped to the active workspace.
          </p>
        </div>

        <Tabs defaultValue='memories' className='mt-6'>
          <TabsList>
            <TabsTrigger value='memories'>Memories</TabsTrigger>
            <TabsTrigger value='runs'>Run Log</TabsTrigger>
          </TabsList>
          <TabsContent value='memories'>
            <MemoriesTab workspaceId={activeWorkspaceId} />
          </TabsContent>
          <TabsContent value='runs'>
            <RunsTab workspaceId={activeWorkspaceId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/* ---------------- Memories tab ---------------- */

function MemoriesTab({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<ExperienceMemorySummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setItems(await listExperienceMemories(workspaceId))
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load memories.',
      })
    }
  }, [workspaceId])

  useEffect(() => {
    setItems(null)
    void refresh()
  }, [refresh])

  async function handlePromote(id: string) {
    setBusy(true)
    setBanner(null)
    try {
      await promoteMemory(id)
      await refresh()
      setBanner({ kind: 'success', message: 'Memory promoted to active.' })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Promote failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  const visible = (items ?? []).filter((m) => filter === 'all' || m.status === filter)

  return (
    <div className='mt-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => setFilter(s)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[12px] capitalize transition-colors',
              filter === s
                ? 'border-[var(--anubis-gold)] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {s}
          </button>
        ))}
        <button
          type='button'
          onClick={() => void refresh()}
          className='ml-auto inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <RefreshCwIcon className='size-[14px]' strokeWidth={2} />
          Refresh
        </button>
      </div>

      {banner && <BannerView banner={banner} />}

      {items === null ? (
        <LoadingRows />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<BrainIcon className='size-7 text-muted-foreground' strokeWidth={1.5} />}
          title='No memories yet'
          body='Memories are created when your agents receive feedback. Promote candidates here to make them active.'
        />
      ) : (
        <div className='mt-5 flex flex-col gap-2'>
          {visible.map((m) => (
            <MemoryCard
              key={m.id}
              m={m}
              busy={busy}
              onPromote={() => void handlePromote(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MemoryCard({
  m,
  busy,
  onPromote,
}: {
  m: ExperienceMemorySummary
  busy: boolean
  onPromote: () => void
}) {
  return (
    <div className='rounded-md border border-border bg-card p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge status={m.status} />
            <SeverityBadge severity={m.severity} />
            <span className='rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground'>
              {m.type}
            </span>
            {m.scope === 'global' && (
              <span className='rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground'>
                global
              </span>
            )}
            {m.platform && (
              <span className='text-[11px] text-muted-foreground'>{m.platform}</span>
            )}
          </div>
          <h3 className='mt-2 truncate text-[14px] font-medium text-foreground'>{m.title}</h3>
          <p className='mt-1 text-[13px] leading-relaxed text-muted-foreground'>{m.problem}</p>
          {m.correction && m.correction !== m.problem && (
            <p className='mt-1 text-[13px] leading-relaxed text-foreground/80'>
              <span className='text-muted-foreground'>Fix: </span>
              {m.correction}
            </p>
          )}
        </div>
        {m.status === 'candidate' && (
          <button
            type='button'
            onClick={onPromote}
            disabled={busy}
            className='inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--anubis-gold)] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--anubis-gold)_20%,transparent)] disabled:opacity-50'
          >
            <CheckCircle2Icon className='size-[14px]' strokeWidth={2} />
            Promote
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- Run log tab ---------------- */

function RunsTab({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<AgentRunSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setItems(await listAgentRuns(workspaceId))
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load run log.',
      })
    }
  }, [workspaceId])

  useEffect(() => {
    setItems(null)
    void refresh()
  }, [refresh])

  return (
    <div className='mt-4'>
      <div className='flex items-center'>
        <button
          type='button'
          onClick={() => void refresh()}
          className='ml-auto inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <RefreshCwIcon className='size-[14px]' strokeWidth={2} />
          Refresh
        </button>
      </div>

      {banner && <BannerView banner={banner} />}

      {items === null ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ScrollTextIcon className='size-7 text-muted-foreground' strokeWidth={1.5} />}
          title='No agent runs yet'
          body='Agent runs are recorded when your agents execute content tasks against this workspace.'
        />
      ) : (
        <div className='mt-5 overflow-hidden rounded-md border border-border bg-card'>
          <table className='w-full border-collapse'>
            <thead>
              <tr className='border-b border-border bg-background/50 text-left'>
                <Th>When</Th>
                <Th>Task</Th>
                <Th>Agent</Th>
                <Th>Intent</Th>
                <Th className='text-right pr-4'>Result</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((run) => {
                const isOpen = expanded === run.id
                return (
                  <Fragment key={run.id}>
                    <tr
                      className={cn(
                        'cursor-pointer border-b border-border transition-colors hover:bg-muted/40',
                        isOpen && 'bg-muted/40',
                      )}
                      onClick={() => setExpanded(isOpen ? null : run.id)}
                    >
                      <Td className='text-muted-foreground'>
                        <span className='inline-flex items-center gap-2'>
                          <ChevronDownIcon
                            className={cn(
                              'size-3.5 text-muted-foreground transition-transform',
                              !isOpen && '-rotate-90',
                            )}
                            strokeWidth={2}
                          />
                          {relativeTime(run.createdAt)}
                        </span>
                      </Td>
                      <Td>
                        <span className='font-mono text-[12px] text-foreground'>{run.taskType}</span>
                      </Td>
                      <Td className='text-muted-foreground'>{run.agentId}</Td>
                      <Td className='max-w-[280px] truncate text-muted-foreground'>{run.intent}</Td>
                      <Td className='text-right pr-4'>
                        <ValidationBadge status={run.validationStatus} />
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr className='border-b border-border bg-background/40'>
                        <td colSpan={5} className='px-4 py-4'>
                          <RunDetail run={run} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RunDetail({ run }: { run: AgentRunSummary }) {
  const retrieved =
    run.retrievedChunkIds.length +
    run.retrievedDecisionIds.length +
    run.retrievedExperienceMemoryIds.length +
    run.retrievedSimilarityItemIds.length

  return (
    <div className='flex flex-col gap-3'>
      <Field label='User input' value={run.userInput} mono />
      <Field label='Output' value={run.output} mono />
      {run.errorSummary && <Field label={`Error (${run.errorType ?? 'unknown'})`} value={run.errorSummary} mono />}
      {run.humanFeedback && <Field label='Human feedback' value={run.humanFeedback} />}
      <div className='flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground'>
        {run.platform && <span>Platform: <span className='text-foreground/80'>{run.platform}</span></span>}
        <span>Retrieved context items: <span className='text-foreground/80'>{retrieved}</span></span>
        {run.contextPackId && (
          <span>Pack: <span className='font-mono text-foreground/80'>{run.contextPackId}</span></span>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className='mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
        {label}
      </p>
      <pre
        className={cn(
          'whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-[12px] leading-[1.6] text-foreground',
          mono && 'font-mono',
        )}
      >
        {value.trim()}
      </pre>
    </div>
  )
}

/* ---------------- shared bits ---------------- */

function StatusBadge({ status }: { status: ExperienceMemorySummary['status'] }) {
  const tone: Record<ExperienceMemorySummary['status'], string> = {
    candidate: 'border-border text-muted-foreground',
    active: 'border-[var(--anubis-gold)] text-foreground',
    reinforced: 'border-[var(--anubis-gold)] text-foreground',
    deprecated: 'border-border text-muted-foreground line-through',
    rejected: 'border-destructive/50 text-destructive',
  }
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10.5px] font-medium capitalize', tone[status])}>
      {status}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: ExperienceMemorySummary['severity'] }) {
  const tone: Record<ExperienceMemorySummary['severity'], string> = {
    low: 'text-muted-foreground',
    medium: 'text-foreground/70',
    high: 'text-foreground',
    critical: 'text-destructive',
  }
  return <span className={cn('text-[10.5px] font-medium uppercase tracking-wide', tone[severity])}>{severity}</span>
}

function ValidationBadge({ status }: { status: AgentRunSummary['validationStatus'] }) {
  const tone: Record<AgentRunSummary['validationStatus'], string> = {
    passed: 'border-[var(--anubis-gold)] text-foreground',
    failed: 'border-destructive/50 text-destructive',
    needs_review: 'border-border text-muted-foreground',
  }
  const label = status === 'needs_review' ? 'needs review' : status
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize', tone[status])}>
      {label}
    </span>
  )
}

function BannerView({ banner }: { banner: Banner }) {
  return (
    <div
      role='status'
      className={cn(
        'mt-4 rounded-md border px-3.5 py-2.5 text-[13px]',
        banner.kind === 'error'
          ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
          : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
      )}
    >
      {banner.message}
    </div>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 align-middle text-[13px]', className)}>{children}</td>
}

function LoadingRows() {
  return (
    <div className='mt-5 overflow-hidden rounded-md border border-border bg-card'>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className='h-12 animate-pulse border-b border-border bg-card last:border-b-0' />
      ))}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className='mt-8 flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center'>
      {icon}
      <div>
        <h2 className='text-[16px] font-semibold tracking-[-0.01em]'>{title}</h2>
        <p className='mt-1.5 max-w-md text-[13px] text-muted-foreground'>{body}</p>
      </div>
    </div>
  )
}

function relativeTime(ms: number): string {
  const d = Date.now() - ms
  const min = Math.round(d / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}
