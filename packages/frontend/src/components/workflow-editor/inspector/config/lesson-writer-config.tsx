import { useEffect, useState } from 'react'
import { useEditorStore } from '../../editor-store'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listProfiles } from '@/api'

type Reasoning = 'minimal' | 'low' | 'medium' | 'high'
type Data = { profileId?: string; reasoning?: Reasoning; prompt?: string; lessonType?: 'mistake' | 'lesson' }

export function LessonWriterConfigForm({ nodeId }: { nodeId: string }) {
  const draft = useEditorStore((s) => s.draft)
  const setNodes = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const node = draft.nodes.find((n) => n.id === nodeId)
  const data = (node?.data ?? {}) as Data
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    listProfiles()
      .then((items) => setProfiles(items.map((p) => ({ id: p.id, name: p.name }))))
      .catch(console.error)
  }, [])

  function update(patch: Partial<Data>) {
    if (!node) return
    pushHistory()
    setNodes(draft.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n)))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Lesson Writer</p>
      <label className='block text-xs'>Profile
        <Select value={data.profileId ?? ''} onValueChange={(v) => update({ profileId: v })}>
          <SelectTrigger className='mt-1'><SelectValue placeholder='Pick a profile' /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Lesson type
        <Select value={data.lessonType ?? 'mistake'} onValueChange={(v) => update({ lessonType: v as 'mistake' | 'lesson' })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='mistake'>mistake (rejected path)</SelectItem>
            <SelectItem value='lesson'>lesson (approved path)</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Prompt (optional — defaults by lesson type)
        <Textarea className='mt-1' rows={4} value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} />
      </label>
    </div>
  )
}
