import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Data = { everyValue?: number; everyUnit?: 'minute' | 'hour'; cron?: string }

export function ScheduleTriggerConfigForm({ nodeId }: { nodeId: string }) {
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

  const cronActive = !!(data.cron && data.cron.trim())

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Schedule</p>
      <div className='flex gap-2'>
        <label className='block flex-1 text-xs'>Every
          <Input className='mt-1' type='number' min={1} disabled={cronActive}
                 value={data.everyValue ?? 1}
                 onChange={(e) => update({ everyValue: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label className='block flex-1 text-xs'>Unit
          <Select value={data.everyUnit ?? 'hour'} onValueChange={(v) => update({ everyUnit: v as Data['everyUnit'] })}>
            <SelectTrigger className='mt-1' disabled={cronActive}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='minute'>minutes</SelectItem>
              <SelectItem value='hour'>hours</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className='block text-xs'>Advanced: cron expression (overrides interval)
        <Input className='mt-1' value={data.cron ?? ''} onChange={(e) => update({ cron: e.target.value })}
               placeholder='*/5 * * * *' />
      </label>
      <p className='text-[10px] text-muted-foreground'>
        Leave cron empty to use the interval. Arm the workflow to start firing.
      </p>
    </div>
  )
}
