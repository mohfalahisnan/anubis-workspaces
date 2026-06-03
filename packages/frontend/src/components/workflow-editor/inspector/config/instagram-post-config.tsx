import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Data = { source?: 'existing' | 'url'; postId?: string; url?: string }

export function InstagramPostConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Instagram Post</p>
      <label className='block text-xs'>Source
        <Select value={data.source ?? 'existing'} onValueChange={(v) => update({ source: v as Data['source'] })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='existing'>Existing captured post</SelectItem>
            <SelectItem value='url'>URL (will trigger crawler)</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {data.source === 'url' ? (
        <label className='block text-xs'>URL
          <Input className='mt-1' value={data.url ?? ''} onChange={(e) => update({ url: e.target.value })} placeholder='https://instagram.com/p/...' />
        </label>
      ) : (
        <label className='block text-xs'>Captured Post ID
          <Input className='mt-1' value={data.postId ?? ''} onChange={(e) => update({ postId: e.target.value })} />
        </label>
      )}
    </div>
  )
}
