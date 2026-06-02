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

import type { CapturedPostSummary } from '@anubis/shared'

import { listPosts } from '@/api'
import { cn } from '@/lib/utils'

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

export function ContentPage() {
  const [posts, setPosts] = useState<CapturedPostSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
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
              disabled={busy}
              className='inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
            >
              <RefreshCwIcon className='size-[15px]' strokeWidth={2} />
              Refresh
            </button>
            <button
              type='button'
              disabled
              title='Rebuild similarity index — wired in a later pass'
              className='inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13.5px] font-semibold text-[#0B0C0F] opacity-60'
            >
              <ArrowDownToLineIcon className='size-[15px]' strokeWidth={2.2} />
              Capture posts
            </button>
          </div>
        </div>

        {usingMock && (
          <div
            role='status'
            className='mt-5 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] px-3.5 py-2.5 text-[13px] text-foreground'
          >
            <span className='font-mono text-[var(--anubis-gold)]'>Sample data:</span>{' '}
            Showing 12 example posts so you can see what the populated feed looks
            like. Real posts will appear here once you Refresh a competitor.
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
              <div
                className='relative flex aspect-square items-center justify-center'
                style={{ background: card.tint }}
              >
                <FormatGlyph format={card.format} />
                <span className='absolute left-[9px] top-[9px] inline-flex h-5 items-center rounded-md bg-[rgba(11,12,15,0.55)] px-2 font-mono text-[10px] tracking-wide text-[rgba(245,242,234,0.95)] backdrop-blur'>
                  {card.chip}
                </span>
                <button
                  type='button'
                  onClick={() => toggleStar(card.key)}
                  aria-label='Toggle similarity index'
                  className={cn(
                    'absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-[rgba(11,12,15,0.42)] backdrop-blur transition-colors hover:bg-[rgba(11,12,15,0.62)]',
                    stars[card.key] ? 'text-[var(--anubis-gold)]' : 'text-white/90',
                  )}
                >
                  <StarIcon
                    className='size-4'
                    strokeWidth={2}
                    fill={stars[card.key] ? 'currentColor' : 'none'}
                  />
                </button>
              </div>

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
    </div>
  )
}

/* ---------- Converters ---------- */

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
