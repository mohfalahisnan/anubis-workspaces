import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeftIcon, DownloadCloudIcon, ExternalLinkIcon, HeartIcon, MessageCircleIcon } from 'lucide-react'

import type {
  CapturedPostSummary,
  CompetitorLevel,
  CompetitorSummary,
  JobSummary,
} from '@anubis/shared'
import { CAPTURE_CHUNK_SIZE } from '@anubis/shared'

import { captureCompetitorsBatch, listCompetitors, listPosts } from '@/api'
import { useNavigation } from '@/lib/navigation'
import { useProject } from '@/lib/use-project'
import { useJobs } from '@/lib/use-jobs'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { LEVEL_COLOR, resolveLevel } from '@/lib/competitor-level'
import {
  SearchBox,
  SortControl,
  useSorted,
  type SortOption,
  type SortState,
} from '@/components/list-controls'
import {
  Checkbox,
  Field,
  JobProgressPanel,
  LevelBadge,
  LEVEL_LABEL,
  ListSkeleton,
  RunOptionsPanel,
  formatBigNumber,
  relativeTime,
  textInput,
  usernameKey,
  type RunMode,
} from './competitor-actions'
import { cn } from '@/lib/utils'

/* ===========================================================
   Capture Posts page
   ===========================================================
   Dedicated page (replacing the old selection modal) for the
   batch post-capture flow. The user picks which tracked
   competitors to crawl + run options; submitting enqueues a
   single chunked background job. The page renders that job's
   live progress and the posts it persists — refreshed from the
   database as each profile completes, so results stream in.

   The job lives in the shared `useJobs` store (backed by the
   backend SSE feed), so leaving and returning to the page —
   with the job id carried in the route — restores progress and
   results without restarting or cancelling the run.
   =========================================================== */

type LevelFilter = 'all' | CompetitorLevel

const LEVEL_FILTERS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red', label: 'Red' },
  { value: 'black', label: 'Black' },
]

type PostSortKey = 'recent' | 'likes' | 'comments'

const POST_SORT_OPTIONS: readonly SortOption<PostSortKey>[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'likes', label: 'Likes' },
  { value: 'comments', label: 'Comments' },
]

const POST_SORT_ACCESSORS: Record<PostSortKey, (p: CapturedPostSummary) => unknown> = {
  recent: (p) => p.capturedAt,
  likes: (p) => p.likes,
  comments: (p) => p.comments,
}

export function CapturePostsPage({
  jobId,
  competitorIds,
}: {
  jobId?: string
  competitorIds?: string[]
}) {
  const { navigate } = useNavigation()
  const { activeProject } = useProject()
  const { config: levelsConfig } = useCompetitorLevels()
  const jobs = useJobs((s) => s.jobs)
  const stop = useJobs((s) => s.stop)

  const [items, setItems] = useState<CompetitorSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(competitorIds ?? []))
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [targetPostsPerProfile, setTargetPostsPerProfile] = useState(12)
  const [runMode, setRunMode] = useState<RunMode>('public')
  const [headless, setHeadless] = useState(true)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  // The job this page follows: the one named in the route, or the most recent
  // capture job for the active project, so returning re-attaches to a live run.
  const job = useMemo<JobSummary | null>(() => {
    if (jobId) return jobs.find((j) => j.id === jobId) ?? null
    return (
      jobs
        .filter(
          (j) =>
            (j.kind === 'capture-posts-batch' || j.kind === 'capture-posts') &&
            (!activeProject?.id || j.projectId === activeProject.id),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    )
  }, [jobs, jobId, activeProject?.id])

  useEffect(() => {
    let active = true
    setItems(null)
    setLoadError(null)
    listCompetitors(activeProject?.id)
      .then((rows) => {
        if (!active) return
        const unique = dedupeCompetitors(rows)
        setItems(unique)
        // Keep any preseeded selection that still resolves to a tracked id.
        setSelected((prev) => {
          const ids = new Set(unique.map((c) => c.id))
          const next = new Set([...prev].filter((id) => ids.has(id)))
          // No preselection? Default to previously-refreshed handles, matching
          // the "update what I've already pulled" common case.
          if (next.size === 0 && (!competitorIds || competitorIds.length === 0)) {
            for (const c of unique) if (c.lastRefreshedAt) next.add(c.id)
          }
          return next
        })
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Could not load competitors.')
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id])

  const levelOf = (c: CompetitorSummary): CompetitorLevel => resolveLevel(c.followers, c.level, levelsConfig)
  const visibleItems = (items ?? []).filter((c) => levelFilter === 'all' || levelOf(c) === levelFilter)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectByLevel(level: CompetitorLevel) {
    if (!items) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of items) if (levelOf(c) === level) next.add(c.id)
      return next
    })
  }

  const running = job ? job.state === 'queued' || job.state === 'running' || job.state === 'stopping' : false
  const count = selected.size

  async function handleCapture(e: FormEvent) {
    e.preventDefault()
    if (count === 0 || starting || running || !items) return
    setStarting(true)
    setStartError(null)
    try {
      // Preserve grid order so the batch processes top-to-bottom as shown.
      const order = new Map(items.map((c, i) => [c.id, i]))
      const ids = [...selected].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      const { jobId: newJobId } = await captureCompetitorsBatch(ids, {
        profile: runMode,
        headless,
        forceHeadless: runMode === 'login' && headless,
        targetPosts: targetPostsPerProfile,
      })
      navigate({ page: 'capture-posts', jobId: newJobId })
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not start capture.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1180px] px-7 pb-12'>
        <div className='flex flex-col gap-4 pt-7'>
          <button
            type='button'
            onClick={() => navigate({ page: 'competitors' })}
            className='inline-flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground'
          >
            <ArrowLeftIcon className='size-3.5' strokeWidth={2} />
            Back to competitors
          </button>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>Capture posts</h1>
            <p className='mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground'>
              Crawl posts from your tracked competitors. The run is chunked (max {CAPTURE_CHUNK_SIZE}{' '}
              profiles per chunk, with short cooldowns) and persists to the content library as it goes —
              you can leave this page and come back without losing progress.
            </p>
          </div>
        </div>

        <div className='mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]'>
          {/* Selection + options */}
          <form
            onSubmit={handleCapture}
            className='flex h-fit flex-col rounded-md border border-border bg-card'
          >
            <div className='border-b border-border px-4 py-3'>
              <div className='flex items-center justify-between'>
                <h2 className='text-[14px] font-semibold'>Competitors</h2>
                <span className='font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground'>
                  {count} selected
                </span>
              </div>
              <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
                {LEVEL_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type='button'
                    onClick={() => setLevelFilter(filter.value)}
                    className={cn(
                      'inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors',
                      levelFilter === filter.value
                        ? 'border-[color-mix(in_oklab,var(--anubis-gold)_58%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className='mt-2 flex flex-wrap items-center gap-2 text-[12px]'>
                <span className='text-[11px] text-muted-foreground'>Quick select</span>
                {(['green', 'yellow', 'red'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type='button'
                    onClick={() => selectByLevel(lvl)}
                    className='inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    <span aria-hidden className='size-2 rounded-full' style={{ background: LEVEL_COLOR[lvl] }} />
                    All {LEVEL_LABEL[lvl]}
                  </button>
                ))}
                <div className='ml-auto flex items-center gap-2'>
                  <button
                    type='button'
                    onClick={() => setSelected(new Set(visibleItems.map((c) => c.id)))}
                    className='text-[var(--anubis-gold)] hover:underline'
                  >
                    Select all
                  </button>
                  <span className='text-muted-foreground'>·</span>
                  <button
                    type='button'
                    onClick={() => setSelected(new Set())}
                    className='text-muted-foreground hover:text-foreground hover:underline'
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className='max-h-[min(45vh,360px)] overflow-y-auto px-2 py-2'>
              {loadError && (
                <p className='m-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12.5px] text-destructive'>
                  {loadError}
                </p>
              )}
              {items === null ? (
                <ListSkeleton />
              ) : items.length === 0 ? (
                <p className='m-4 text-[13px] text-muted-foreground'>
                  No competitors tracked yet. Add some on the Competitors page first.
                </p>
              ) : visibleItems.length === 0 ? (
                <p className='m-4 text-[13px] text-muted-foreground'>No tracked competitors match this level.</p>
              ) : (
                <ul className='py-1'>
                  {visibleItems.map((c) => {
                    const isSelected = selected.has(c.id)
                    return (
                      <li key={c.id}>
                        <button
                          type='button'
                          onClick={() => toggle(c.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                            isSelected
                              ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)]'
                              : 'hover:bg-muted',
                          )}
                        >
                          <Checkbox checked={isSelected} />
                          <span
                            aria-hidden
                            className='flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white/85'
                            style={{ background: c.tint ?? '#565B63' }}
                          >
                            {c.handle.replace('@', '').slice(0, 1).toUpperCase()}
                          </span>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate font-mono text-[12.5px] text-foreground'>{c.handle}</span>
                              <LevelBadge level={levelOf(c)} />
                            </div>
                            <div className='truncate text-[11.5px] text-muted-foreground'>
                              {c.lastRefreshedAt ? `Last refreshed ${relativeTime(c.lastRefreshedAt)}` : 'Never refreshed'}
                              {c.niche ? ` · ${c.niche}` : ''}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className='flex flex-col gap-4 border-t border-border px-4 py-4'>
              <Field
                label='Target posts per profile'
                htmlFor='capture-target-posts'
                hint='Upper bound on posts fetched per handle.'
              >
                <input
                  id='capture-target-posts'
                  type='number'
                  min={1}
                  max={120}
                  value={targetPostsPerProfile}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setTargetPostsPerProfile(Number.isFinite(n) ? Math.min(120, Math.max(1, Math.floor(n))) : 12)
                  }}
                  className={textInput}
                />
              </Field>
              <RunOptionsPanel
                profile={runMode}
                headless={headless}
                onProfileChange={(p) => {
                  setRunMode(p)
                  setHeadless(p === 'public')
                }}
                onHeadlessChange={setHeadless}
                allowProfilePick
              />

              {startError && (
                <p className='rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12.5px] text-destructive'>
                  {startError}
                </p>
              )}

              <button
                type='submit'
                disabled={count === 0 || starting || running}
                className={cn(
                  'inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                  count === 0 || starting || running
                    ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                    : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
                )}
              >
                <DownloadCloudIcon className='size-[15px]' strokeWidth={2.2} />
                {running ? 'Capture running…' : starting ? 'Starting…' : `Capture ${count > 0 ? count : ''}`}
              </button>
            </div>
          </form>

          {/* Progress + results */}
          <div className='flex flex-col gap-5'>
            {job ? (
              <>
                <JobProgressPanel job={job} onStop={(id) => void stop(id)} />
                <CaptureResults job={job} />
              </>
            ) : (
              <div className='flex h-full min-h-[220px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/40 px-6 py-10 text-center'>
                <DownloadCloudIcon className='size-6 text-muted-foreground' strokeWidth={1.5} />
                <p className='text-[13px] text-muted-foreground'>
                  Pick competitors on the left and hit Capture. Progress and captured posts appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Results ---------- */

function CaptureResults({ job }: { job: JobSummary }) {
  const { activeProject } = useProject()
  const [posts, setPosts] = useState<CapturedPostSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<PostSortKey>>({ key: 'recent', dir: 'desc' })

  const running = job.state === 'queued' || job.state === 'running' || job.state === 'stopping'
  // Posts persisted at/after the run started belong to this capture. A small
  // skew absorbs clock jitter between the job clock and the persisted rows.
  const since = (job.startedAt ?? job.createdAt) - 5_000
  // Re-fetch as profiles complete (drives the realtime stream) and on the final
  // state transition. While running we also poll on a light interval, so even a
  // single-profile job (no chunk counters) surfaces its posts promptly.
  const profilesCompleted = job.progress.profilesCompleted

  useEffect(() => {
    let active = true
    const fetchPosts = () => {
      listPosts({ projectId: activeProject?.id || undefined, orderBy: 'recent', limit: 300 })
        .then((rows) => {
          if (!active) return
          setPosts(rows.filter((p) => p.capturedAt >= since))
        })
        .catch(() => {
          if (active && posts === null) setPosts([])
        })
    }
    fetchPosts()
    const timer = running ? setInterval(fetchPosts, 5_000) : null
    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.state, profilesCompleted, activeProject?.id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = posts ?? []
    if (!q) return list
    return list.filter((p) =>
      [p.username, p.competitorHandle, p.caption].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [posts, query])
  const visible = useSorted(filtered, sort, POST_SORT_ACCESSORS)

  const total = posts?.length ?? 0

  return (
    <div className='flex flex-col gap-3 rounded-md border border-border bg-card'>
      <div className='flex flex-col gap-3 border-b border-border px-4 py-3'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-[15px] font-semibold tracking-[-0.01em]'>
            {total} post{total === 1 ? '' : 's'} captured
            {running && <span className='ml-2 text-[12px] font-normal text-muted-foreground'>· streaming…</span>}
          </h2>
        </div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder='Search handle, caption…'
            className='w-full sm:w-[280px]'
          />
          <SortControl options={POST_SORT_OPTIONS} value={sort} onChange={setSort} className='ml-auto' />
        </div>
      </div>

      <div className='max-h-[min(64vh,620px)] overflow-y-auto p-3'>
        {posts === null ? (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className='aspect-square animate-pulse rounded-md border border-border bg-background/60' />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className='m-4 text-center text-[13px] text-muted-foreground'>
            {running
              ? 'No posts persisted yet — they appear here as each profile finishes.'
              : 'No posts were captured for this run.'}
          </p>
        ) : (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            {visible.map((post) => (
              <PostTile key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PostTile({ post }: { post: CapturedPostSummary }) {
  const [failed, setFailed] = useState(false)
  const showImage = !!post.mediaUrl && !failed
  return (
    <a
      href={post.postUrl}
      target='_blank'
      rel='noreferrer'
      className='group relative flex flex-col overflow-hidden rounded-md border border-border bg-background/40 transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_30%,var(--border))]'
    >
      <div className='relative aspect-square w-full overflow-hidden bg-muted'>
        {showImage ? (
          <img
            src={post.mediaUrl}
            alt=''
            loading='lazy'
            onError={() => setFailed(true)}
            className='h-full w-full object-cover transition-transform group-hover:scale-[1.03]'
          />
        ) : (
          <div className='flex h-full w-full items-center justify-center text-[11px] text-muted-foreground'>
            No preview
          </div>
        )}
        <span className='absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100'>
          <ExternalLinkIcon className='size-3' strokeWidth={2} />
          Open
        </span>
      </div>
      <div className='flex flex-col gap-1 p-2'>
        <span className='truncate font-mono text-[11.5px] text-foreground'>
          {post.competitorHandle ?? `@${post.username}`}
        </span>
        {post.caption && (
          <span className='line-clamp-2 text-[11px] leading-snug text-muted-foreground'>{post.caption}</span>
        )}
        <div className='mt-0.5 flex items-center gap-3 font-mono text-[10.5px] tabular-nums text-muted-foreground'>
          <span className='inline-flex items-center gap-1'>
            <HeartIcon className='size-3' strokeWidth={2} />
            {formatBigNumber(post.likes)}
          </span>
          <span className='inline-flex items-center gap-1'>
            <MessageCircleIcon className='size-3' strokeWidth={2} />
            {formatBigNumber(post.comments)}
          </span>
        </div>
      </div>
    </a>
  )
}

function dedupeCompetitors(items: CompetitorSummary[]): CompetitorSummary[] {
  const seen = new Set<string>()
  const out: CompetitorSummary[] = []
  for (const item of items) {
    const key = usernameKey(item.handle)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
