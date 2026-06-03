import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'

type Data = { imagePath?: string }

export function OcrExtractorConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>OCR Extractor</p>
      <label className='block text-xs'>Image path (optional)
        <Input className='mt-1' value={data.imagePath ?? ''} onChange={(e) => update({ imagePath: e.target.value })} placeholder='Falls back to upstream file path' />
      </label>
    </div>
  )
}
