import { useEditorStore } from '../../editor-store'
import { Textarea } from '@/components/ui/textarea'

type Data = { staticData?: Array<Record<string, unknown>> }

export function TableConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data

  function update(text: string) {
    if (!node) return
    pushHistory()
    let parsed: Array<Record<string, unknown>> | undefined
    try {
      const v = JSON.parse(text)
      parsed = Array.isArray(v) ? v : undefined
    } catch { parsed = undefined }
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, staticData: parsed } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Table</p>
      <label className='block text-xs'>Static rows (JSON array, used when no upstream)
        <Textarea className='mt-1' rows={8} defaultValue={JSON.stringify(data.staticData ?? [], null, 2)} onBlur={(e) => update(e.target.value)} />
      </label>
    </div>
  )
}
