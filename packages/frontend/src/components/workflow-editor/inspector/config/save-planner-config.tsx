import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Status = 'idea' | 'review' | 'scheduled' | 'published' | 'rejected'

type Data = {
  projectId?: string
  title?: string
  rawBrief?: string
  improvedDraft?: string
  referencePostId?: string
  referenceUrl?: string
  status?: Status
}

export function SavePlannerConfigForm({ nodeId }: { nodeId: string }) {
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
    <div className='space-y-4'>
      <div>
        <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Save to Planner</p>
        <p className='text-[11px] text-muted-foreground mt-1'>
          Save content workflow outputs directly to the content planner. You can use template mapping like{' '}
          <code className='px-1 py-0.5 rounded bg-muted font-mono text-[10px]'>{"{{nodeId.field}}"}</code>.
        </p>
      </div>

      <label className='block text-xs'>Project ID (optional)
        <Input
          className='mt-1'
          value={data.projectId ?? ''}
          onChange={(e) => update({ projectId: e.target.value })}
          placeholder='default'
        />
      </label>

      <label className='block text-xs'>Title (optional)
        <Input
          className='mt-1'
          value={data.title ?? ''}
          onChange={(e) => update({ title: e.target.value })}
          placeholder='Falls back to first upstream text'
        />
      </label>

      <label className='block text-xs'>Status
        <Select value={data.status ?? 'idea'} onValueChange={(v) => update({ status: v as Status })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='idea'>Idea</SelectItem>
            <SelectItem value='review'>Review</SelectItem>
            <SelectItem value='scheduled'>Scheduled</SelectItem>
            <SelectItem value='published'>Published</SelectItem>
            <SelectItem value='rejected'>Rejected</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label className='block text-xs'>Raw brief template (optional)
        <Textarea
          className='mt-1 resize-y min-h-[80px]'
          rows={3}
          value={data.rawBrief ?? ''}
          onChange={(e) => update({ rawBrief: e.target.value })}
          placeholder='e.g. {{aiAgent.text}}'
        />
      </label>

      <label className='block text-xs'>Improved draft template (optional)
        <Textarea
          className='mt-1 resize-y min-h-[80px]'
          rows={3}
          value={data.improvedDraft ?? ''}
          onChange={(e) => update({ improvedDraft: e.target.value })}
          placeholder='e.g. {{agentCopy.text}}'
        />
      </label>

      <label className='block text-xs'>Reference post ID (optional)
        <Input
          className='mt-1'
          value={data.referencePostId ?? ''}
          onChange={(e) => update({ referencePostId: e.target.value })}
          placeholder='Falls back to upstream IG post ID'
        />
      </label>

      <label className='block text-xs'>Reference URL (optional)
        <Input
          className='mt-1'
          value={data.referenceUrl ?? ''}
          onChange={(e) => update({ referenceUrl: e.target.value })}
          placeholder='Falls back to upstream IG post URL'
        />
      </label>
    </div>
  )
}
