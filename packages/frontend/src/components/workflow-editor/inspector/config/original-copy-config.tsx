import { useEditorStore } from '../../editor-store'

type Data = { staticText?: string }

export function OriginalCopyConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Original Copy</p>
      <p className='text-[10px] text-muted-foreground'>
        Shows the original copywriting from an upstream content source — the Instagram Post
        caption, or any upstream text. Wire it from the source (not the analyst) to show the true original.
      </p>
      <label className='block text-xs'>Fallback text (shown when no input is connected)
        <textarea
          className='mt-1 w-full rounded-md border border-border bg-background p-2 text-xs'
          rows={6}
          value={data.staticText ?? ''}
          onChange={(e) => update({ staticText: e.target.value })}
          placeholder='Original caption…'
        />
      </label>
    </div>
  )
}
