import { useState, useEffect } from 'react'
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { listPosts } from '@/api'
import type { CapturedPostSummary } from '@anubis/shared'
import { SearchIcon, HeartIcon, MessageCircleIcon, CheckIcon, Loader2Icon, ImageIcon, VideoIcon, CopyIcon, CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Data = {
  source?: 'existing' | 'url'
  postId?: string
  url?: string
  title?: string
  postSummary?: {
    username: string
    caption?: string
    mediaUrl?: string
    likes?: number
    comments?: number
  }
}

function FormatIcon({ kind }: { kind?: 'image' | 'video' | 'carousel' }) {
  if (kind === 'video') return <VideoIcon className="size-4 text-muted-foreground" />
  if (kind === 'carousel') return <CopyIcon className="size-4 text-muted-foreground" />
  return <ImageIcon className="size-4 text-muted-foreground" />
}

function formatDate(isoString?: string) {
  if (!isoString) return 'unknown date'
  try {
    return new Date(isoString).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return 'unknown date'
  }
}

export function InstagramPostConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const projectId = useEditorStore((s) => s.projectId)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [posts, setPosts] = useState<CapturedPostSummary[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [competitorFilter, setCompetitorFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'month'>('all')

  function update(patch: Partial<Data>) {
    if (!node) return
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  useEffect(() => {
    setPosts(null)
  }, [projectId])

  // Load posts on demand when the modal is opened
  useEffect(() => {
    if (isModalOpen && !posts) {
      setIsLoading(true)
      listPosts({ limit: 200, projectId: projectId ?? undefined })
        .then((items) => {
          setPosts(items)
        })
        .catch((err) => {
          console.error('Failed to fetch captured posts:', err)
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [isModalOpen, posts, projectId])

  // Legacy fallback: if there is a postId but no postSummary, try to load it from database
  useEffect(() => {
    if (data.source === 'existing' && data.postId && !data.postSummary) {
      listPosts({ limit: 200, projectId: projectId ?? undefined })
        .then((fetchedPosts) => {
          const found = fetchedPosts.find((p) => p.id === data.postId)
          if (found) {
            update({
              title: `Instagram Post: @${found.username}`,
              postSummary: {
                username: found.username,
                caption: found.caption,
                mediaUrl: found.mediaUrl,
                likes: found.likes,
                comments: found.comments
              }
            })
          }
        })
        .catch((err) => console.error('Failed to load legacy post summary', err))
    }
  }, [data.postId, data.source, projectId])

  function handleSelectPost(post: CapturedPostSummary) {
    pushHistory()
    update({
      postId: post.id,
      title: `Instagram Post: @${post.username}`,
      postSummary: {
        username: post.username,
        caption: post.caption,
        mediaUrl: post.mediaUrl,
        likes: post.likes,
        comments: post.comments
      }
    })
    setIsModalOpen(false)
  }

  // Get unique competitor list from loaded posts for drop-down filter
  const uniqueCompetitors = Array.from(new Set((posts ?? []).map((p) => p.username))).sort()

  const filteredPosts = (posts ?? []).filter((post) => {
    // 1. Search Query
    const query = searchQuery.toLowerCase().trim()
    if (query) {
      const matchSearch =
        post.username.toLowerCase().includes(query) ||
        (post.caption && post.caption.toLowerCase().includes(query))
      if (!matchSearch) return false
    }

    // 2. Competitor Filter
    if (competitorFilter !== 'all' && post.username !== competitorFilter) {
      return false
    }

    // 3. Date Filter
    if (dateFilter !== 'all' && post.postedAt) {
      const postDate = new Date(post.postedAt).getTime()
      const limitDate = Date.now() - (dateFilter === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000)
      if (postDate < limitDate) return false
    }

    return true
  })

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Instagram Post</p>
      <label className='block text-xs'>Source
        <Select value={data.source ?? 'existing'} onValueChange={(v) => {
          pushHistory()
          update({ source: v as Data['source'] })
        }}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='existing'>Existing captured post</SelectItem>
            <SelectItem value='url'>URL (will trigger crawler)</SelectItem>
          </SelectContent>
        </Select>
      </label>

      {data.source === 'url' ? (
        <label className='block text-xs'>URL
          <Input
            className='mt-1'
            value={data.url ?? ''}
            onChange={(e) => {
              pushHistory()
              update({ url: e.target.value })
            }}
            placeholder='https://instagram.com/p/...'
          />
        </label>
      ) : (
        <div className='block text-xs space-y-1.5'>
          <span>Selected Captured Post</span>
          {data.postId ? (
            <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-foreground">@{data.postSummary?.username || 'unknown'}</span>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className="text-xs text-[var(--anubis-gold)] hover:underline font-medium"
                >
                  Change Post
                </button>
              </div>
              {data.postSummary?.mediaUrl && (
                <div className="relative h-28 w-full overflow-hidden rounded border border-border bg-background">
                  <img
                    src={data.postSummary.mediaUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              {data.postSummary?.caption && (
                <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                  {data.postSummary.caption}
                </p>
              )}
              <div className="flex gap-3 text-[10px] text-muted-foreground font-mono">
                {data.postSummary?.likes !== undefined && <span>♥ {data.postSummary.likes}</span>}
                {data.postSummary?.comments !== undefined && <span>💬 {data.postSummary.comments}</span>}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 h-10 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
            >
              Select Captured Post...
            </button>
          )}
        </div>
      )}

      {/* Select Post Dialog Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-6xl w-full max-h-[90vh] flex flex-col p-0 overflow-hidden bg-card">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle>Select Captured Post</DialogTitle>
            <DialogDescription>
              Choose a competitor post from the database to use as the source.
            </DialogDescription>
          </DialogHeader>

          {/* Filter and Search Bar */}
          <div className="px-6 py-4 border-b border-border space-y-3 bg-muted/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* Search Input */}
              <div className="relative flex-1 flex items-center h-10 rounded-md border border-border bg-background px-3 focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]">
                <SearchIcon className="size-4 text-muted-foreground mr-2 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search handle or caption..."
                  className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>

              {/* Competitor Dropdown Filter */}
              <div className="relative w-full sm:w-56">
                <select
                  value={competitorFilter}
                  onChange={(e) => setCompetitorFilter(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]"
                >
                  <option value="all">All Competitors</option>
                  {uniqueCompetitors.map((handle) => (
                    <option key={handle} value={handle}>
                      @{handle}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Date Filter Buttons */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium flex items-center gap-1">
                  <CalendarIcon className="size-3 text-muted-foreground" />
                  Date:
                </span>
                {[
                  ['all', 'All'],
                  ['week', '1 week'],
                  ['month', '1 month'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDateFilter(value as 'all' | 'week' | 'month')}
                    className={cn(
                      "inline-flex h-8 items-center rounded-md border px-3 text-[11.5px] font-medium transition-colors",
                      dateFilter === value
                        ? "border-[color-mix(in_oklab,var(--anubis-gold)_58%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Stats Label */}
              {posts && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  {filteredPosts.length} of {posts.length} posts
                </span>
              )}
            </div>
          </div>

          {/* Grid of Posts */}
          <div className="flex-1 overflow-y-auto px-6 py-6 min-h-[40vh] max-h-[60vh]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Loader2Icon className="size-8 animate-spin text-[var(--anubis-gold)] mb-2" />
                <span className="text-xs">Loading captured posts...</span>
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="text-center py-20 text-xs text-muted-foreground">
                {posts ? 'No posts match your filters.' : 'No captured posts found in database.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredPosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => handleSelectPost(post)}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-lg border text-left bg-background transition-all hover:-translate-y-0.5 hover:shadow-md",
                      data.postId === post.id
                        ? "border-[var(--anubis-gold)] ring-1 ring-[var(--anubis-gold)]"
                        : "border-border hover:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]"
                    )}
                  >
                    {/* Media Thumbnail */}
                    <div className="relative aspect-square w-full overflow-hidden border-b border-border bg-muted/30">
                      {post.mediaUrl ? (
                        <img
                          src={post.mediaUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-muted/40">
                          <FormatIcon kind={post.mediaKind} />
                        </div>
                      )}

                      {/* Selected Indicator Checkbox overlay */}
                      <span
                        className={cn(
                          "absolute top-2 left-2 flex size-5 items-center justify-center rounded border transition-colors z-[2]",
                          data.postId === post.id
                            ? "border-[var(--anubis-gold)] bg-[var(--anubis-gold)] text-[#0B0C0F]"
                            : "border-white/40 bg-black/40 text-transparent"
                        )}
                      >
                        <CheckIcon className="size-3" strokeWidth={3} />
                      </span>

                      {/* Format Badge Overlay */}
                      <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.05em] text-white">
                        {post.mediaKind || 'image'}
                      </span>
                    </div>

                    {/* Meta Section */}
                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-1 font-mono text-[11px] text-foreground font-semibold">
                          <span className="truncate">@{post.username}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground font-normal">{formatDate(post.postedAt)}</span>
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed min-h-[36px]">
                          {post.caption || <em className="text-muted-foreground/45">No caption</em>}
                        </p>
                      </div>

                      <div className="mt-2.5 flex items-center gap-3 text-[10px] text-muted-foreground font-mono tabular-nums">
                        {post.likes !== undefined && (
                          <span className="inline-flex items-center gap-1">
                            <HeartIcon className="size-3 text-muted-foreground" />
                            {post.likes}
                          </span>
                        )}
                        {post.comments !== undefined && (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircleIcon className="size-3 text-muted-foreground" />
                            {post.comments}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-xs font-medium transition-colors hover:bg-muted"
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
