import { useEffect, useState } from 'react'
import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listProfiles } from '@/api'

type Reasoning = 'minimal' | 'low' | 'medium' | 'high'
type Data = {
  profileId?: string
  reasoning?: Reasoning
  prompt?: string
  titleTemplate?: string
}

export function AiAgentConversationConfigForm({ nodeId }: { nodeId: string }) {
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
    setNodes(draft.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...data, ...patch } } : n))
  }

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>AI Agent · Conversation</p>
      <label className='block text-xs'>Profile
        <Select value={data.profileId ?? ''} onValueChange={(v) => update({ profileId: v })}>
          <SelectTrigger className='mt-1'><SelectValue placeholder='Pick a profile' /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Reasoning effort
        <Select value={data.reasoning ?? 'medium'} onValueChange={(v) => update({ reasoning: v as Reasoning })}>
          <SelectTrigger className='mt-1'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='minimal'>minimal</SelectItem>
            <SelectItem value='low'>low</SelectItem>
            <SelectItem value='medium'>medium</SelectItem>
            <SelectItem value='high'>high</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className='block text-xs'>Initial prompt
        <Textarea className='mt-1' rows={6} value={data.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} />
      </label>
      <label className='block text-xs'>Conversation title (optional)
        <Input
          className='mt-1'
          placeholder={`Workflow · ${nodeId}`}
          value={data.titleTemplate ?? ''}
          onChange={(e) => update({ titleTemplate: e.target.value || undefined })}
        />
      </label>
    </div>
  )
}
