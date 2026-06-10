import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'

type Ratio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
type Variations = 1 | 2 | 3 | 4
const RATIOS: Ratio[] = ['1:1', '16:9', '4:3', '3:4', '9:16']
const VARIATIONS: Variations[] = [1, 2, 3, 4]

type Data = {
  prompt?: string
  projectUrl?: string
  ratio?: Ratio
  variations?: Variations
  model?: string
  downloadDir?: string
}

export function FlowImageConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Flow Image</p>
      <label className='block text-xs'>Prompt (optional)
        <textarea
          className='mt-1 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs'
          rows={3}
          value={data.prompt ?? ''}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder='Falls back to upstream text output'
        />
      </label>
      <label className='block text-xs'>Project URL (optional)
        <Input
          className='mt-1'
          value={data.projectUrl ?? ''}
          onChange={(e) => update({ projectUrl: e.target.value })}
          placeholder='https://labs.google/fx/…/tools/flow/project/<id>'
        />
      </label>
      <div className='flex gap-2'>
        <label className='block flex-1 text-xs'>Ratio
          <select
            className='mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs'
            value={data.ratio ?? '1:1'}
            onChange={(e) => update({ ratio: e.target.value as Ratio })}
          >
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className='block flex-1 text-xs'>Variations
          <select
            className='mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs'
            value={data.variations ?? 1}
            onChange={(e) => update({ variations: Number(e.target.value) as Variations })}
          >
            {VARIATIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className='block text-xs'>Model
        <Input
          className='mt-1'
          value={data.model ?? ''}
          onChange={(e) => update({ model: e.target.value })}
          placeholder='Nano Banana Pro'
        />
      </label>
      <label className='block text-xs'>Download dir (optional)
        <Input
          className='mt-1'
          value={data.downloadDir ?? ''}
          onChange={(e) => update({ downloadDir: e.target.value })}
          placeholder='Absolute folder to save images into'
        />
      </label>
    </div>
  )
}
