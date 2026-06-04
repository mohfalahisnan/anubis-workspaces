import { useEditorStore } from '../../editor-store'
import { Textarea } from '@/components/ui/textarea'

type Data = { jsonTemplate?: string }

export function TransformerBriefConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Transformer · Brief</p>
      <label className='block text-xs'>JSON template
        <Textarea className='mt-1' rows={10} value={data.jsonTemplate ?? ''} onChange={(e) => update({ jsonTemplate: e.target.value })}
                  placeholder={'{\n  "topic": "{{n1.text}}"\n}'} />
      </label>
    </div>
  )
}
