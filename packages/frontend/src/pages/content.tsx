import { useEffect, useState } from 'react'
import {
  ArrowDownToLineIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  GalleryHorizontalEndIcon,
  GalleryVerticalEndIcon,
  HeartIcon,
  ImageIcon,
  ListIcon,
  MessageCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  Square as SquareIcon,
  StarIcon,
} from 'lucide-react'

import type { CapturedPostSummary, CompetitorSummary } from '@anubis/shared'

import { captureCompetitor, listPosts } from '@/api'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/lib/navigation'
import { CaptureSelectionDialog, type CaptureRunOptions } from './competitor-dialogs'

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
}

/* Brand-aligned mid-tone backdrops per handle, used for both real
   captured posts (when we don't have a thumbnail yet) and the mock
   fallback grid. */
const HANDLE_TINTS: Record<string, string> = {
  '@ali.abdaal': '#B5663F',
  '@kayla.studio': '#4E6E8E',
  '@jamesclear': '#5E7D55',
  '@studyquill': '#7E5E92',
  '@marie_forleo': '#A85F6B',
  '@notion': '#565B63',
  '@magnoliabakery': '#9C6A3F',
  '@raditya_dika': '#3F8079',
  '@linear': '#46617E',
}

const MOCK_CARDS: CardModel[] = [
  { key: 'm1', handle: '@ali.abdaal', date: '3d', format: 'carousel', chip: 'Carousel · 7',
    caption: "I used to think productivity was about doing more. After 10 years it's actually about saying no faster.",
    likes: '11.4K', comments: '312', engagement: '4.2%', hook: 'Contrarian Take',
    tint: HANDLE_TINTS['@ali.abdaal']! },
  { key: 'm2', handle: '@kayla.studio', date: '1d', format: 'reel', chip: 'Reel · 0:38',
    caption: '5 brand kit mistakes I see every week (and the 30-second fix for each).',
    likes: '4.2K', comments: '89', engagement: '3.1%', hook: 'Numbered List',
    tint: HANDLE_TINTS['@kayla.studio']! },
  { key: 'm3', handle: '@jamesclear', date: '5d', format: 'static', chip: 'Static',
    caption: 'You do not rise to the level of your goals. You fall to the level of your systems.',
    likes: '32.6K', comments: '540', engagement: '5.8%', hook: 'Aphorism',
    tint: HANDLE_TINTS['@jamesclear']! },
  { key: 'm4', handle: '@studyquill', date: '2d', format: 'carousel', chip: 'Carousel · 10',
    caption: 'How I plan a 40-hour study week without burning out — my full Sunday reset.',
    likes: '9.1K', comments: '204', engagement: '3.7%', hook: 'How-To',
    tint: HANDLE_TINTS['@studyquill']! },
  { key: 'm5', handle: '@marie_forleo', date: '6d', format: 'reel', chip: 'Reel · 1:02',
    caption: 'The one question that ends overthinking in 60 seconds.',
    likes: '3.8K', comments: '142', engagement: '2.9%', hook: 'Curiosity Gap',
    tint: HANDLE_TINTS['@marie_forleo']! },
  { key: 'm6', handle: '@notion', date: '4d', format: 'carousel', chip: 'Carousel · 6',
    caption: '8 Notion templates our team actually uses every single day.',
    likes: '9.7K', comments: '276', engagement: '4.0%', hook: 'Numbered List',
    tint: HANDLE_TINTS['@notion']! },
  { key: 'm7', handle: '@magnoliabakery', date: '12h', format: 'reel', chip: 'Reel · 0:24',
    caption: 'Watch us pipe 200 cupcakes before the morning rush opens.',
    likes: '18.4K', comments: '410', engagement: '6.2%', hook: 'Process Reveal',
    tint: HANDLE_TINTS['@magnoliabakery']! },
  { key: 'm8', handle: '@raditya_dika', date: '1d', format: 'reel', chip: 'Reel · 0:51',
    caption: 'Hal-hal kecil yang ternyata bikin hari kamu jauh lebih baik.',
    likes: '24.8K', comments: '612', engagement: '5.1%', hook: 'Relatable Confession',
    tint: HANDLE_TINTS['@raditya_dika']! },
  { key: 'm9', handle: '@linear', date: '1w', format: 'static', chip: 'Static',
    caption: 'Speed is a feature. Everything we ship is built around it.',
    likes: '2.1K', comments: '58', engagement: '2.4%', hook: 'Bold Claim',
    tint: HANDLE_TINTS['@linear']! },
  { key: 'm10', handle: '@ali.abdaal', date: '6d', format: 'reel', chip: 'Reel · 0:45',
    caption: 'The 2-minute rule that completely rewired how I start hard tasks.',
    likes: '8.9K', comments: '198', engagement: '3.9%', hook: 'How-To',
    tint: HANDLE_TINTS['@ali.abdaal']! },
  { key: 'm11', handle: '@kayla.studio', date: '4d', format: 'carousel', chip: 'Carousel · 5',
    caption: 'Before / after: a small bakery rebrand that doubled their saves.',
    likes: '5.6K', comments: '121', engagement: '3.4%', hook: 'Before & After',
    tint: HANDLE_TINTS['@kayla.studio']! },
  { key: 'm12', handle: '@jamesclear', date: '2w', format: 'carousel', chip: 'Carousel · 8',
    caption: "Atomic Habits in 8 slides: the cheat sheet I wish I'd had at 25.",
    likes: '27.2K', comments: '489', engagement: '5.5%', hook: 'Numbered List',
    tint: HANDLE_TINTS['@jamesclear']! },
]

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
}: {
  card: CardModel
  starred: boolean
  onStar: () => void
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
        onClick={onStar}
        aria-label='Toggle similarity index'
        className={cn(
          'absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-[rgba(11,12,15,0.42)] backdrop-blur transition-colors hover:bg-[rgba(11,12,15,0.62)]',
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

function FilterPill({ label, value }: { label: string; value: string }) {
  return (
    <button
      type='button'
      className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:border-[color-mix(in_oklab,var(--anubis-gold)_32%,var(--border))]'
    >
      {label}: <span className='font-medium text-foreground'>{value}</span>
      <ChevronDownIcon className='size-3' strokeWidth={2} />
    </button>
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
  const [banner, setBanner] = useState<Banner | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [stars, setStars] = useState<Record<string, boolean>>({})

  async function refresh() {
    setBusy(true)
    try {
      const items = await listPosts({ limit: 120, orderBy: 'recent' })
      setPosts(items)
    } catch {
      // Backend offline → keep null so the mock fallback shows.
      setPosts([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function toggleStar(key: string) {
    setStars((s) => ({ ...s, [key]: !s[key] }))
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
        const result = await captureCompetitor(competitor.id, {
          profile: options.profile,
          headless: options.headless,
          forceHeadless: options.forceHeadless,
        })
        capturedSoFar += result.capturedCount
      } catch (e) {
        errors.push({
          handle: competitor.handle,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }

    setCapturing(null)
    await refresh()

    if (errors.length === 0) {
      setBanner({
        kind: 'success',
        message: `Captured ${capturedSoFar} post${capturedSoFar === 1 ? '' : 's'} across ${competitors.length} competitor${competitors.length === 1 ? '' : 's'}.`,
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
        message: `Captured ${capturedSoFar} posts from ${okCount} competitor${okCount === 1 ? '' : 's'}; ${errors.length} failed.`,
        errors,
      })
    }
  }

  const usingMock = (posts ?? []).length === 0
  const cards = usingMock ? MOCK_CARDS : posts!.map(realPostToCard)
  const headerCount = posts === null ? '—' : posts.length.toLocaleString()

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1240px] px-7 pb-12'>
        {/* Header */}
        <div className='flex flex-col gap-6 pt-7 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <h1 className='text-[30px] font-semibold leading-[1.1] tracking-[-0.025em]'>Content</h1>
            <p className='mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground'>
              {usingMock
                ? 'No posts captured yet. Sample feed shown below. Add competitors and hit Refresh on each to populate real data.'
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
            <button
              type='button'
              onClick={() => setSelectionOpen(true)}
              disabled={!!capturing}
              title='Pick which tracked competitors to crawl'
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-semibold transition-colors',
                capturing
                  ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-80'
                  : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
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

        {usingMock && !capturing && !banner && (
          <div
            role='status'
            className='mt-5 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] px-3.5 py-2.5 text-[13px] text-foreground'
          >
            <span className='font-mono text-[var(--anubis-gold)]'>Sample data:</span>{' '}
            Showing 12 example posts so you can see what the populated feed looks
            like. Hit <span className='font-medium'>Capture posts</span> to run the
            research-crawler against your tracked competitors and replace this with
            real data.
          </div>
        )}

        {/* Sticky filter rail */}
        <div className='sticky top-0 z-[5] -mx-1 bg-background pb-3.5 pt-[18px]'>
          <div className='flex h-14 items-center gap-2 rounded-md border border-border bg-card px-3'>
            <label className='mr-1.5 flex min-w-0 flex-[0_1_280px] items-center gap-2 text-muted-foreground'>
              <SearchIcon className='size-[15px]' strokeWidth={2} />
              <input
                type='text'
                placeholder='Search captions, handles, hooks…'
                className='min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground'
              />
            </label>
            <FilterPill label='Competitor' value='All' />
            <FilterPill label='Format' value='All' />
            <FilterPill label='Hook' value='All' />
            <FilterPill label='In index' value='Any' />

            <div className='ml-auto inline-flex gap-0.5 rounded-md border border-border bg-background p-[3px]'>
              <button
                type='button'
                onClick={() => setView('grid')}
                aria-pressed={view === 'grid'}
                className={cn(
                  'flex size-8 items-center justify-center rounded-[5px] transition-colors',
                  view === 'grid'
                    ? 'bg-card text-[var(--anubis-gold)] shadow-[inset_0_-2px_0_var(--anubis-gold)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-label='Grid view'
              >
                <GalleryVerticalEndIcon className='size-[15px]' strokeWidth={2} />
              </button>
              <button
                type='button'
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                className={cn(
                  'flex size-8 items-center justify-center rounded-[5px] transition-colors',
                  view === 'list'
                    ? 'bg-card text-[var(--anubis-gold)] shadow-[inset_0_-2px_0_var(--anubis-gold)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-label='List view'
              >
                <ListIcon className='size-[15px]' strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>

        {/* Card grid */}
        <div className='grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4'>
          {cards.map((card) => (
            <article
              key={card.key}
              className={cn(
                'group overflow-hidden rounded-[13px] border border-border bg-card transition-all',
                'hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--anubis-gold)_24%,var(--border))] hover:shadow-[0_10px_28px_-18px_rgba(0,0,0,0.85)]',
              )}
            >
              <MediaPane card={card} starred={!!stars[card.key]} onStar={() => toggleStar(card.key)} />

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
                {card.hook && (
                  <span className='mt-2.5 inline-flex h-[21px] items-center rounded-md bg-muted px-2 text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground'>
                    Hook: {card.hook}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>

        {view === 'list' && (
          <p className='mt-6 flex items-center justify-center gap-2 text-[12px] text-muted-foreground'>
            <ImageIcon className='size-3.5' strokeWidth={2} />
            List view coming soon — keep the grid for now.
          </p>
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
    </div>
  )
}

/* ---------- Converters ---------- */

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
          {progress.capturedSoFar} post{progress.capturedSoFar === 1 ? '' : 's'} so far
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
    tint: p.competitorTint ?? HANDLE_TINTS[handle] ?? '#565B63',
    postUrl: p.postUrl,
    mediaUrl: p.mediaUrl,
  }
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
