import type { FC } from 'react'
import { useEditorStore } from './editor-store'
import { InstagramPostConfigForm }    from './inspector/config/instagram-post-config'
import { TransformerMediaConfigForm } from './inspector/config/transformer-media-config'
import { TransformerBriefConfigForm } from './inspector/config/transformer-brief-config'
import { JsonTransformerConfigForm } from './inspector/config/json-transformer-config'
import { OcrExtractorConfigForm }     from './inspector/config/ocr-extractor-config'
import { TableConfigForm }            from './inspector/config/table-config'
import { ImageVideoConfigForm }       from './inspector/config/image-video-config'
import { AiAgentConversationConfigForm } from './inspector/config/ai-agent-conversation-config'
import { MarkdownDisplayConfigForm } from './inspector/config/markdown-display-config'
import { ScheduleTriggerConfigForm } from './inspector/config/schedule-trigger-config'
import { FileWatchTriggerConfigForm } from './inspector/config/file-watch-trigger-config'
import { RunViewer } from './inspector/run-viewer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CONFIG_FORMS: Record<string, FC<{ nodeId: string }>> = {
  instagramPost:       InstagramPostConfigForm,
  transformerMedia:    TransformerMediaConfigForm,
  transformerBrief:    TransformerBriefConfigForm,
  jsonTransformer:     JsonTransformerConfigForm,
  ocrExtractor:        OcrExtractorConfigForm,
  table:               TableConfigForm,
  imageVideo:          ImageVideoConfigForm,
  aiAgentConversation: AiAgentConversationConfigForm,
  markdownDisplay:     MarkdownDisplayConfigForm,
  scheduleTrigger:     ScheduleTriggerConfigForm,
  fileWatchTrigger:    FileWatchTriggerConfigForm,
}

export function InspectorPanel() {
  const selection = useEditorStore((s) => s.selection)
  const draft     = useEditorStore((s) => s.draft)
  const name      = useEditorStore((s) => s.name)
  const setName   = useEditorStore((s) => s.setName)
  const mode      = useEditorStore((s) => s.inspectorMode)
  const setMode   = useEditorStore((s) => s.setInspectorMode)
  const activeRun = useEditorStore((s) => s.activeRun)
  const setNodes  = useEditorStore((s) => s.setNodes)
  const pushHistory = useEditorStore((s) => s.pushHistory)

  const selectedNodes = draft.nodes.filter((n) => selection.includes(n.id))

  function handleBulkDelete() {
    pushHistory()
    setNodes(draft.nodes.filter((n) => !selection.includes(n.id)))
  }

  return (
    <aside className='w-[360px] shrink-0 border-l border-border bg-sidebar p-4 overflow-auto'>
      {activeRun ? (
        <div className='mb-3 flex items-center justify-between'>
          <p className='text-xs uppercase tracking-wider text-muted-foreground'>Mode</p>
          <div className='flex gap-1'>
            <Button size='sm' variant={mode === 'config' ? 'default' : 'ghost'} onClick={() => setMode('config')}>Config</Button>
            <Button size='sm' variant={mode === 'run' ? 'default' : 'ghost'} onClick={() => setMode('run')}>Run</Button>
          </div>
        </div>
      ) : null}

      {mode === 'run' && activeRun ? (
        <RunViewer />
      ) : selectedNodes.length === 0 ? (
        <div className='space-y-3'>
          <p className='text-xs uppercase tracking-wider text-muted-foreground'>Workflow</p>
          <label className='block text-xs'>Name
            <Input className='mt-1' value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
      ) : selectedNodes.length > 1 ? (
        <div className='space-y-3'>
          <p className='text-sm font-medium'>{selectedNodes.length} nodes selected</p>
          <Button size='sm' variant='destructive' onClick={handleBulkDelete}>Delete selection</Button>
        </div>
      ) : (() => {
        const node = selectedNodes[0]!
        const Form = CONFIG_FORMS[node.type ?? '']
        if (!Form) return <p className='text-xs text-muted-foreground'>No config form for type "{node.type}"</p>
        return <Form nodeId={node.id} />
      })()}
    </aside>
  )
}
