import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type WatchEvent = 'add' | 'change' | 'unlink'
type Data = { path?: string; watchKind?: 'file' | 'folder'; glob?: string; events?: WatchEvent[] }

const ALL_EVENTS: WatchEvent[] = ['add', 'change', 'unlink']

export function FileWatchTriggerConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data
  const events = data.events ?? ['add', 'change']

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  function toggleEvent(ev: WatchEvent) {
    const next = events.includes(ev) ? events.filter((e) => e !== ev) : [...events, ev]
    update({ events: next.length > 0 ? next : [ev] })
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>File watcher</p>
      <label className='block text-xs'>Watch
        <Select value={data.watchKind ?? 'folder'} onValueChange={(v) => update({ watchKind: v as Data['watchKind'] })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='folder'>Folder (recursive)</SelectItem>
            <SelectItem value='file'>Single file</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Path
        <Input className='mt-1' value={data.path ?? ''} onChange={(e) => update({ path: e.target.value })}
               placeholder='C:\watched\folder' />
      </label>
      <label className='block text-xs'>Glob filter (optional)
        <Input className='mt-1' value={data.glob ?? ''} onChange={(e) => update({ glob: e.target.value })}
               placeholder='*.png' />
      </label>
      <div className='text-xs'>Events
        <div className='mt-1 flex gap-3'>
          {ALL_EVENTS.map((ev) => (
            <label key={ev} className='flex items-center gap-1 text-[11px]'>
              <input type='checkbox' checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
              {ev}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
