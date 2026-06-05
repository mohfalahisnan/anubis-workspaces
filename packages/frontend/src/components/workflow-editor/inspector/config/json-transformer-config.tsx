import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Data = {
  sourcePath?: string
  template?: string
}

const EXAMPLE_TEMPLATE = `{
  "$map": "input.rows",
  "template": {
    "label": "example",
    "value": "{{item.value}}"
  }
}`

export function JsonTransformerConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>JSON Transformer</p>
      <label className='block text-xs'>Source path
        <Input
          className='mt-1'
          value={data.sourcePath ?? ''}
          onChange={(e) => update({ sourcePath: e.target.value })}
          placeholder='source.value'
        />
      </label>
      <label className='block text-xs'>Template
        <Textarea
          className='mt-1 font-mono text-xs'
          rows={12}
          value={data.template ?? ''}
          onChange={(e) => update({ template: e.target.value })}
          placeholder={EXAMPLE_TEMPLATE}
        />
      </label>
    </div>
  )
}
