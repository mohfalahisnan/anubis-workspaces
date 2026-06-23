import { useEffect, useMemo, useState } from 'react'
import {
  CalendarIcon,
  DownloadCloudIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshCwIcon,
} from 'lucide-react'

import type {
  CandidateLevel,
  CandidateValidationStatus,
  CompetitorSummary,
  ResearchCandidateSummary,
  ResearchControls,
  ResearchSessionSummary,
} from '@anubis/shared'
import { useProject } from '@/lib/use-project'
import {
  createResearchSession,
  listCompetitors,
  saveCandidateAsIdea,
  updateResearchCandidate,
} from '@/api'
import { CandidateLevelBadge } from '@/components/research/candidate-level-badge'
import {
  CANDIDATE_LEVEL_LABEL,
  DEFAULT_DATE_FILTER,
  VALIDATION_LABEL,
  candidateValidationReason,
  filterCandidatesByDate,
  formatScore,
  type DateFilterState,
  type DatePreset,
} from '@/lib/research'
import { buildResearchExport } from '@/lib/research-export'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type Banner = { kind: 'error' | 'success'; message: string }
type ValidationFilter = 'all' | CandidateValidationStatus
type LevelFilter = 'all' | CandidateLevel

const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

const dateInput =
  'h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none transition-colors focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'

/** localStorage key for the per-project research session + scored candidates so
 *  they survive navigating away and back. */
function researchStorageKey(projectId: string | undefined): string {
  return `anubis:research:${projectId ?? 'default'}`
}

type PersistedResearch = {
  session: ResearchSessionSummary | null
  candidates: ResearchCandidateSummary[]
}

function loadPersistedResearch(projectId: string | undefined): PersistedResearch {
  try {
    const raw = window.localStorage.getItem(researchStorageKey(projectId))
    if (!raw) return { session: null, candidates: [] }
    const parsed = JSON.parse(raw) as PersistedResearch
    return {
      session: parsed.session ?? null,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    }
  } catch {
    return { session: null, candidates: [] }
  }
}

function formatBigNumber(n: number | undefined | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ResearchPage() {
  const { activeProject } = useProject()
  const projectId = activeProject?.id || undefined

  const [competitors, setCompetitors] = useState<CompetitorSummary[] | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [running, setRunning] = useState(false)
  const [session, setSession] = useState<ResearchSessionSummary | null>(null)
  const [candidates, setCandidates] = useState<ResearchCandidateSummary[]>([])
  const [detail, setDetail] = useState<ResearchCandidateSummary | null>(null)
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilterState>(DEFAULT_DATE_FILTER)

  // Research controls
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [platform, setPlatform] = useState('')
  const [maxPostsPerProfile, setMaxPostsPerProfile] = useState(20)
  const [maxContentAgeDays, setMaxContentAgeDays] = useState(7)

  async function refreshCompetitors() {
    try {
      setCompetitors(await listCompetitors(projectId))
    } catch (e) {
      setCompetitors([])
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load competitors.' })
    }
  }

  useEffect(() => {
    void refreshCompetitors()
    // Hydrate the previous research run for this project so it doesn't vanish
    // when the user navigates away and comes back.
    const persisted = loadPersistedResearch(projectId)
    setSession(persisted.session)
    setCandidates(persisted.candidates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Persist session + candidates whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        researchStorageKey(projectId),
        JSON.stringify({ session, candidates } satisfies PersistedResearch),
      )
    } catch {
      // Ignore quota / serialization errors — persistence is best-effort.
    }
  }, [projectId, session, candidates])

  function buildControls(): ResearchControls {
    return {
      favoriteOnly,
      platform: platform.trim() || undefined,
      maxPostsPerProfile,
      maxContentAgeDays,
    }
  }

  async function runResearch() {
    setRunning(true)
    setBanner(null)
    try {
      const { session: s, candidates: c } = await createResearchSession({ projectId, controls: buildControls() })
      setSession(s)
      setCandidates(c)
      await refreshCompetitors() // baselines were recomputed
      setBanner({
        kind: 'success',
        message: `Found ${s.counts.candidates} candidate(s): ${s.counts.green} high, ${s.counts.yellow} good, ${s.counts.neutral} weak.`,
      })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Research run failed.' })
    } finally {
      setRunning(false)
    }
  }

  async function setDecision(candidate: ResearchCandidateSummary, decision: ResearchCandidateSummary['decision']) {
    try {
      patchCandidate(await updateResearchCandidate(candidate.id, { decision }))
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update candidate.' })
    }
  }

  function patchCandidate(updated: ResearchCandidateSummary) {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    setDetail((prev) => (prev && prev.id === updated.id ? updated : prev))
  }

  async function saveAsIdea(candidate: ResearchCandidateSummary) {
    try {
      await saveCandidateAsIdea(candidate.id, projectId)
      setBanner({ kind: 'success', message: 'Saved to Content Planner as an idea. Open it in Content Studio.' })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save as idea.' })
    }
  }

  const visibleCandidates = useMemo(
    () =>
      filterCandidatesByDate(candidates, dateFilter, Date.now())
        .filter((c) => validationFilter === 'all' || c.validationStatus === validationFilter)
        .filter((c) => levelFilter === 'all' || c.candidateLevel === levelFilter)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [candidates, dateFilter, validationFilter, levelFilter],
  )

  const competitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c] as const)),
    [competitors],
  )

  function handleExportJson() {
    const file = buildResearchExport({
      candidates: visibleCandidates,
      competitorById,
      project: activeProject ? { id: activeProject.id, name: activeProject.name } : undefined,
      filters: { date: dateFilter, validation: validationFilter, level: levelFilter },
      exportedAt: Date.now(),
    })
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const slug = (activeProject?.name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const a = document.createElement('a')
    a.href = url
    a.download = `anubis-research-${slug || 'project'}-${date}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setBanner({
      kind: 'success',
      message: `Exported ${file.count} candidate post${file.count === 1 ? '' : 's'} as JSON.`,
    })
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-2 pt-7'>
          <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>Research</h1>
          <p className='max-w-2xl text-[14px] leading-relaxed text-muted-foreground'>
            Turn competitor posts into a clean list of validated content candidates, scored against each
            competitor's own baseline performance.
          </p>
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

        <div className='pt-6'>
          <SectionHead title='Research & candidates' subtitle='Pick scope, run the scorer, then review' />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            <Field label='Platform' hint='Blank = any'>
              <input className={textInput} value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder='instagram' />
            </Field>
            <Field label='Max posts / profile'>
              <input className={textInput} type='number' min={1} max={200} value={maxPostsPerProfile} onChange={(e) => setMaxPostsPerProfile(Math.max(1, Number(e.target.value) || 20))} />
            </Field>
            <Field label='Max content age (days)'>
              <input className={textInput} type='number' min={1} max={365} value={maxContentAgeDays} onChange={(e) => setMaxContentAgeDays(Math.max(1, Number(e.target.value) || 7))} />
            </Field>
            <label className='flex items-center gap-2 self-end pb-2 text-[13px] font-medium text-foreground'>
              <input type='checkbox' checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} className='size-4 accent-[var(--anubis-gold)]' />
              Favorite competitors only
            </label>
          </div>

          <div className='mt-4 flex flex-wrap items-center gap-2.5'>
            <button
              type='button'
              onClick={() => void runResearch()}
              disabled={running}
              className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              <PlayIcon className='size-[15px]' strokeWidth={2.4} />
              {running ? 'Running…' : 'Run research'}
            </button>
            <button
              type='button'
              onClick={() => void refreshCompetitors()}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
            <button
              type='button'
              onClick={handleExportJson}
              disabled={visibleCandidates.length === 0}
              title='Download the filtered candidates as detailed-post JSON'
              className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
            >
              <DownloadCloudIcon className='size-[15px]' strokeWidth={2} />
              Export JSON
            </button>
          </div>

          <div className='mt-5 mb-3 flex flex-col gap-2.5'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-[12.5px] text-muted-foreground'>
                {session ? `${visibleCandidates.length} shown of ${candidates.length}` : 'Run research to populate'}
              </span>
              <div className='ml-auto flex flex-wrap gap-2'>
                <SegmentedFilter
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'valid', label: 'Valid' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'invalid', label: 'Invalid' },
                  ]}
                  value={validationFilter}
                  onChange={(v) => setValidationFilter(v as ValidationFilter)}
                />
                <SegmentedFilter
                  options={[
                    { value: 'all', label: 'Any level' },
                    { value: 'green', label: 'High' },
                    { value: 'yellow', label: 'Good' },
                    { value: 'neutral', label: 'Weak' },
                  ]}
                  value={levelFilter}
                  onChange={(v) => setLevelFilter(v as LevelFilter)}
                />
              </div>
            </div>
            <DateFilterControl value={dateFilter} onChange={setDateFilter} />
          </div>
          <CandidateTable
            candidates={visibleCandidates}
            competitorById={competitorById}
            onOpen={(c) => setDetail(c)}
            onDecision={(c, d) => void setDecision(c, d)}
          />
        </div>
      </div>

      {/* Candidate detail drawer */}
      <CandidateDetailSheet
        candidate={detail}
        competitor={detail ? competitorById.get(detail.competitorId) : undefined}
        onClose={() => setDetail(null)}
        onDecision={(c, d) => void setDecision(c, d)}
        onSaveAsIdea={(c) => void saveAsIdea(c)}
      />
    </div>
  )
}

/* ---------- Layout helpers ---------- */

function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className='mb-3'>
      <h2 className='text-[16px] font-semibold tracking-[-0.01em]'>{title}</h2>
      {subtitle && <p className='text-[12.5px] text-muted-foreground'>{subtitle}</p>}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label className='text-[12.5px] font-medium text-foreground'>{label}</label>
      {children}
      {hint && <p className='text-[11.5px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function SegmentedFilter({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className='inline-flex rounded-md border border-border bg-card p-0.5'>
      {options.map((opt) => (
        <button
          key={opt.value}
          type='button'
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
            value === opt.value ? 'bg-[var(--anubis-gold)] text-[#0B0C0F]' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const DATE_PRESETS: { preset: DatePreset; label: string }[] = [
  { preset: 'all', label: 'All' },
  { preset: '7d', label: '7d' },
  { preset: '30d', label: '30d' },
  { preset: '90d', label: '90d' },
]

function DateFilterControl({
  value,
  onChange,
}: {
  value: DateFilterState
  onChange: (next: DateFilterState) => void
}) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <span className='inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground'>
        <CalendarIcon className='size-3.5' strokeWidth={2} />
        Date
      </span>
      <div className='inline-flex rounded-md border border-border bg-card p-0.5'>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.preset}
            type='button'
            onClick={() => onChange({ preset: p.preset })}
            className={cn(
              'rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
              value.preset === p.preset
                ? 'bg-[var(--anubis-gold)] text-[#0B0C0F]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className='flex items-center gap-1.5'>
        <input
          type='date'
          aria-label='From date'
          value={value.from ?? ''}
          max={value.to || undefined}
          onChange={(e) => onChange({ preset: 'custom', from: e.target.value || undefined, to: value.to })}
          className={dateInput}
        />
        <span className='text-[12px] text-muted-foreground'>–</span>
        <input
          type='date'
          aria-label='To date'
          value={value.to ?? ''}
          min={value.from || undefined}
          onChange={(e) => onChange({ preset: 'custom', from: value.from, to: e.target.value || undefined })}
          className={dateInput}
        />
      </div>
    </div>
  )
}

/* ---------- Candidate table ---------- */

function CandidateTable({
  candidates,
  competitorById,
  onOpen,
  onDecision,
}: {
  candidates: ResearchCandidateSummary[]
  competitorById: Map<string, CompetitorSummary>
  onOpen: (c: ResearchCandidateSummary) => void
  onDecision: (c: ResearchCandidateSummary, decision: ResearchCandidateSummary['decision']) => void
}) {
  if (candidates.length === 0) {
    return <p className='rounded-md border border-dashed border-border bg-card/50 px-4 py-8 text-center text-[13px] text-muted-foreground'>No candidates to show.</p>
  }
  return (
    <div className='overflow-hidden rounded-md border border-border bg-card'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[900px] border-collapse text-left text-[13px]'>
          <thead className='border-b border-border bg-background/50 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
            <tr>
              <th className='px-3 py-2.5 font-medium'>Status</th>
              <th className='px-3 py-2.5 font-medium'>Competitor</th>
              <th className='px-3 py-2.5 font-medium'>Date</th>
              <th className='px-3 py-2.5 text-right font-medium'>Likes</th>
              <th className='px-3 py-2.5 text-right font-medium'>Baseline</th>
              <th className='px-3 py-2.5 text-right font-medium'>Score</th>
              <th className='px-3 py-2.5 font-medium'>Level</th>
              <th className='px-3 py-2.5 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const competitor = competitorById.get(c.competitorId)
              return (
                <tr key={c.id} className='border-b border-border/70 last:border-0 hover:bg-muted/40'>
                  <td className='px-3 py-3'><ValidationPill status={c.validationStatus} decision={c.decision} /></td>
                  <td className='px-3 py-3'>
                    <div className='font-mono text-[12px] font-semibold text-foreground'>{competitor?.handle ?? c.competitorId}</div>
                    <div className='text-[11px] text-muted-foreground'>{c.platform ?? 'instagram'}</div>
                  </td>
                  <td className='px-3 py-3 font-mono text-[11.5px] text-muted-foreground'>{formatDate(c.postedAt)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.likes)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatBigNumber(c.baselineLikes)}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{formatScore(c.score)}</td>
                  <td className='px-3 py-3'><CandidateLevelBadge level={c.candidateLevel} /></td>
                  <td className='px-3 py-3'>
                    <div className='flex justify-end gap-1'>
                      {c.postUrl && (
                        <a
                          href={c.postUrl}
                          target='_blank'
                          rel='noreferrer'
                          aria-label='View post'
                          className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                        >
                          <ExternalLinkIcon className='size-3.5' strokeWidth={2} />
                        </a>
                      )}
                      <button type='button' onClick={() => onOpen(c)} className='inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'>
                        Details
                      </button>
                      <button type='button' onClick={() => onDecision(c, 'saved')} className='inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] hover:text-[var(--anubis-gold)]'>
                        Save
                      </button>
                      <button type='button' onClick={() => onDecision(c, 'rejected')} className='inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive'>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ValidationPill({ status, decision }: { status: CandidateValidationStatus; decision: ResearchCandidateSummary['decision'] }) {
  const color = status === 'valid' ? '#5E8F55' : status === 'invalid' ? '#B5483E' : '#C9A645'
  return (
    <div className='flex flex-col items-start gap-1'>
      <span className='inline-flex items-center gap-1.5 text-[11.5px] font-medium' style={{ color }}>
        <span aria-hidden className='size-1.5 rounded-full' style={{ background: color }} />
        {VALIDATION_LABEL[status]}
      </span>
      {decision !== 'none' && (
        <span className='rounded border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground'>{decision}</span>
      )}
    </div>
  )
}

/* ---------- Detail drawer ---------- */

function CandidateDetailSheet({
  candidate,
  competitor,
  onClose,
  onDecision,
  onSaveAsIdea,
}: {
  candidate: ResearchCandidateSummary | null
  competitor: CompetitorSummary | undefined
  onClose: () => void
  onDecision: (c: ResearchCandidateSummary, decision: ResearchCandidateSummary['decision']) => void
  onSaveAsIdea: (c: ResearchCandidateSummary) => void
}) {
  return (
    <Sheet open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className='flex flex-col gap-4 overflow-y-auto'>
        {candidate && (
          <>
            <SheetHeader>
              <SheetTitle>{competitor?.handle ?? candidate.competitorId}</SheetTitle>
              <SheetDescription>{formatDate(candidate.postedAt)} · {candidate.platform ?? 'instagram'}</SheetDescription>
            </SheetHeader>

            <div className='flex items-center gap-2'>
              <CandidateLevelBadge level={candidate.candidateLevel} score={candidate.score} />
              <span className='text-[12px] text-muted-foreground'>{CANDIDATE_LEVEL_LABEL[candidate.candidateLevel]}</span>
            </div>

            {candidate.postUrl && (
              <a href={candidate.postUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1.5 text-[12.5px] text-[var(--anubis-gold)] hover:underline'>
                <ExternalLinkIcon className='size-3.5' /> Open original post
              </a>
            )}

            {candidate.caption && (
              <p className='whitespace-pre-wrap rounded-md border border-border bg-background/40 p-3 text-[12.5px] leading-relaxed text-foreground'>
                {candidate.caption}
              </p>
            )}

            <dl className='grid grid-cols-2 gap-3 text-[12.5px]'>
              <Detail label='Likes' value={formatBigNumber(candidate.likes)} />
              <Detail label='Baseline likes' value={formatBigNumber(candidate.baselineLikes)} />
              <Detail label='Score' value={formatScore(candidate.score)} />
              <Detail label='Competitor level' value={candidate.competitorLevel} />
            </dl>

            <div className='rounded-md border border-border bg-background/40 p-3'>
              <div className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>Validation</div>
              <div className='mt-1 text-[13px] font-medium'>{VALIDATION_LABEL[candidate.validationStatus]}</div>
              <p className='mt-1 text-[12px] text-muted-foreground'>{candidateValidationReason(candidate)}</p>
            </div>

            <div className='mt-auto flex flex-col gap-2 pt-2'>
              <button type='button' onClick={() => onSaveAsIdea(candidate)} className='inline-flex h-9 items-center justify-center rounded-md bg-[var(--anubis-gold)] px-3 text-[13px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]'>Save as idea → Content Studio</button>
              <div className='flex gap-2'>
                <button type='button' onClick={() => onDecision(candidate, 'saved')} className='inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border px-3 text-[13px] font-medium text-foreground hover:bg-muted'>Save to library</button>
                <button type='button' onClick={() => onDecision(candidate, 'rejected')} className='inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground hover:text-destructive'>Reject</button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</dt>
      <dd className='font-mono text-[13px] tabular-nums text-foreground'>{value}</dd>
    </div>
  )
}
