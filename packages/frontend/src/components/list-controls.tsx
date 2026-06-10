import { useMemo } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/* -----------------------------------------------------------
   List controls
   -----------------------------------------------------------
   Reusable search box, sort dropdown, and pagination bar shared
   by the Content and Competitor pages. All filtering/sorting/
   paging is done client-side — the lists are bounded (posts are
   capped at the fetch limit, competitors are typically dozens),
   and the backend already loads + joins the full set in memory,
   so paging the wire wouldn't reduce work meaningfully. Keeping
   it client-side preserves the existing instant facet filters
   and keeps the change scoped to these two pages.
   ----------------------------------------------------------- */

export type SortDir = 'asc' | 'desc'

export interface SortOption<K extends string> {
  value: K
  label: string
}

export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

/** Search input with a clear button, matching the dark/premium toolbar style. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-muted-foreground transition-colors focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]',
        className,
      )}
    >
      <SearchIcon className='size-[15px] shrink-0' strokeWidth={2} />
      <input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className='min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
      />
      {value && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label='Clear search'
          className='inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <XIcon className='size-3.5' strokeWidth={2} />
        </button>
      )}
    </label>
  )
}

/**
 * Sort control: a <select> for the field + a button to flip direction.
 * Generic over the field key so each page can declare its own columns.
 */
export function SortControl<K extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly SortOption<K>[]
  value: SortState<K>
  onChange: (next: SortState<K>) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <span className='text-[12.5px] font-medium text-muted-foreground'>Sort:</span>
      <select
        value={value.key}
        onChange={(e) => onChange({ key: e.target.value as K, dir: value.dir })}
        aria-label='Sort field'
        className='h-8 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground outline-none transition-colors hover:bg-muted focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        type='button'
        onClick={() => onChange({ key: value.key, dir: value.dir === 'asc' ? 'desc' : 'asc' })}
        aria-label={value.dir === 'asc' ? 'Sort ascending (toggle to descending)' : 'Sort descending (toggle to ascending)'}
        title={value.dir === 'asc' ? 'Ascending' : 'Descending'}
        className='inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
      >
        {value.dir === 'asc' ? (
          <ArrowUpIcon className='size-[15px]' strokeWidth={2} />
        ) : (
          <ArrowDownIcon className='size-[15px]' strokeWidth={2} />
        )}
      </button>
    </div>
  )
}

const PAGE_SIZE_OPTIONS = [12, 24, 48, 96] as const

/**
 * Pagination bar: page-size selector, range readout, and prev/next nav.
 * Pure presentation — the page owns the slicing via `usePagination`.
 */
export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (next: number) => void
  onPageSizeChange: (next: number) => void
  pageSizeOptions?: readonly number[]
  className?: string
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(Math.max(1, page), pageCount)
  const first = total === 0 ? 0 : (clamped - 1) * pageSize + 1
  const last = Math.min(clamped * pageSize, total)

  if (total === 0) return null

  return (
    <div
      className={cn(
        'mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3.5 py-2.5 text-[12.5px]',
        className,
      )}
    >
      <div className='flex items-center gap-2 text-muted-foreground'>
        <span className='hidden sm:inline'>Per page:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label='Items per page'
          className='h-8 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground outline-none transition-colors hover:bg-muted focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <span className='font-mono tabular-nums text-muted-foreground'>
        {first}–{last} of {total.toLocaleString()}
      </span>

      <div className='flex items-center gap-1.5'>
        <button
          type='button'
          onClick={() => onPageChange(clamped - 1)}
          disabled={clamped <= 1}
          aria-label='Previous page'
          className='inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
        >
          <ChevronLeftIcon className='size-[15px]' strokeWidth={2} />
          <span className='hidden sm:inline'>Prev</span>
        </button>
        <span className='px-1 font-mono tabular-nums text-muted-foreground'>
          {clamped} / {pageCount}
        </span>
        <button
          type='button'
          onClick={() => onPageChange(clamped + 1)}
          disabled={clamped >= pageCount}
          aria-label='Next page'
          className='inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
        >
          <span className='hidden sm:inline'>Next</span>
          <ChevronRightIcon className='size-[15px]' strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

/** Compare two values for sorting; undefined/null always sink to the bottom. */
export function compareForSort(a: unknown, b: unknown, dir: SortDir): number {
  const aMissing = a === undefined || a === null || a === ''
  const bMissing = b === undefined || b === null || b === ''
  if (aMissing && bMissing) return 0
  if (aMissing) return 1 // missing sinks regardless of direction
  if (bMissing) return -1

  let cmp: number
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a - b
  } else {
    cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }
  return dir === 'asc' ? cmp : -cmp
}

/**
 * Pure helper: given items, a page, and a page size, return the slice for the
 * current page plus the clamped page number. Memo-friendly; pages call this
 * inside a useMemo with the already filtered+sorted list.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): { slice: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const clamped = Math.min(Math.max(1, page), pageCount)
  const start = (clamped - 1) * pageSize
  return { slice: items.slice(start, start + pageSize), page: clamped, pageCount }
}

/** Build a memoised sorted copy of `items` using a field accessor map. */
export function useSorted<T, K extends string>(
  items: T[],
  sort: SortState<K>,
  accessors: Record<K, (item: T) => unknown>,
): T[] {
  return useMemo(() => {
    const accessor = accessors[sort.key]
    if (!accessor) return items
    return [...items].sort((a, b) => compareForSort(accessor(a), accessor(b), sort.dir))
    // accessors is a stable literal per page; intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort.key, sort.dir])
}
