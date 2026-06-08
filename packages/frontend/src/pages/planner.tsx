import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  BarChart3Icon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LinkIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type {
  CapturedPostSummary,
  CompetitorLevelsConfig,
  ContentItemStatus,
  ContentItemSummary,
  LevelMultipliersConfig,
} from '@anubis/shared'
import { effectiveLevel, multiplierRatingFor } from '@anubis/shared'
import {
  createContentItem,
  deleteContentItem,
  listContentItems,
  listPosts,
  syncContentItemMetrics,
  updateContentItem,
} from '@/api'
import { useProject } from '@/lib/use-project'
import { cn } from '@/lib/utils'
import { useCompetitorLevels } from '@/hooks/use-competitor-levels'
import { useLevelMultipliers } from '@/hooks/use-level-multipliers'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ViewToggle } from '@/components/view-toggle'

const STATUSES: ContentItemStatus[] = ['idea', 'brief', 'draft', 'review', 'scheduled', 'published', 'rejected']

const STATUS_LABEL: Record<ContentItemStatus, string> = {
  idea: 'Idea',
  brief: 'Brief',
  draft: 'Draft',
  review: 'Review',
  scheduled: 'Scheduled',
  published: 'Published',
  rejected: 'Rejected',
}

const STATUS_TONE: Record<ContentItemStatus, string> = {
  idea: 'border-border bg-muted/30 text-muted-foreground',
  brief: 'border-[#4E6E8E]/40 bg-[#4E6E8E]/12 text-[#9db8d2]',
  draft: 'border-[var(--anubis-gold)]/40 bg-[var(--anubis-gold)]/10 text-[var(--anubis-gold)]',
  review: 'border-[#7E5E92]/45 bg-[#7E5E92]/15 text-[#d9b7ec]',
  scheduled: 'border-[#3F8079]/45 bg-[#3F8079]/15 text-[#9bd8d0]',
  published: 'border-[var(--anubis-success)]/45 bg-[var(--anubis-success)]/12 text-[var(--anubis-success)]',
  rejected: 'border-destructive/45 bg-destructive/10 text-destructive',
}

interface DraftState {
  title: string
  status: ContentItemStatus
  rawBrief: string
  improvedDraft: string
  rejectionReason: string
  publishedUrl: string
  publishedAt: string
  saves: string
}

function emptyDraft(): DraftState {
  return {
    title: '',
    status: 'idea',
    rawBrief: '',
    improvedDraft: '',
    rejectionReason: '',
    publishedUrl: '',
    publishedAt: '',
    saves: '',
  }
}

export function PlannerPage() {
  const { activeProject } = useProject()
  const [items, setItems] = useState<ContentItemSummary[]>([])
  const [posts, setPosts] = useState<CapturedPostSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ContentItemStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft())
  const [banner, setBanner] = useState<string | null>(null)

  const selected = items.find((item) => item.id === selectedId) ?? null
  const levelsCfg = useCompetitorLevels().config
  const multipliersCfg = useLevelMultipliers()

  async function refresh() {
    setBusy(true)
    try {
      const [nextItems, nextPosts] = await Promise.all([
        listContentItems({ projectId: activeProject?.id || undefined, limit: 200 }),
        listPosts({ projectId: activeProject?.id || undefined, limit: 200, orderBy: 'engagement' }),
      ])
      setItems(nextItems)
      setPosts(nextPosts)
      if (selectedId && !nextItems.some((item) => item.id === selectedId)) {
        setSelectedId(null)
        setEditorOpen(false)
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id])

  useEffect(() => {
    if (!selected) {
      setDraft(emptyDraft())
      return
    }
    setDraft({
      title: selected.title,
      status: selected.status,
      rawBrief: selected.rawBrief ?? '',
      improvedDraft: selected.improvedDraft ?? '',
      rejectionReason: selected.rejectionReason ?? '',
      publishedUrl: selected.publishedUrl ?? '',
      publishedAt: toDateInputValue(selected.publishedAt),
      saves: selected.analytics.saves == null ? '' : String(selected.analytics.saves),
    })
  }, [selected?.id])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!q) return true
      const ref = item.referencePost
      const haystack = [
        item.title,
        item.rawBrief,
        item.improvedDraft,
        ref?.caption,
        ref?.competitorHandle,
        ref?.username,
        item.referenceUrl,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [items, query, statusFilter])

  const counts = useMemo(() => {
    const out = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<ContentItemStatus, number>
    for (const item of items) out[item.status] += 1
    return out
  }, [items])

  async function saveSelected() {
    if (!selected) return
    setBusy(true)
    setBanner(null)
    try {
      const saved = await updateContentItem(selected.id, {
        title: draft.title,
        status: draft.status,
        rawBrief: draft.rawBrief,
        improvedDraft: draft.improvedDraft,
        rejectionReason: draft.rejectionReason.trim() || null,
        publishedUrl: draft.publishedUrl.trim() || null,
        publishedAt: draft.publishedAt ? new Date(`${draft.publishedAt}T00:00:00`).toISOString() : null,
        analytics: {
          saves: draft.saves.trim() ? parseNonNegativeInt(draft.saves) : null,
        },
      })
      setItems((prev) => prev.map((item) => item.id === saved.id ? saved : item))
      setBanner('Saved planner item.')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(status: ContentItemStatus) {
    if (!selected) return
    setDraft((current) => ({ ...current, status }))
    const saved = await updateContentItem(selected.id, { status })
    setItems((prev) => prev.map((item) => item.id === saved.id ? saved : item))
  }

  async function syncMetrics() {
    if (!selected) return
    setBusy(true)
    setBanner(null)
    try {
      const synced = await syncContentItemMetrics(selected.id)
      setItems((prev) => prev.map((item) => item.id === synced.id ? synced : item))
      setBanner('Synced available metrics from published URL.')
    } finally {
      setBusy(false)
    }
  }

  async function removeSelected() {
    if (!selected) return false
    const ok = window.confirm('Delete this content item?')
    if (!ok) return false
    await deleteContentItem(selected.id)
    await refresh()
    return true
  }

  const referenceScore = selected?.referencePost
    ? referenceEffectiveness(selected.referencePost, levelsCfg, multipliersCfg)
    : null
  const contentScore = selected ? contentEffectiveness(selected) : null

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-background'>
      <div className='border-b border-border px-6 py-4'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <h1 className='text-[24px] font-semibold tracking-[-0.02em]'>Planner</h1>
            <p className='mt-1 text-[13px] text-muted-foreground'>
              Plan your own content from a fresh reference URL, then track the published result.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <button type='button' onClick={() => void refresh()} disabled={busy} className={secondaryButton}>
              <RefreshCwIcon className={cn('size-4', busy && 'animate-spin')} />
              Refresh
            </button>
            <button type='button' onClick={() => setCreateOpen(true)} className={primaryButton}>
              <PlusIcon className='size-4' />
              New from reference
            </button>
          </div>
        </div>
      </div>

      {/* Control / Filter Bar */}
      <div className='flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card/15 px-6 py-3 shrink-0'>
        <div className='flex flex-wrap items-center gap-3'>
          {/* Search Input */}
          <label className='flex h-9 w-64 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground focus-within:border-[var(--anubis-gold)]/60'>
            <SearchIcon className='size-4' />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search planner...'
              className='min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
            />
          </label>

          {/* Status Chips (only in Table view) */}
          {viewMode === 'table' && (
            <div className='flex flex-wrap gap-1.5'>
              <button
                type='button'
                onClick={() => setStatusFilter('all')}
                className={cn(statusChip, statusFilter === 'all' && 'border-foreground/35 bg-muted text-foreground')}
              >
                All <span className='font-mono text-[11px]'>{items.length}</span>
              </button>
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type='button'
                  onClick={() => setStatusFilter(status)}
                  className={cn(statusChip, statusFilter === status ? STATUS_TONE[status] : 'border-border bg-card text-muted-foreground')}
                >
                  {STATUS_LABEL[status]} <span className='font-mono text-[11px]'>{counts[status]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View Toggle */}
        <div className='flex items-center gap-2'>
          <ViewToggle view={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'grid' ? (
        /* Kanban View */
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-background p-6'>
          <div className='flex h-full gap-4 items-start pb-4'>
            {STATUSES.map((status) => {
              const columnItems = items.filter(item => {
                if (item.status !== status) return false
                const q = query.trim().toLowerCase()
                if (!q) return true
                const ref = item.referencePost
                const haystack = [
                  item.title,
                  item.rawBrief,
                  item.improvedDraft,
                  ref?.caption,
                  ref?.competitorHandle,
                  ref?.username,
                  item.referenceUrl,
                ].filter(Boolean).join(' ').toLowerCase()
                return haystack.includes(q)
              })

              return (
                <div
                  key={status}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault()
                    const itemId = e.dataTransfer.getData('text/plain')
                    if (!itemId) return
                    const itemToMove = items.find(i => i.id === itemId)
                    if (itemToMove && itemToMove.status !== status) {
                      // Optimistic local state update
                      setItems(prev => prev.map(i => i.id === itemId ? { ...i, status } : i))
                      try {
                        await updateContentItem(itemId, { status })
                      } catch (err) {
                        console.error('Failed to drag and drop update status:', err)
                        await refresh()
                      }
                    }
                  }}
                  className='flex h-full w-[280px] shrink-0 flex-col rounded-xl border border-border bg-card/20 p-3 hover:bg-card/30 transition-colors'
                >
                  {/* Column Header */}
                  <div className='flex items-center justify-between border-b border-border pb-2'>
                    <div className='flex items-center gap-2'>
                      <span className={cn('h-2 w-2 rounded-full border', STATUS_TONE[status])} />
                      <span className='text-xs font-semibold uppercase tracking-wider text-foreground'>{STATUS_LABEL[status]}</span>
                    </div>
                    <span className='rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground'>
                      {columnItems.length}
                    </span>
                  </div>

                  {/* Cards stack */}
                  <div className='min-h-0 flex-1 overflow-y-auto mt-3 space-y-2 pr-1'>
                    {columnItems.length === 0 ? (
                      <div className='flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-border/50 p-4 text-center'>
                        <p className='text-[10px] text-muted-foreground'>Drag items here</p>
                      </div>
                    ) : (
                      columnItems.map((item) => (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', item.id)
                          }}
                          onClick={() => {
                            setSelectedId(item.id)
                            setEditorOpen(true)
                          }}
                          className='group relative w-full rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-[var(--anubis-gold)] hover:shadow-md cursor-grab active:cursor-grabbing hover:bg-muted/30'
                        >
                          <p className='line-clamp-2 text-[12px] font-medium leading-snug text-foreground group-hover:text-[var(--anubis-gold)]'>
                            {item.title}
                          </p>
                          <p className='mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground'>
                            {item.referencePost?.caption ?? item.referenceUrl ?? 'No reference'}
                          </p>

                          <div className='mt-2.5 flex items-center justify-between border-t border-border/50 pt-2 text-[9.5px] text-muted-foreground'>
                            <span className='truncate font-mono font-medium max-w-[130px]'>
                              {item.referencePost?.competitorHandle ?? item.referencePost?.username ?? (item.referenceUrl ? 'URL reference' : 'reference')}
                            </span>
                            <span>{shortRelativeMs(item.updatedAt)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Table View */
        <div className='min-h-0 flex-1 overflow-y-auto bg-background p-6'>
          {filteredItems.length === 0 ? (
            <div className='flex h-64 flex-col items-center justify-center text-center'>
              <FileTextIcon className='size-8 text-muted-foreground' />
              <p className='mt-3 text-sm font-medium'>No planner items found</p>
              <p className='mt-1 text-xs text-muted-foreground'>Try resetting filters or searching for something else.</p>
            </div>
          ) : (
            <div className='overflow-hidden rounded-lg border border-border bg-card'>
              <table className='w-full border-collapse text-left text-[13px]'>
                <thead>
                  <tr className='border-b border-border bg-muted/20 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground'>
                    <th className='px-4 py-3'>Title</th>
                    <th className='px-4 py-3'>Status</th>
                    <th className='px-4 py-3'>Reference</th>
                    <th className='px-4 py-3 text-right'>Likes</th>
                    <th className='px-4 py-3 text-right'>Comments</th>
                    <th className='px-4 py-3 text-right'>Multiplier</th>
                    <th className='px-4 py-3'>Updated</th>
                    <th className='px-4 py-3 text-center'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const refScore = item.referencePost
                      ? referenceEffectiveness(item.referencePost, levelsCfg, multipliersCfg)
                      : null
                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedId(item.id)
                          setEditorOpen(true)
                        }}
                        className='border-b border-border hover:bg-muted/40 cursor-pointer transition-colors'
                      >
                        <td className='px-4 py-3.5 font-medium max-w-[280px] truncate'>
                          {item.title}
                        </td>
                        <td className='px-4 py-3.5'>
                          <span className={cn('inline-block rounded-md border px-2 py-0.5 text-[10.5px] font-medium', STATUS_TONE[item.status])}>
                            {STATUS_LABEL[item.status]}
                          </span>
                        </td>
                        <td className='px-4 py-3.5 font-mono text-[11px] max-w-[180px] truncate text-muted-foreground'>
                          {item.referencePost?.competitorHandle ?? item.referencePost?.username ?? (item.referenceUrl ? 'URL reference' : 'reference')}
                        </td>
                        <td className='px-4 py-3.5 text-right font-mono text-muted-foreground'>
                          {formatNumber(item.referencePost?.likes)}
                        </td>
                        <td className='px-4 py-3.5 text-right font-mono text-muted-foreground'>
                          {formatNumber(item.referencePost?.comments)}
                        </td>
                        <td className='px-4 py-3.5 text-right font-mono font-medium'>
                          <span className={refScore?.tone}>{refScore?.multiplier ?? '-'}</span>
                        </td>
                        <td className='px-4 py-3.5 text-muted-foreground'>
                          {shortRelativeMs(item.updatedAt)}
                        </td>
                        <td className='px-4 py-3.5 text-center' onClick={(e) => e.stopPropagation()}>
                          <button
                            type='button'
                            onClick={async () => {
                              setSelectedId(item.id)
                              await removeSelected()
                            }}
                            className='inline-flex h-8 w-8 items-center justify-center rounded-md border border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/15 transition-colors'
                            title='Delete item'
                          >
                            <Trash2Icon className='size-4' />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Editor slide-out Sheet */}
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className='sm:max-w-2xl overflow-y-auto bg-card border-l border-border p-6 shadow-2xl flex flex-col'>
          <SheetHeader className='pb-4 border-b border-border shrink-0'>
            <SheetTitle className='text-lg font-bold text-foreground'>
              Edit Planner Item
            </SheetTitle>
          </SheetHeader>

          {selected ? (
            <div className='flex-1 space-y-5 py-4 min-h-0 overflow-y-auto'>
              {banner && (
                <div className='flex items-center gap-2 rounded-md border border-[var(--anubis-success)]/35 bg-[var(--anubis-success)]/10 px-3 py-2 text-sm text-[var(--anubis-success)]'>
                  <CheckIcon className='size-4' />
                  {banner}
                </div>
              )}

              <div className='rounded-md border border-border bg-background/50 p-3'>
                <span className='block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2'>Title</span>
                <textarea
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  rows={2}
                  className='min-h-[56px] w-full resize-none bg-transparent text-[16px] font-semibold leading-tight outline-none'
                />
              </div>

              <div className='rounded-md border border-border bg-background/50 p-3'>
                <span className='mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground block mb-2'>Status</span>
                <div className='flex flex-wrap gap-1.5'>
                  {STATUSES.map((status) => (
                    <button
                      key={status}
                      type='button'
                      onClick={() => {
                        setDraft((d) => ({ ...d, status }))
                        void setStatus(status)
                      }}
                      className={cn(
                        'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                        draft.status === status ? STATUS_TONE[status] : 'border-border bg-card text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {STATUS_LABEL[status]}
                    </button>
                  ))}
                </div>
              </div>

              <EditorBlock
                title='Raw brief'
                value={draft.rawBrief}
                onChange={(value) => setDraft((d) => ({ ...d, rawBrief: value }))}
                placeholder='Paste or write the analysis brief that explains the idea.'
                rows={5}
              />
              <EditorBlock
                title='Improved draft'
                value={draft.improvedDraft}
                onChange={(value) => setDraft((d) => ({ ...d, improvedDraft: value }))}
                placeholder='Write the current draft that will go to review or publishing.'
                rows={7}
              />
              {draft.status === 'rejected' && (
                <EditorBlock
                  title='Rejection reason'
                  value={draft.rejectionReason}
                  onChange={(value) => setDraft((d) => ({ ...d, rejectionReason: value }))}
                  placeholder='Why was this rejected, and what should change before returning to draft?'
                  rows={4}
                />
              )}

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <ReferencePanel item={selected} score={referenceScore} />
                <TrackingPanel
                  item={selected}
                  score={contentScore}
                  draft={draft}
                  busy={busy}
                  onDraftChange={setDraft}
                  onSync={() => void syncMetrics()}
                />
              </div>

              <div className='flex items-center justify-between border-t border-border pt-4 mt-6 shrink-0'>
                <div className='flex gap-2'>
                  {draft.status === 'rejected' && (
                    <button type='button' onClick={() => void setStatus('draft')} className={secondaryButton}>
                      <RefreshCwIcon className='size-4' />
                      Revise
                    </button>
                  )}
                  <button type='button' onClick={() => void saveSelected()} disabled={busy || !draft.title.trim()} className={primaryButton}>
                    <SaveIcon className='size-4' />
                    Save Changes
                  </button>
                </div>
                <button
                  type='button'
                  onClick={async () => {
                    const deleted = await removeSelected()
                    if (deleted) setEditorOpen(false)
                  }}
                  className={dangerButton}
                >
                  <Trash2Icon className='size-4 mr-2' />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p className='text-muted-foreground text-sm py-4'>No item selected.</p>
          )}
        </SheetContent>
      </Sheet>

      <CreateContentDialog
        open={createOpen}
        posts={posts}
        onClose={() => setCreateOpen(false)}
        onCreated={(item) => {
          setCreateOpen(false)
          setItems((prev) => [item, ...prev])
          setSelectedId(item.id)
          setEditorOpen(true)
        }}
        projectId={activeProject?.id}
      />
    </div>
  )
}

function EditorBlock({
  title,
  value,
  onChange,
  placeholder,
  rows,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  rows: number
}) {
  return (
    <section className='rounded-md border border-border bg-card'>
      <div className='border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>
        {title}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className='block w-full resize-y bg-transparent px-3 py-3 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground'
      />
    </section>
  )
}

function ReferencePanel({
  item,
  score,
}: {
  item: ContentItemSummary
  score: ReturnType<typeof referenceEffectiveness> | null
}) {
  const post = item.referencePost
  const href = post?.postUrl ?? item.referenceUrl
  return (
    <section className='rounded-md border border-border bg-card'>
      <div className='flex items-center justify-between border-b border-border px-3 py-2'>
        <h2 className='text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>Content reference</h2>
        {href ? (
          <a href={href} target='_blank' rel='noreferrer' className='text-muted-foreground hover:text-foreground'>
            <ExternalLinkIcon className='size-4' />
          </a>
        ) : null}
      </div>
      <div className='p-3'>
        <div className='flex gap-3'>
          <div className='flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted'>
            {post?.mediaUrl ? (
              <img src={post.mediaUrl} alt='' className='size-full object-cover' referrerPolicy='no-referrer' />
            ) : (
              <FileTextIcon className='size-6 text-muted-foreground' />
            )}
          </div>
          <div className='min-w-0 flex-1'>
            <p className='truncate font-mono text-[12px] text-foreground'>{post?.competitorHandle ?? post?.username ?? (item.referenceUrl ? 'Fresh URL reference' : 'Reference unavailable')}</p>
            <p className='mt-1 line-clamp-4 break-all text-[12.5px] leading-relaxed text-muted-foreground'>{post?.caption ?? item.referenceUrl ?? 'This reference could not be found.'}</p>
          </div>
        </div>
        <div className='mt-3 grid grid-cols-3 gap-2'>
          <Metric label='Likes' value={formatNumber(post?.likes)} />
          <Metric label='Comments' value={formatNumber(post?.comments)} />
          <Metric label='Multiplier' value={score?.multiplier ?? '-'} tone={score?.tone} />
        </div>
      </div>
    </section>
  )
}

function TrackingPanel({
  item,
  score,
  draft,
  busy,
  onDraftChange,
  onSync,
}: {
  item: ContentItemSummary
  score: ReturnType<typeof contentEffectiveness> | null
  draft: DraftState
  busy: boolean
  onDraftChange: Dispatch<SetStateAction<DraftState>>
  onSync: () => void
}) {
  return (
    <section className='rounded-md border border-border bg-card'>
      <div className='flex items-center justify-between border-b border-border px-3 py-2'>
        <h2 className='text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>Publishing + analytics</h2>
        <BarChart3Icon className='size-4 text-muted-foreground' />
      </div>
      <div className='space-y-3 p-3'>
        <Field label='Published URL'>
          <input
            value={draft.publishedUrl}
            onChange={(e) => onDraftChange((d) => ({ ...d, publishedUrl: e.target.value }))}
            placeholder='https://instagram.com/p/...'
            className={inputClass}
          />
        </Field>
        <Field label='Published date'>
          <input
            type='date'
            value={draft.publishedAt}
            onChange={(e) => onDraftChange((d) => ({ ...d, publishedAt: e.target.value }))}
            className={inputClass}
          />
        </Field>
        <Field label='Saves'>
          <input
            type='number'
            min={0}
            value={draft.saves}
            onChange={(e) => onDraftChange((d) => ({ ...d, saves: e.target.value }))}
            placeholder='Manual for now'
            className={inputClass}
          />
        </Field>
        <button type='button' onClick={onSync} disabled={busy || !item.publishedUrl} className={cn(secondaryButton, 'w-full justify-center')}>
          <RefreshCwIcon className={cn('size-4', busy && 'animate-spin')} />
          Sync likes/comments
        </button>
        {item.sourceWorkflowRunId ? (
          <div className='rounded-md border border-border bg-background p-2'>
            <p className='text-[10px] uppercase tracking-[0.08em] text-muted-foreground'>Draft workflow run</p>
            <p className='mt-1 truncate font-mono text-[12px] text-foreground'>{item.sourceWorkflowRunId}</p>
          </div>
        ) : null}
        <div className='grid grid-cols-3 gap-2'>
          <Metric label='Likes' value={formatNumber(item.analytics.likes)} />
          <Metric label='Comments' value={formatNumber(item.analytics.comments)} />
          <Metric label='Saves' value={formatNumber(item.analytics.saves)} />
        </div>
        <div className='rounded-md border border-border bg-background p-3'>
          <p className='text-[11px] uppercase tracking-[0.08em] text-muted-foreground'>Content effectiveness</p>
          <p className='mt-1 text-[18px] font-semibold'>{score?.label ?? 'Not tracked yet'}</p>
          <p className='mt-1 text-[12px] leading-relaxed text-muted-foreground'>
            {score?.description ?? 'Add a published URL and sync metrics after publishing.'}
          </p>
          {item.analytics.syncedAt ? <p className='mt-2 font-mono text-[11px] text-muted-foreground'>Synced {shortRelativeMs(item.analytics.syncedAt)}</p> : null}
        </div>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className='block'>
      <span className='mb-1.5 block text-[12px] font-medium text-muted-foreground'>{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className='rounded-md border border-border bg-background px-2 py-2'>
      <p className='text-[10px] uppercase tracking-[0.08em] text-muted-foreground'>{label}</p>
      <p className={cn('mt-1 truncate font-mono text-[13px] text-foreground', tone)}>{value}</p>
    </div>
  )
}

function CreateContentDialog({
  open,
  posts,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean
  posts: CapturedPostSummary[]
  projectId?: string
  onClose: () => void
  onCreated: (item: ContentItemSummary) => void
}) {
  const [referencePostId, setReferencePostId] = useState('')
  const [referenceUrl, setReferenceUrl] = useState('')
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = posts.filter((post) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [post.caption, post.competitorHandle, post.username].filter(Boolean).join(' ').toLowerCase().includes(q)
  })
  const selectedPost = posts.find((post) => post.id === referencePostId)

  useEffect(() => {
    if (!open) return
    setReferencePostId(posts[0]?.id ?? '')
    setReferenceUrl('')
    setTitle('')
    setQuery('')
  }, [open, posts])

  const cleanUrl = referenceUrl.trim()
  const canCreate = Boolean(title.trim() && (cleanUrl || referencePostId))

  async function submit() {
    if (!canCreate) return
    setBusy(true)
    try {
      const created = await createContentItem({
        projectId,
        referencePostId: cleanUrl ? undefined : referencePostId,
        referenceUrl: cleanUrl || undefined,
        title: title.trim(),
        status: 'idea',
        rawBrief: cleanUrl
          ? `Reference URL: ${cleanUrl}`
          : selectedPost?.caption ? `Reference: ${selectedPost.caption}` : undefined,
      })
      onCreated(created)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className='sm:max-w-6xl w-full bg-card p-0'>
        <DialogHeader className='border-b border-border px-5 py-4'>
          <DialogTitle>New content item</DialogTitle>
          <DialogDescription>
            Pick a captured post or paste an Instagram URL as the reference for this content item.
          </DialogDescription>
        </DialogHeader>
        <div className='grid grid-cols-[1.2fr_1fr] gap-0'>
          <div className='border-r border-border p-4'>
            <label className='mb-3 flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground'>
              <SearchIcon className='size-4' />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Find reference post...'
                className='min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none'
              />
            </label>
            <div className='max-h-[420px] space-y-2 overflow-y-auto'>
              {filtered.map((post) => (
                <button
                  key={post.id}
                  type='button'
                  onClick={() => {
                    setReferencePostId(post.id)
                    if (!title.trim()) setTitle(titleFromPost(post))
                  }}
                  className={cn(
                    'flex w-full gap-3 rounded-md border p-2 text-left transition-colors',
                    referencePostId === post.id ? 'border-[var(--anubis-gold)] bg-[var(--anubis-gold)]/10' : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  <div className='flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted'>
                    {post.mediaUrl ? <img src={post.mediaUrl} alt='' className='size-full object-cover' referrerPolicy='no-referrer' /> : <LinkIcon className='size-5 text-muted-foreground' />}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <p className='font-mono text-[11px] text-foreground'>{post.competitorHandle ?? post.username}</p>
                    <p className='mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground'>{post.caption ?? '(No caption)'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className='space-y-4 p-4'>
            <Field label='Reference URL'>
              <input
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder='https://www.instagram.com/p/...'
                className={inputClass}
              />
            </Field>
            <Field label='Title'>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
            </Field>
            <div className='rounded-md border border-border bg-background p-3'>
              <p className='text-[11px] uppercase tracking-[0.08em] text-muted-foreground'>Selected reference</p>
              <p className='mt-2 line-clamp-5 break-all text-[12.5px] leading-relaxed text-foreground/85'>
                {cleanUrl || selectedPost?.caption || 'Paste a URL or select a captured post to continue.'}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter className='border-t border-border px-5 py-3'>
          <button type='button' onClick={onClose} className={secondaryButton}>
            <XIcon className='size-4' />
            Cancel
          </button>
          <button type='button' onClick={() => void submit()} disabled={busy || !canCreate} className={primaryButton}>
            <PlusIcon className='size-4' />
            Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function referenceEffectiveness(
  post: CapturedPostSummary,
  levelsCfg: CompetitorLevelsConfig,
  multipliersCfg: LevelMultipliersConfig,
) {
  const level = effectiveLevel(post.competitorLevel, post.competitorFollowers, levelsCfg)
  const result = multiplierRatingFor(level, post.likes, post.competitorAvgLikes, multipliersCfg)
  return {
    multiplier: result.multiplier == null ? '-' : `${result.multiplier.toFixed(1)}x`,
    rating: result.rating,
    tone:
      result.rating === 'green' ? 'text-[var(--anubis-success)]'
      : result.rating === 'yellow' ? 'text-[var(--anubis-gold)]'
      : result.rating === 'red' ? 'text-destructive'
      : 'text-muted-foreground',
  }
}

function contentEffectiveness(item: ContentItemSummary): { label: string; description: string } | null {
  const own = (item.analytics.likes ?? 0) + (item.analytics.comments ?? 0) + (item.analytics.saves ?? 0)
  const ref = (item.referencePost?.likes ?? 0) + (item.referencePost?.comments ?? 0)
  if (own <= 0) return null
  if (ref <= 0) {
    return { label: formatNumber(own), description: 'Total tracked engagement across likes, comments, and saves.' }
  }
  const ratio = own / ref
  return {
    label: `${ratio.toFixed(2)}x reference engagement`,
    description: `${formatNumber(own)} tracked interactions versus ${formatNumber(ref)} on the reference.`,
  }
}

function parseNonNegativeInt(value: string): number | undefined {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.floor(n))
}

function titleFromPost(post: CapturedPostSummary): string {
  const caption = post.caption?.trim()
  if (!caption) return `Idea from ${post.competitorHandle ?? post.username}`
  return caption.length > 72 ? `${caption.slice(0, 72)}...` : caption
}

function toDateInputValue(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

function formatNumber(n: number | undefined): string {
  if (n == null) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function shortRelativeMs(ms: number): string {
  const delta = Date.now() - ms
  const min = Math.round(delta / 60_000)
  if (min < 60) return `${Math.max(1, min)}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.round(day / 7)
  return `${wk}w ago`
}

const primaryButton =
  'inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:cursor-not-allowed disabled:opacity-50'

const secondaryButton =
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'

const dangerButton =
  'inline-flex h-9 items-center justify-center rounded-md border border-destructive/35 bg-destructive/10 px-3 text-destructive transition-colors hover:bg-destructive/15'

const statusChip =
  'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors'

const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-[var(--anubis-gold)]/60'
