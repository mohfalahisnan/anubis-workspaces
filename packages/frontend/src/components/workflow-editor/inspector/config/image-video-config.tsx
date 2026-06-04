import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Data = { source?: 'url' | 'local'; url?: string; path?: string }

export function ImageVideoConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Image / Video</p>
      <label className='block text-xs'>Source
        <Select value={data.source ?? 'url'} onValueChange={(v) => update({ source: v as Data['source'] })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='url'>URL (downloads to a run artifact)</SelectItem>
            <SelectItem value='local'>Local file (used as-is, no download)</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {data.source === 'local' ? (
        <label className='block text-xs'>Local file path
          <Input className='mt-1' value={data.path ?? ''} onChange={(e) => update({ path: e.target.value })}
                 placeholder='C:\path\to\image.jpg' />
        </label>
      ) : (
        <label className='block text-xs'>URL
          <Input className='mt-1' value={data.url ?? ''} onChange={(e) => update({ url: e.target.value })}
                 placeholder='https://example.com/image.png' />
        </label>
      )}
      <p className='text-[10px] text-muted-foreground'>
        Output is a file reference downstream nodes (OCR, AI Agent, Table) can read or pass through.
      </p>
    </div>
  )
}
