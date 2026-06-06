import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Data = { title?: string; instructions?: string; maxIterations?: number }

export function HumanApprovalConfigForm({ nodeId }: { nodeId: string }) {
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
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Human Review</p>
      <label className='block text-xs'>Title
        <Input className='mt-1' value={data.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
      </label>
      <label className='block text-xs'>Instructions
        <Textarea className='mt-1' rows={3} value={data.instructions ?? ''} onChange={(e) => update({ instructions: e.target.value })} />
      </label>
      <label className='block text-xs'>Max loop iterations (reject → improve)
        <Input
          type='number' min={1} className='mt-1'
          value={data.maxIterations ?? 3}
          onChange={(e) => update({ maxIterations: Number(e.target.value) || undefined })}
        />
      </label>
    </div>
  )
}
