import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Data = {
  outputPath?: string
  filename?: string
  extension?: 'md' | 'json' | 'txt'
}

export function OutputCapturerConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Output Capturer</p>

      <label className='block text-xs'>Output Path (optional)
        <Input
          className='mt-1'
          value={data.outputPath ?? ''}
          onChange={(e) => update({ outputPath: e.target.value })}
          placeholder='Defaults to <workdir>/.anubis/captures/'
        />
      </label>

      <label className='block text-xs'>Filename Template (optional)
        <Input
          className='mt-1'
          value={data.filename ?? ''}
          onChange={(e) => update({ filename: e.target.value })}
          placeholder='Defaults to output-{timestamp}'
        />
        <span className='text-[10px] text-muted-foreground mt-1 block'>
          Supports <code>{'{timestamp}'}</code> and <code>{'{title}'}</code> placeholders.
        </span>
      </label>

      <label className='block text-xs'>File Extension
        <Select
          value={data.extension ?? 'json'}
          onValueChange={(v) => update({ extension: v as 'md' | 'json' | 'txt' })}
        >
          <SelectTrigger className='mt-1'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='json'>json (JSON stringified)</SelectItem>
            <SelectItem value='md'>md (Markdown / text as-is)</SelectItem>
            <SelectItem value='txt'>txt (Plain text as-is)</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>
  )
}
