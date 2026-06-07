import { useEffect, useState } from 'react'
import {
  ArrowDownToLineIcon,
  ArrowUpRightIcon,
  CalendarIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  Edit3Icon,
  GalleryHorizontalEndIcon,
  HeartIcon,
  ImageIcon,
  MessageCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  Square as SquareIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

import type { CapturedPostSummary, CompetitorSummary } from '@anubis/shared'
import { effectiveLevel, multiplierRatingFor } from '@anubis/shared'

import {
  captureCompetitorPreview,
  deletePost,
  importCapturedPosts,
  listPosts,
  updatePost,
} from '@/api'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/lib/navigation'
import { CaptureSelectionDialog, type CaptureRunOptions } from './competitor-dialogs'
import { CompetitorLevelFilter, matchesLevelFilter, type LevelFilter } from '@/components/competitor-level-filter'
import { ViewToggle } from '@/components/view-toggle'
import { levelTint, levelTip, resolveLevel } from '@/lib/competitor-level'
import { PostMultiplierBadge } from '@/components/post-multiplier-badge'
import { PostMultiplierFilter, matchesMultiplierFilter, type MultiplierFilter } from '@/components/post-multiplier-filter'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { useLevelMultipliers } from '@/hooks/use-level-multipliers'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Format = 'carousel' | 'reel' | 'static'

interface CardModel {
  key: string
  handle: string
  date: string
  format: Format
  chip: string
  caption: string
  likes: string
  comments: string
  engagement?: string
  hook?: string
  tint: string
  postUrl?: string
  mediaUrl?: string
  post?: CapturedPostSummary
}

function FormatGlyph({ format }: { format: Format }) {
  const props = { strokeWidth: 1.6, className: 'size-9 text-white/55' }
  if (format === 'carousel') return <GalleryHorizontalEndIcon {...props} />
  if (format === 'reel') return <PlayIcon className='size-9 fill-white/65 text-white/65' />
  return <SquareIcon {...props} />
}

/* The post media block: lazy-loaded image when we have one, brand-
   tinted fallback (with the format glyph) when we don't, and the
   chip + star overlays in both cases. */
function MediaPane({
  card,
  starred,
  onStar,
  disableActions,
}: {
  card: CardModel
  starred: boolean
  onStar: () => void
  disableActions?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const showImage = !!card.mediaUrl && !failed
  return (
    <div
      className='relative flex aspect-square items-center justify-center overflow-hidden'
      style={{ background: card.tint }}
    >
      {showImage ? (
        <img
          src={card.mediaUrl}
          alt={card.caption}
          loading='lazy'
          decoding='async'
          // Instagram's CDN sometimes 403s a leaked referrer; better to
          // not send one and gracefully fall through to the glyph if it
          // still rejects.
          referrerPolicy='no-referrer'
          onError={() => setFailed(true)}
          className='absolute inset-0 size-full object-cover'
        />
      ) : (
        <FormatGlyph format={card.format} />
      )}

      {/* Video play overlay so reels read as reels even with a static
          thumbnail behind. */}
      {showImage && card.format === 'reel' && (
        <span
          aria-hidden
          className='pointer-events-none absolute flex size-14 items-center justify-center rounded-full bg-[rgba(11,12,15,0.45)] backdrop-blur'
        >
          <PlayIcon
            className='size-7 translate-x-[2px] fill-white/95 text-white/95'
          />
        </span>
      )}

      <span className='absolute left-[9px] top-[9px] inline-flex h-5 items-center rounded-md bg-[rgba(11,12,15,0.55)] px-2 font-mono text-[10px] tracking-wide text-[rgba(245,242,234,0.95)] backdrop-blur'>
        {card.chip}
      </span>
      <button
        type='button'
        onClick={(e) => { e.stopPropagation(); onStar() }}
        disabled={disableActions}
        aria-label='Toggle similarity index'
        className={cn(
          'absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-[rgba(11,12,15,0.42)] backdrop-blur transition-colors hover:bg-[rgba(11,12,15,0.62)] disabled:cursor-not-allowed disabled:opacity-50',
          starred ? 'text-[var(--anubis-gold)]' : 'text-white/90',
        )}
      >
        <StarIcon
          className='size-4'
          strokeWidth={2}
          fill={starred ? 'currentColor' : 'none'}
        />
      </button>
    </div>
  )
}

type CaptureProgress = {
  done: number
  total: number
  currentHandle?: string
  capturedSoFar: number
  errors: { handle: string; message: string }[]
}

type Banner =
  | { kind: 'success' | 'warning'; message: string; errors?: { handle: string; message: string }[] }
  | { kind: 'error'; message: string }

export function ContentPage() {
  const { navigate } = useNavigation()
  const [posts, setPosts] = useState<CapturedPostSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState<CaptureProgress | null>(null)
  const [selectionOpen, setSelectionOpen] = useState(false)
  const [reviewPosts, setReviewPosts] = useState<CapturedPostSummary[]>([])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [importingPosts, setImportingPosts] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [stars, setStars] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [competitorFilter, setCompetitorFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingPost, setEditingPost] = useState<CapturedPostSummary | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [multiplierFilter, setMultiplierFilter] = useState<MultiplierFilter>('all')
  const { config: levelsCfg } = useCompetitorLevels()
  const multipliersCfg = useLevelMultipliers()

  async function refresh() {
    setBusy(true)
    try {
      const items = await listPosts({ limit: 120, orderBy: 'recent' })
      setPosts(dedupeCapturedPosts(items))
    } catch {
      // Backend offline or request failed → show the empty state, not stale data.
      setPosts([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleStar(key: string) {
    setStars((s) => ({ ...s, [key]: !s[key] }))
  }

  async function handleDeletePost(post: CapturedPostSummary) {
    const ok = window.confirm('Delete this captured post?')
    if (!ok) return
    setBanner(null)
    try {
      await deletePost(post.id)
      await refresh()
      setBanner({ kind: 'success', message: 'Deleted captured post.' })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not delete post.',
      })
    }
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkDeletePosts() {
    if (selected.size === 0) return
    setBulkConfirm(false)
    setBusy(true)
    setBanner(null)
    const ids = [...selected]
    const errors: string[] = []
    for (const id of ids) {
      try {
        await deletePost(id)
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    await refresh()
    setBusy(false)
    exitSelectMode()
    if (errors.length === 0) {
      setBanner({
        kind: 'success',
        message: `Deleted ${ids.length} post${ids.length === 1 ? '' : 's'}.`,
      })
    } else if (errors.length === ids.length) {
      setBanner({ kind: 'error', message: `All ${ids.length} deletes failed: ${errors[0]}` })
    } else {
      setBanner({
        kind: 'error',
        message: `Deleted ${ids.length - errors.length} of ${ids.length}; ${errors.length} failed.`,
      })
    }
  }

  async function handleSavePost(patch: Partial<CapturedPostSummary>) {
    if (!editingPost) return
    setBanner(null)
    try {
      await updatePost(editingPost.id, {
        caption: patch.caption,
        likes: patch.likes,
        comments: patch.comments,
        postedAt: patch.postedAt,
        mediaKind: patch.mediaKind,
        mediaUrl: patch.mediaUrl,
        carouselCount: patch.carouselCount,
      })
      setEditingPost(null)
      await refresh()
      setBanner({ kind: 'success', message: 'Updated captured post.' })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not update post.',
      })
    }
  }

  async function handleCaptureFor(
    competitors: CompetitorSummary[],
    options: CaptureRunOptions,
  ) {
    setBanner(null)
    if (competitors.length === 0) return

    // Sequential — Chrome is single-tab single-user, so parallel captures
    // would step on each other. Showing live "X of N" progress is the
    // right UX for a serial run anyway.
    const errors: { handle: string; message: string }[] = []
    const candidates: CapturedPostSummary[] = []
    let capturedSoFar = 0
    setCapturing({ done: 0, total: competitors.length, capturedSoFar, errors })

    for (let i = 0; i < competitors.length; i++) {
      const competitor = competitors[i]!
      setCapturing({
        done: i,
        total: competitors.length,
        currentHandle: competitor.handle,
        capturedSoFar,
        errors,
      })
      try {
        const result = await captureCompetitorPreview(competitor.id, {
          profile: options.profile,
          headless: options.headless,
          forceHeadless: options.forceHeadless,
          targetPosts: options.targetPostsPerProfile,
        })
        candidates.push(...result.posts)
        capturedSoFar = dedupeCapturedPosts(candidates).length
      } catch (e) {
        errors.push({
          handle: competitor.handle,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }

    setCapturing(null)

    if (candidates.length > 0) {
      setReviewPosts(dedupeCapturedPosts(candidates))
      setReviewOpen(true)
    }

    if (errors.length === 0 && candidates.length > 0) {
      setBanner({
        kind: 'success',
        message: `Found ${capturedSoFar} candidate post${capturedSoFar === 1 ? '' : 's'} across ${competitors.length} competitor${competitors.length === 1 ? '' : 's'}. Select which ones to add.`,
      })
    } else if (errors.length === competitors.length) {
      setBanner({
        kind: 'error',
        message: `All ${competitors.length} captures failed. The first error: ${errors[0]!.message}`,
      })
    } else {
      const okCount = competitors.length - errors.length
      setBanner({
        kind: 'warning',
        message: `Found ${capturedSoFar} candidate posts from ${okCount} competitor${okCount === 1 ? '' : 's'}; ${errors.length} failed.`,
        errors,
      })
    }
  }

  async function handleImportPosts(selectedPosts: CapturedPostSummary[]) {
    const uniquePosts = dedupeCapturedPosts(selectedPosts)
    if (uniquePosts.length === 0) return
    setImportingPosts(true)
    setBanner(null)
    try {
      const result = await importCapturedPosts({
        posts: uniquePosts.map(postToImportInput),
      })
      setReviewOpen(false)
      setReviewPosts([])
      await refresh()
      setBanner({
        kind: 'success',
        message: `Added ${result.importedCount} post${result.importedCount === 1 ? '' : 's'} to Content.`,
      })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not add selected posts.',
      })
    } finally {
      setImportingPosts(false)
    }
  }

  const allCards = dedupeCapturedPosts(posts ?? []).map(realPostToCard)
  const cards = allCards
    .filter((card) => matchesFilters(card, {
      query,
      competitor: competitorFilter,
      dateFrom,
      dateTo,
    }))
    .filter((card) =>
      matchesLevelFilter(
        effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg),
        levelFilter,
      ),
    )
    .filter((card) => {
      const level = effectiveLevel(card.post?.competitorLevel, card.post?.competitorFollowers, levelsCfg)
      const { rating } = multiplierRatingFor(level, card.post?.likes, card.post?.competitorAvgLikes, multipliersCfg)
      return matchesMultiplierFilter(rating, multiplierFilter)
    })
  const competitors = [...new Set(allCards.map((card) => card.handle))].sort()
  const headerCount = posts === null ? '—' : posts.length.toLocaleString()
  const filtersActive = query || competitorFilter !== 'all' || dateFrom || dateTo || levelFilter !== 'all' || multiplierFilter !== 'all'

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-6 pt-7 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>Content</h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              {posts === null
                ? 'Loading captured posts…'
                : posts.length === 0
                  ? 'No posts captured yet. Add competitors, then hit Capture posts to populate this feed.'
                  : `${headerCount} posts captured. Star the winners to add them to the similarity index.`}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2.5'>
            <button
              type='button'
              onClick={() => void refresh()}
              disabled={busy || !!capturing}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
            {selectMode ? (
              <button
                type='button'
                onClick={exitSelectMode}
                disabled={busy}
                className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
              >
                <XIcon className='size-[15px]' strokeWidth={2} />
                Done
              </button>
            ) : (
              <button
                type='button'
                onClick={() => setSelectMode(true)}
                disabled={busy || !!capturing || !posts || posts.length === 0}
                className='inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] hover:bg-muted disabled:opacity-50'
              >
                <CheckSquareIcon className='size-[15px]' strokeWidth={2} />
                Select
              </button>
            )}
            <button
              type='button'
              onClick={() => setSelectionOpen(true)}
              disabled={!!capturing || selectMode}
              title='Pick which tracked competitors to crawl'
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-semibold transition-colors',
                capturing
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-80'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50',
              )}
            >
              <ArrowDownToLineIcon
                className={cn('size-[15px]', capturing && 'animate-pulse')}
                strokeWidth={2.2}
              />
              {capturing ? 'Capturing…' : 'Capture posts'}
            </button>
          </div>
        </div>

        {capturing && (
          <CaptureProgressPanel progress={capturing} />
        )}

        {banner && (
          <BannerPanel banner={banner} onGoToCompetitors={() => navigate({ page: 'competitors' })} />
        )}

        {posts === null && <ContentLoadingGrid />}

        {posts !== null && posts.length === 0 && (
          <ContentEmptyState onCapture={() => setSelectionOpen(true)} disabled={!!capturing} />
        )}

        {posts !== null && posts.length > 0 && (
          <>
            {/* Sticky filter rail */}
            <div className='sticky top-0 z-[5] -mx-1 bg-background pb-3.5 pt-[18px]'>
          <div className='flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2'>
            <label className='mr-1.5 flex min-w-[220px] flex-[1_1_280px] items-center gap-2 text-muted-foreground'>
              <SearchIcon className='size-[15px]' strokeWidth={2} />
              <input
                type='text'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search captions, handles…'
                className='min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground'
              />
            </label>
            <label className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-muted-foreground'>
              Competitor
              <select
                value={competitorFilter}
                onChange={(e) => setCompetitorFilter(e.target.value)}
                className='bg-transparent font-medium text-foreground outline-none'
              >
                <option value='all'>All</option>
                {competitors.map((handle) => (
                  <option key={handle} value={handle}>{handle}</option>
                ))}
              </select>
              <ChevronDownIcon className='size-3' strokeWidth={2} />
            </label>
            <label className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-muted-foreground'>
              <CalendarIcon className='size-3.5' strokeWidth={2} />
              From
              <input
                type='date'
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className='bg-transparent font-mono text-[12px] text-foreground outline-none'
              />
            </label>
            <label className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-muted-foreground'>
              To
              <input
                type='date'
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className='bg-transparent font-mono text-[12px] text-foreground outline-none'
              />
            </label>
            {filtersActive && (
              <button
                type='button'
                onClick={() => {
                  setQuery('')
                  setCompetitorFilter('all')
                  setDateFrom('')
                  setDateTo('')
                  setLevelFilter('all')
                  setMultiplierFilter('all')
                }}
                className='inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                <XIcon className='size-3.5' strokeWidth={2} />
                Clear
              </button>
            )}

            <ViewToggle view={view} onChange={setView} className='ml-auto' />
          </div>
          <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1'>
            <CompetitorLevelFilter value={levelFilter} onChange={setLevelFilter} />
            <PostMultiplierFilter value={multiplierFilter} onChange={setMultiplierFilter} />
          </div>
        </div>

        {selectMode && (
          <BulkSelectBar
            count={selected.size}
            total={cards.filter((c) => c.post).length}
            onSelectAll={() => setSelected(new Set(cards.filter((c) => c.post).map((c) => c.post!.id)))}
            onClear={() => setSelected(new Set())}
            onDelete={() => setBulkConfirm(true)}
            busy={busy}
            label='post'
          />
        )}

        {cards.length === 0 ? (
          <div className='mt-8 flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center'>
            <ImageIcon className='size-6 text-muted-foreground' strokeWidth={1.5} />
            <p className='text-[13px] text-muted-foreground'>No content matches these filters.</p>
          </div>
        ) : view === 'grid' ? (
          <div className='grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4'>
            {cards.map((card) => (
              <PostCard
                key={card.key}
                card={card}
                levelsCfg={levelsCfg}
                multipliersCfg={multipliersCfg}
                starred={!!stars[card.key]}
                onStar={() => toggleStar(card.key)}
                onEdit={card.post ? () => setEditingPost(card.post!) : undefined}
                onDelete={card.post ? () => void handleDeletePost(card.post!) : undefined}
                selectMode={selectMode}
                selected={card.post ? selected.has(card.post.id) : false}
                onToggleSelect={card.post ? () => toggleSelected(card.post!.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <PostTable
            cards={cards}
            levelsCfg={levelsCfg}
            stars={stars}
            onStar={toggleStar}
            onEdit={(post) => setEditingPost(post)}
            onDelete={(post) => void handleDeletePost(post)}
            selectMode={selectMode}
            selected={selected}
            onToggleSelect={toggleSelected}
          />
        )}
          </>
        )}
      </div>

      <CaptureSelectionDialog
        open={selectionOpen}
        onClose={() => setSelectionOpen(false)}
        onConfirm={(picked, options) => {
          setSelectionOpen(false)
          void handleCaptureFor(picked, options)
        }}
      />

      <CaptureReviewDialog
        open={reviewOpen}
        posts={reviewPosts}
        importing={importingPosts}
        onClose={() => {
          if (importingPosts) return
          setReviewOpen(false)
        }}
        onImport={(selectedPosts) => void handleImportPosts(selectedPosts)}
      />

      <EditPostDialog
        post={editingPost}
        onClose={() => setEditingPost(null)}
        onSave={(patch) => void handleSavePost(patch)}
      />

      <BulkDeleteDialog
        open={bulkConfirm}
        count={selected.size}
        label='post'
        onCancel={() => setBulkConfirm(false)}
        onConfirm={() => void handleBulkDeletePosts()}
      />
    </div>
  )
}

/* ---------- Bulk-select shared bits ---------- */

function BulkSelectBar({
  count,
  total,
  onSelectAll,
  onClear,
  onDelete,
  busy,
  label,
}: {
  count: number
  total: number
  onSelectAll: () => void
  onClear: () => void
  onDelete: () => void
  busy: boolean
  label: string
}) {
  const allSelected = count > 0 && count === total
  return (
    <div className='mt-5 flex flex-wrap items-center gap-2 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_6%,transparent)] px-3.5 py-2.5'>
      <span className='text-[13px] font-medium text-foreground'>
        <span className='tabular-nums'>{count}</span> selected
        <span className='ml-1 text-muted-foreground'>of {total}</span>
      </span>
      <div className='ml-auto flex flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={allSelected ? onClear : onSelectAll}
          disabled={busy || total === 0}
          className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
        <button
          type='button'
          onClick={onClear}
          disabled={busy || count === 0}
          className='inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40'
        >
          Clear
        </button>
        <button
          type='button'
          onClick={onDelete}
          disabled={busy || count === 0}
          className='inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-[12.5px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50'
        >
          <Trash2Icon className='size-[13px]' strokeWidth={2.2} />
          Delete {count > 0 ? `${count} ${label}${count === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </div>
  )
}

function BulkDeleteDialog({
  open,
  count,
  label,
  onCancel,
  onConfirm,
}: {
  open: boolean
  count: number
  label: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className='max-w-md bg-card p-0'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle>Delete {count} {label}{count === 1 ? '' : 's'}?</DialogTitle>
          <DialogDescription>
            This removes the selected {label}{count === 1 ? '' : 's'} permanently. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className='border-t border-border px-6 py-3'>
          <button
            type='button'
            onClick={onCancel}
            className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={onConfirm}
            className='inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-4 text-[13.5px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90'
          >
            <Trash2Icon className='size-[14px]' strokeWidth={2.2} />
            Delete {count}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Converters ---------- */

function PostCard({
  card,
  starred,
  onStar,
  onEdit,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
  levelsCfg,
  multipliersCfg,
}: {
  card: CardModel
  starred: boolean
  onStar: () => void
  onEdit?: () => void
  onDelete?: () => void
  selectMode: boolean
  selected: boolean
  onToggleSelect?: () => void
  levelsCfg: import('@anubis/shared').CompetitorLevelsConfig
  multipliersCfg: import('@anubis/shared').LevelMultipliersConfig
}) {
  const selectable = selectMode && !!onToggleSelect
  const level = resolveLevel(card.post?.competitorFollowers, card.post?.competitorLevel, levelsCfg)
  const tip = levelTip(card.post?.competitorFollowers, card.post?.competitorLevel, levelsCfg)
  return (
    <article
      role={selectable ? 'button' : undefined}
      aria-pressed={selectable ? selected : undefined}
      onClick={selectable ? onToggleSelect : undefined}
      title={tip}
      style={{ background: levelTint(level, 'card') }}
      className={cn(
        'group relative overflow-hidden rounded-[13px] border border-border bg-card transition-all',
        selectMode
          ? selectable
            ? selected
              ? 'cursor-pointer border-[var(--anubis-gold)] ring-1 ring-[var(--anubis-gold)]'
              : 'cursor-pointer hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'
            : 'opacity-50'
          : 'hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--anubis-gold)_24%,var(--border))] hover:shadow-[0_10px_28px_-18px_rgba(0,0,0,0.85)]',
      )}
    >
      {selectable && (
        <span
          aria-hidden
          className={cn(
            'absolute left-2 top-2 z-[1] flex size-5 items-center justify-center rounded border transition-colors',
            selected
              ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
              : 'border-border bg-card text-transparent',
          )}
        >
          <CheckIcon className='size-3.5' strokeWidth={3} />
        </span>
      )}
      <MediaPane
        card={card}
        starred={starred}
        onStar={onStar}
        disableActions={selectMode}
      />

      <div className='p-3'>
        <div className='flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-foreground'>
          {card.postUrl ? (
            <a
              href={card.postUrl}
              target='_blank'
              rel='noreferrer'
              className='truncate hover:underline'
            >
              {card.handle}
            </a>
          ) : (
            <span className='truncate'>{card.handle}</span>
          )}
          <span className='text-muted-foreground'>·</span>
          <span className='shrink-0 text-muted-foreground'>{card.date}</span>
          {card.post && (
            <PostMultiplierBadge
              className='ml-auto'
              likes={card.post.likes}
              competitorFollowers={card.post.competitorFollowers}
              competitorAvgLikes={card.post.competitorAvgLikes}
              competitorLevelOverride={card.post.competitorLevel}
              levelsConfig={levelsCfg}
              multipliersConfig={multipliersCfg}
            />
          )}
        </div>
        <p className='mt-2 line-clamp-2 min-h-[38px] text-[13px] leading-[1.45] text-foreground'>
          {card.caption}
        </p>
        <div className='mt-2.5 flex items-center gap-3.5 text-[11px] text-muted-foreground tabular-nums'>
          <span className='inline-flex items-center gap-1.5'>
            <HeartIcon className='size-[13px]' strokeWidth={2} />
            {card.likes}
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <MessageCircleIcon className='size-[13px]' strokeWidth={2} />
            {card.comments}
          </span>
          {card.engagement && (
            <span className='inline-flex items-center gap-1.5'>
              <ArrowUpRightIcon className='size-[13px]' strokeWidth={2} />
              {card.engagement}
            </span>
          )}
        </div>
        <div className='mt-2.5 flex min-h-[28px] items-center justify-between gap-2'>
          {card.hook ? (
            <span className='inline-flex h-[21px] items-center rounded-md bg-muted px-2 text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground'>
              Hook: {card.hook}
            </span>
          ) : (
            <span />
          )}
          {card.post && !selectMode && (
            <div className='flex items-center gap-1'>
              <IconButton label='Edit post' onClick={onEdit}>
                <Edit3Icon className='size-3.5' strokeWidth={2} />
              </IconButton>
              <IconButton label='Delete post' onClick={onDelete} destructive>
                <Trash2Icon className='size-3.5' strokeWidth={2} />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function PostTable({
  cards,
  levelsCfg,
  stars,
  onStar,
  onEdit,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
}: {
  cards: CardModel[]
  levelsCfg: import('@anubis/shared').CompetitorLevelsConfig
  stars: Record<string, boolean>
  onStar: (key: string) => void
  onEdit: (post: CapturedPostSummary) => void
  onDelete: (post: CapturedPostSummary) => void
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
}) {
  return (
    <div className='overflow-hidden rounded-md border border-border bg-card'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[860px] border-collapse text-left text-[13px]'>
          <thead className='border-b border-border bg-background/50 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground'>
            <tr>
              {selectMode && <th className='w-8 px-3 py-2.5 font-medium' />}
              <th className='px-3 py-2.5 font-medium'>Content</th>
              <th className='px-3 py-2.5 font-medium'>Competitor</th>
              <th className='px-3 py-2.5 font-medium'>Date</th>
              <th className='px-3 py-2.5 font-medium'>Format</th>
              <th className='px-3 py-2.5 text-right font-medium'>Likes</th>
              <th className='px-3 py-2.5 text-right font-medium'>Comments</th>
              <th className='px-3 py-2.5 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const id = card.post?.id
              const isSelected = !!id && selected.has(id)
              const selectable = selectMode && !!id
              const level = resolveLevel(card.post?.competitorFollowers, card.post?.competitorLevel, levelsCfg)
              return (
                <tr
                  key={card.key}
                  onClick={selectable ? () => onToggleSelect(id!) : undefined}
                  title={levelTip(card.post?.competitorFollowers, card.post?.competitorLevel, levelsCfg)}
                  style={{
                    background: isSelected
                      ? 'color-mix(in oklab, var(--anubis-gold) 8%, transparent)'
                      : levelTint(level, 'row'),
                  }}
                  className={cn(
                    'border-b border-border/70 last:border-0',
                    selectable && 'cursor-pointer',
                    selectMode && !selectable && 'opacity-50',
                  )}
                >
                  {selectMode && (
                    <td className='px-3 py-3'>
                      {selectable && (
                        <span
                          aria-hidden
                          className={cn(
                            'flex size-4 items-center justify-center rounded border transition-colors',
                            isSelected
                              ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
                              : 'border-border bg-card text-transparent',
                          )}
                        >
                          <CheckIcon className='size-3' strokeWidth={3} />
                        </span>
                      )}
                    </td>
                  )}
                  <td className='max-w-[360px] px-3 py-3'>
                    <p className='line-clamp-2 leading-relaxed text-foreground'>{card.caption}</p>
                  </td>
                  <td className='px-3 py-3 font-mono text-[12px] text-foreground'>{card.handle}</td>
                  <td className='px-3 py-3 font-mono text-[12px] text-muted-foreground'>{card.date}</td>
                  <td className='px-3 py-3 text-muted-foreground'>{card.chip}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{card.likes}</td>
                  <td className='px-3 py-3 text-right font-mono text-[12px] tabular-nums'>{card.comments}</td>
                  <td className='px-3 py-3' onClick={(e) => e.stopPropagation()}>
                    <div className='flex justify-end gap-1'>
                      <IconButton label='Toggle similarity index' onClick={() => onStar(card.key)} disabled={selectMode}>
                        <StarIcon
                          className='size-3.5'
                          strokeWidth={2}
                          fill={stars[card.key] ? 'currentColor' : 'none'}
                        />
                      </IconButton>
                      {card.post && !selectMode && (
                        <>
                          <IconButton label='Edit post' onClick={() => onEdit(card.post!)}>
                            <Edit3Icon className='size-3.5' strokeWidth={2} />
                          </IconButton>
                          <IconButton label='Delete post' onClick={() => onDelete(card.post!)} destructive>
                            <Trash2Icon className='size-3.5' strokeWidth={2} />
                          </IconButton>
                        </>
                      )}
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

function IconButton({
  label,
  onClick,
  destructive,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled || !onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:opacity-40',
        destructive
          ? 'hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive'
          : 'hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function CaptureReviewDialog({
  open,
  posts,
  importing,
  onClose,
  onImport,
}: {
  open: boolean
  posts: CapturedPostSummary[]
  importing: boolean
  onClose: () => void
  onImport: (selectedPosts: CapturedPostSummary[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'month'>('all')

  useEffect(() => {
    if (!open) return
    setSelected(new Set(posts.map((post) => post.id)))
    setQuery('')
    setDateFilter('all')
  }, [open, posts])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const post of visiblePosts) next.add(post.id)
      return next
    })
  }

  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const post of visiblePosts) next.delete(post.id)
      return next
    })
  }

  const visiblePosts = posts.filter((post) => matchesReviewFilters(post, query, dateFilter))
  const selectedPosts = posts.filter((post) => selected.has(post.id))
  const allVisibleSelected = visiblePosts.length > 0 && visiblePosts.every((post) => selected.has(post.id))
  const visibleSelectedCount = visiblePosts.filter((post) => selected.has(post.id)).length

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-hidden bg-card p-0 sm:max-w-3xl'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle>Review captured posts</DialogTitle>
          <DialogDescription>
            Select the posts you want to add to Content. Unselected candidates are discarded.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-3 border-b border-border px-6 py-3'>
          <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
            <label className='flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-muted-foreground lg:max-w-[420px]'>
              <SearchIcon className='size-[15px]' strokeWidth={2} />
              <input
                type='text'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Filter handle, caption, URL...'
                className='min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
              />
            </label>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='inline-flex items-center gap-1.5 text-[12px] text-muted-foreground'>
                <CalendarIcon className='size-3.5' strokeWidth={2} />
                Date
              </span>
              {[
                ['all', 'All'],
                ['week', '1 week'],
                ['month', '1 month'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type='button'
                  onClick={() => setDateFilter(value as 'all' | 'week' | 'month')}
                  className={cn(
                    'inline-flex h-8 items-center rounded-md border px-3 text-[12.5px] font-medium transition-colors',
                    dateFilter === value
                      ? 'border-[color-mix(in_oklab,var(--anubis-gold)_58%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <span className='font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground'>
              {visiblePosts.length} showing · {visibleSelectedCount} visible selected · {selected.size} of {posts.length} total selected
            </span>
            <div className='flex items-center gap-2 text-[12px]'>
              <button
                type='button'
                onClick={selectVisible}
                disabled={allVisibleSelected || visiblePosts.length === 0 || importing}
                className='text-[var(--anubis-gold)] hover:underline disabled:opacity-45'
              >
                Select visible
              </button>
              <span className='text-muted-foreground'>·</span>
              <button
                type='button'
                onClick={clearVisible}
                disabled={visibleSelectedCount === 0 || importing}
                className='text-muted-foreground hover:text-foreground hover:underline disabled:opacity-45'
              >
                Clear visible
              </button>
              <span className='text-muted-foreground'>·</span>
              <button
                type='button'
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0 || importing}
                className='text-muted-foreground hover:text-foreground hover:underline disabled:opacity-45'
              >
                Clear all
              </button>
            </div>
          </div>
        </div>

        <div className='max-h-[min(58vh,560px)] overflow-auto px-3 py-3'>
          {posts.length === 0 ? (
            <p className='px-3 py-8 text-center text-[13px] text-muted-foreground'>
              No candidate posts came back from this capture.
            </p>
          ) : visiblePosts.length === 0 ? (
            <p className='px-3 py-8 text-center text-[13px] text-muted-foreground'>
              No candidate posts match these filters.
            </p>
          ) : (
            <div className='min-w-[860px] overflow-hidden rounded-md border border-border bg-background'>
              <table className='w-full border-collapse text-left text-[12.5px]'>
                <thead className='sticky top-0 z-[1] bg-card text-[11px] uppercase tracking-[0.08em] text-muted-foreground'>
                  <tr className='border-b border-border'>
                    <th className='w-12 px-3 py-2.5 font-medium'>Add</th>
                    <th className='w-[74px] px-2 py-2.5 font-medium'>Media</th>
                    <th className='w-[150px] px-3 py-2.5 font-medium'>Profile</th>
                    <th className='w-[112px] px-3 py-2.5 font-medium'>Date</th>
                    <th className='px-3 py-2.5 font-medium'>Caption</th>
                    <th className='w-[150px] px-3 py-2.5 text-right font-medium'>Metrics</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {visiblePosts.map((post) => {
                    const isSelected = selected.has(post.id)
                    const card = realPostToCard(post)
                    return (
                      <tr
                        key={post.id}
                        onClick={() => !importing && toggle(post.id)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          isSelected
                            ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)]'
                            : 'hover:bg-muted/70',
                          importing && 'cursor-not-allowed opacity-70',
                        )}
                      >
                        <td className='px-3 py-2 align-middle'>
                          <label className='flex size-[22px] items-center justify-center'>
                            <input
                              type='checkbox'
                              checked={isSelected}
                              disabled={importing}
                              onChange={() => toggle(post.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${card.handle} post`}
                              className='peer sr-only'
                            />
                            <span
                              aria-hidden
                              className={cn(
                                'flex size-[18px] items-center justify-center rounded-[5px] border transition-colors',
                                isSelected
                                  ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]'
                                  : 'border-border bg-card text-transparent',
                              )}
                            >
                              <CheckIcon className='size-3' strokeWidth={3.2} />
                            </span>
                          </label>
                        </td>
                        <td className='px-2 py-2 align-middle'>
                          <span
                            aria-hidden
                            className='relative flex size-12 overflow-hidden rounded-md border border-border'
                            style={{ background: card.tint }}
                          >
                            {card.mediaUrl ? (
                              <img
                                src={card.mediaUrl}
                                alt=''
                                loading='lazy'
                                referrerPolicy='no-referrer'
                                className='size-full object-cover'
                              />
                            ) : (
                              <span className='flex size-full items-center justify-center'>
                                <FormatGlyph format={card.format} />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className='px-3 py-2 align-middle'>
                          <div className='min-w-0'>
                            <div className='truncate font-mono text-[12px] text-foreground'>{card.handle}</div>
                            <div className='mt-1 inline-flex rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
                              {card.chip}
                            </div>
                          </div>
                        </td>
                        <td className='px-3 py-2 align-middle font-mono text-[11.5px] text-muted-foreground'>
                          <span title={absolutePostDate(post)}>{card.date}</span>
                        </td>
                        <td className='px-3 py-2 align-middle'>
                          <div className='line-clamp-2 max-w-[470px] text-[12.5px] leading-relaxed text-foreground/90'>
                            {card.caption}
                          </div>
                          {card.postUrl && (
                            <a
                              href={card.postUrl}
                              target='_blank'
                              rel='noreferrer'
                              onClick={(e) => e.stopPropagation()}
                              className='mt-1 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground hover:underline'
                            >
                              Open post
                              <ArrowUpRightIcon className='size-3' strokeWidth={2} />
                            </a>
                          )}
                        </td>
                        <td className='px-3 py-2 align-middle text-right font-mono text-[11.5px] text-muted-foreground'>
                          <div>{card.likes} likes</div>
                          <div>{card.comments} comments</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className='border-t border-border px-6 py-3'>
          <button
            type='button'
            onClick={onClose}
            disabled={importing}
            className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={() => onImport(selectedPosts)}
            disabled={importing || selectedPosts.length === 0}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
              importing || selectedPosts.length === 0
                ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
            )}
          >
            <ArrowDownToLineIcon className={cn('size-[15px]', importing && 'animate-pulse')} strokeWidth={2.2} />
            {importing ? 'Adding...' : `Add ${selectedPosts.length}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditPostDialog({
  post,
  onClose,
  onSave,
}: {
  post: CapturedPostSummary | null
  onClose: () => void
  onSave: (patch: Partial<CapturedPostSummary>) => void
}) {
  const [caption, setCaption] = useState('')
  const [likes, setLikes] = useState('')
  const [comments, setComments] = useState('')
  const [postedAt, setPostedAt] = useState('')
  const [mediaKind, setMediaKind] = useState<CapturedPostSummary['mediaKind']>('image')
  const [mediaUrl, setMediaUrl] = useState('')
  const [carouselCount, setCarouselCount] = useState('')

  useEffect(() => {
    if (!post) return
    setCaption(post.caption ?? '')
    setLikes(post.likes === undefined ? '' : String(post.likes))
    setComments(post.comments === undefined ? '' : String(post.comments))
    setPostedAt(toDateInputValue(post.postedAt))
    setMediaKind(post.mediaKind ?? 'image')
    setMediaUrl(post.mediaUrl ?? '')
    setCarouselCount(post.carouselCount === undefined ? '' : String(post.carouselCount))
  }, [post])

  function submit() {
    onSave({
      caption: caption.trim() || undefined,
      likes: parseOptionalInt(likes),
      comments: parseOptionalInt(comments),
      postedAt: postedAt ? new Date(`${postedAt}T00:00:00`).toISOString() : undefined,
      mediaKind,
      mediaUrl: mediaUrl.trim() || undefined,
      carouselCount: mediaKind === 'carousel' ? parseOptionalInt(carouselCount) : undefined,
    })
  }

  return (
    <Dialog open={!!post} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-w-lg bg-card p-0'>
        <DialogHeader className='border-b border-border px-6 py-4'>
          <DialogTitle>Edit captured post</DialogTitle>
          <DialogDescription>
            Update the saved caption, metrics, date, and thumbnail metadata for this captured post.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4 px-6 py-5'>
          <Field label='Caption' htmlFor='post-caption'>
            <textarea
              id='post-caption'
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className={`${textInput} h-auto resize-none py-2 leading-relaxed`}
            />
          </Field>
          <div className='grid grid-cols-2 gap-3'>
            <Field label='Likes' htmlFor='post-likes'>
              <input id='post-likes' type='number' min={0} value={likes} onChange={(e) => setLikes(e.target.value)} className={textInput} />
            </Field>
            <Field label='Comments' htmlFor='post-comments'>
              <input id='post-comments' type='number' min={0} value={comments} onChange={(e) => setComments(e.target.value)} className={textInput} />
            </Field>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <Field label='Posted date' htmlFor='post-date'>
              <input id='post-date' type='date' value={postedAt} onChange={(e) => setPostedAt(e.target.value)} className={textInput} />
            </Field>
            <Field label='Format' htmlFor='post-kind'>
              <select id='post-kind' value={mediaKind} onChange={(e) => setMediaKind(e.target.value as CapturedPostSummary['mediaKind'])} className={textInput}>
                <option value='image'>Image</option>
                <option value='video'>Video</option>
                <option value='carousel'>Carousel</option>
              </select>
            </Field>
          </div>
          <Field label='Media URL' htmlFor='post-media'>
            <input id='post-media' type='url' value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} className={textInput} />
          </Field>
          {mediaKind === 'carousel' && (
            <Field label='Carousel count' htmlFor='post-carousel'>
              <input id='post-carousel' type='number' min={0} value={carouselCount} onChange={(e) => setCarouselCount(e.target.value)} className={textInput} />
            </Field>
          )}
        </div>
        <DialogFooter className='border-t border-border px-6 py-3'>
          <button type='button' onClick={onClose} className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'>
            Cancel
          </button>
          <button type='button' onClick={submit} className='inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-4 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)]'>
            Save changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label htmlFor={htmlFor} className='text-[12.5px] font-medium text-foreground'>
        {label}
      </label>
      {children}
    </div>
  )
}

const textInput =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

/* ---------- Progress + banner panels ---------- */

function CaptureProgressPanel({ progress }: { progress: CaptureProgress }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  return (
    <div
      role='status'
      aria-live='polite'
      className='mt-5 overflow-hidden rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] bg-card'
    >
      <div className='flex items-center justify-between gap-3 px-3.5 py-2.5'>
        <div className='flex items-center gap-2 text-[13px] text-foreground'>
          <ArrowDownToLineIcon
            className='size-[15px] animate-pulse text-[var(--anubis-gold)]'
            strokeWidth={2}
          />
          <span>
            <span className='font-medium'>Capturing</span>{' '}
            <span className='tabular-nums text-muted-foreground'>
              {progress.done} of {progress.total}
            </span>
            {progress.currentHandle && (
              <>
                {' '}
                <span className='font-mono text-foreground/80'>
                  · {progress.currentHandle}
                </span>
              </>
            )}
          </span>
        </div>
        <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>
          {progress.capturedSoFar} candidate post{progress.capturedSoFar === 1 ? '' : 's'} so far
        </span>
      </div>
      <div className='h-1 w-full bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)]'>
        <div
          className='h-full bg-[var(--anubis-gold)] transition-[width]'
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function BannerPanel({
  banner,
  onGoToCompetitors,
}: {
  banner: Banner
  onGoToCompetitors: () => void
}) {
  const palette =
    banner.kind === 'error'
      ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
      : banner.kind === 'warning'
        ? 'border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)] text-foreground'
        : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground'
  const hasErrors = banner.kind === 'warning' && banner.errors && banner.errors.length > 0
  return (
    <div role='status' className={cn('mt-5 rounded-md border px-3.5 py-2.5 text-[13px]', palette)}>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>{banner.message}</div>
        {banner.kind === 'warning' && banner.message.includes('No competitors') && (
          <button
            type='button'
            onClick={onGoToCompetitors}
            className='shrink-0 text-[12.5px] font-medium text-[var(--anubis-gold)] underline-offset-2 hover:underline'
          >
            Go to Competitors →
          </button>
        )}
      </div>
      {hasErrors && (
        <ul className='mt-2 list-disc space-y-0.5 pl-5 text-[12px] text-muted-foreground'>
          {banner.errors!.slice(0, 5).map((err, i) => (
            <li key={i}>
              <span className='font-mono text-foreground/80'>{err.handle}</span>{' '}
              <span className='text-muted-foreground'>— {err.message}</span>
            </li>
          ))}
          {banner.errors!.length > 5 && (
            <li className='list-none italic'>…and {banner.errors!.length - 5} more</li>
          )}
        </ul>
      )}
    </div>
  )
}

/* ---------- Loading / empty states ---------- */

function ContentLoadingGrid() {
  return (
    <div className='mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4'>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className='aspect-[3/4] animate-pulse rounded-[13px] border border-border bg-card' />
      ))}
    </div>
  )
}

function ContentEmptyState({ onCapture, disabled }: { onCapture: () => void; disabled?: boolean }) {
  return (
    <div className='mt-10 flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-card/50 px-6 py-10 text-center'>
      <ImageIcon className='size-7 text-muted-foreground' strokeWidth={1.5} />
      <div>
        <h2 className='text-[16px] font-semibold tracking-[-0.01em]'>No posts captured yet</h2>
        <p className='mt-1.5 text-[13px] text-muted-foreground'>
          Add competitors, then run a capture to pull their recent posts into this feed.
        </p>
      </div>
      <button
        type='button'
        onClick={onCapture}
        disabled={disabled}
        className='inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'
      >
        <ArrowDownToLineIcon className='size-[15px]' strokeWidth={2.2} />
        Capture posts
      </button>
    </div>
  )
}

/* ---------- Real → card converter ---------- */

function realPostToCard(p: CapturedPostSummary): CardModel {
  const handle = p.competitorHandle ?? `@${p.username}`
  const format: Format =
    p.mediaKind === 'carousel' ? 'carousel'
    : p.mediaKind === 'video' ? 'reel'
    : 'static'
  const chip =
    format === 'carousel' && p.carouselCount
      ? `Carousel · ${p.carouselCount}`
      : format === 'reel'
        ? 'Reel'
        : 'Static'
  return {
    key: p.id,
    handle,
    date: shortRelative(p.postedAt) ?? shortRelativeMs(p.capturedAt),
    format,
    chip,
    caption: p.caption ?? '(No caption)',
    likes: formatBigNumber(p.likes),
    comments: formatBigNumber(p.comments),
    engagement: undefined, // requires follower count; future work
    hook: undefined,        // requires classifier; future work
    tint: p.competitorTint ?? '#565B63',
    postUrl: p.postUrl,
    mediaUrl: p.mediaUrl,
    post: p,
  }
}

function postToImportInput(post: CapturedPostSummary) {
  return {
    id: post.id,
    competitorId: post.competitorId,
    username: post.username,
    postUrl: post.postUrl,
    caption: post.caption,
    likes: post.likes,
    comments: post.comments,
    postedAt: post.postedAt,
    mediaKind: post.mediaKind,
    mediaUrl: post.mediaUrl,
    carouselCount: post.carouselCount,
    capturedAt: post.capturedAt,
  }
}

function normalisePostUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function normaliseUsername(raw: string | undefined): string {
  return raw?.trim().replace(/^@/, '').toLowerCase() ?? ''
}

function postDedupeKey(post: CapturedPostSummary): string {
  const url = normalisePostUrl(post.postUrl)
  if (url) return `url:${url}`
  return [
    'content',
    normaliseUsername(post.username),
    post.caption?.trim().toLowerCase() ?? '',
    normalisePostUrl(post.mediaUrl) ?? '',
  ].join(':')
}

function dedupeCapturedPosts(posts: CapturedPostSummary[]): CapturedPostSummary[] {
  const seen = new Set<string>()
  const out: CapturedPostSummary[] = []
  for (const post of posts) {
    const key = postDedupeKey(post)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(post)
  }
  return out
}

function matchesReviewFilters(
  post: CapturedPostSummary,
  query: string,
  dateFilter: 'all' | 'week' | 'month',
): boolean {
  const q = query.trim().toLowerCase()
  if (q) {
    const haystack = [
      post.caption,
      post.competitorHandle,
      post.username,
      post.postUrl,
      post.mediaKind,
    ].filter(Boolean).join(' ').toLowerCase()
    if (!haystack.includes(q)) return false
  }

  if (dateFilter !== 'all') {
    const ms = postTimeMs(post)
    if (ms === undefined) return false
    const days = dateFilter === 'week' ? 7 : 30
    if (ms < Date.now() - days * 24 * 60 * 60 * 1000) return false
  }

  return true
}

function absolutePostDate(post: CapturedPostSummary): string {
  const ms = postTimeMs(post)
  if (ms === undefined) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function matchesFilters(
  card: CardModel,
  filters: {
    query: string
    competitor: string
    dateFrom: string
    dateTo: string
  },
): boolean {
  const q = filters.query.trim().toLowerCase()
  if (q) {
    const haystack = `${card.caption} ${card.handle} ${card.hook ?? ''}`.toLowerCase()
    if (!haystack.includes(q)) return false
  }
  if (filters.competitor !== 'all' && card.handle !== filters.competitor) return false

  if (filters.dateFrom || filters.dateTo) {
    const ms = card.post ? postTimeMs(card.post) : undefined
    if (ms === undefined) return true
    if (filters.dateFrom && ms < new Date(`${filters.dateFrom}T00:00:00`).getTime()) return false
    if (filters.dateTo && ms > new Date(`${filters.dateTo}T23:59:59.999`).getTime()) return false
  }

  return true
}

function postTimeMs(post: CapturedPostSummary): number | undefined {
  if (post.postedAt) {
    const posted = Date.parse(post.postedAt)
    if (!Number.isNaN(posted)) return posted
  }
  return post.capturedAt
}

function toDateInputValue(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

function parseOptionalInt(value: string): number | undefined {
  if (!value.trim()) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined
}

function formatBigNumber(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function shortRelative(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  return shortRelativeMs(ms)
}

function shortRelativeMs(ms: number): string {
  const d = Date.now() - ms
  const min = Math.round(d / 60_000)
  if (min < 60) return `${Math.max(1, min)}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.round(day / 7)
  return `${wk}w`
}
