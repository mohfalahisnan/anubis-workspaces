import { useEditorStore } from '../../editor-store'
import { Input } from '@/components/ui/input'

type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
const WHISPER_MODELS: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large-v3']

type Data = {
  mediaPath?: string
  language?: string
  whisperModel?: WhisperModel
  force?: boolean
}

export function TranscriberConfigForm({ nodeId }: { nodeId: string }) {
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
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Transcriber</p>
      <label className='block text-xs'>Media path (optional)
        <Input
          className='mt-1'
          value={data.mediaPath ?? ''}
          onChange={(e) => update({ mediaPath: e.target.value })}
          placeholder='Falls back to upstream file path'
        />
      </label>
      <label className='block text-xs'>Language (2-letter code, optional)
        <Input
          className='mt-1'
          value={data.language ?? ''}
          onChange={(e) => update({ language: e.target.value })}
          placeholder='en, id, …'
        />
      </label>
      <label className='block text-xs'>Whisper model
        <select
          className='mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs'
          value={data.whisperModel ?? 'large-v3'}
          onChange={(e) => update({ whisperModel: e.target.value as WhisperModel })}
        >
          {WHISPER_MODELS.map((m) => (
            <option key={m} value={m}>{m}{m === 'large-v3' ? ' (default)' : ''}</option>
          ))}
        </select>
      </label>
      <label className='flex items-center gap-2 text-xs'>
        <input
          type='checkbox'
          checked={data.force ?? false}
          onChange={(e) => update({ force: e.target.checked })}
        />
        Bypass sidecar cache
      </label>
    </div>
  )
}
