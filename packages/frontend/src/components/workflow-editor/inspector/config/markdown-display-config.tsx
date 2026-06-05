import { useEditorStore } from '../../editor-store'

type Data = { staticText?: string }

export function MarkdownDisplayConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Markdown</p>
      <label className='block text-xs'>Fallback text (shown when no input is connected)
        <textarea
          className='mt-1 w-full rounded-md border border-border bg-background p-2 text-xs'
          rows={6}
          value={data.staticText ?? ''}
          onChange={(e) => update({ staticText: e.target.value })}
          placeholder='# Heading\n\nMarkdown body…'
        />
      </label>
      <p className='text-[10px] text-muted-foreground'>
        When an upstream node provides text, it overrides this fallback at run time.
      </p>
    </div>
  )
}
