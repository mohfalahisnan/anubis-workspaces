import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Format = 'post' | 'reels'

type Data = {
  caption?: string
  mediaUrl?: string
  username?: string
  avatarUrl?: string
  likesCount?: number
  commentsCount?: number
  format?: Format
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined
}

export function InstagramDraftPreviewConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n)))
  }

  return (
    <div className='space-y-4'>
      <div>
        <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Instagram Draft Preview</p>
        <p className='mt-1 text-[11px] text-muted-foreground'>
          Upstream fields override these fallbacks: caption, mediaUrl, username, avatarUrl, likesCount, commentsCount, format.
        </p>
      </div>

      <label className='block text-xs'>Format
        <Select value={data.format ?? 'post'} onValueChange={(v) => update({ format: v as Format })}>
          <SelectTrigger className='mt-1 w-full'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='post'>Post</SelectItem>
            <SelectItem value='reels'>Reels</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label className='block text-xs'>Username
        <Input className='mt-1' value={data.username ?? ''} onChange={(e) => update({ username: e.target.value })} placeholder='anubis' />
      </label>

      <label className='block text-xs'>Media URL or local path
        <Input className='mt-1' value={data.mediaUrl ?? ''} onChange={(e) => update({ mediaUrl: e.target.value })} placeholder='https://example.com/post.jpg' />
      </label>

      <label className='block text-xs'>Avatar URL or local path
        <Input className='mt-1' value={data.avatarUrl ?? ''} onChange={(e) => update({ avatarUrl: e.target.value })} placeholder='Optional' />
      </label>

      <label className='block text-xs'>Caption
        <Textarea className='mt-1 min-h-[88px] resize-y' rows={4} value={data.caption ?? ''} onChange={(e) => update({ caption: e.target.value })} />
      </label>

      <div className='grid grid-cols-2 gap-2'>
        <label className='block text-xs'>Likes
          <Input
            className='mt-1'
            type='number'
            min={0}
            value={data.likesCount ?? ''}
            onChange={(e) => update({ likesCount: numberOrUndefined(e.target.value) })}
          />
        </label>
        <label className='block text-xs'>Comments
          <Input
            className='mt-1'
            type='number'
            min={0}
            value={data.commentsCount ?? ''}
            onChange={(e) => update({ commentsCount: numberOrUndefined(e.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}
