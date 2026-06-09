import { memo } from 'react'
import { Mic } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface TranscriberNodeData extends TitledNodeData {
  mediaPath?: string
  language?: string
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  force?: boolean
}

export const TranscriberExecutableNode = memo(function TranscriberExecutableNode({ id, data }: { id: string; data: TranscriberNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as
    | { kind: 'json'; value: { text: string; language?: string; segments?: unknown[] } }
    | undefined
  const subtitle = data.mediaPath
    ? `${data.mediaPath} · ${data.whisperModel ?? 'large-v3'}`
    : `Falls back to upstream media path · ${data.whisperModel ?? 'large-v3'}`
  return (
    <NodeShell
      icon={Mic}
      title={nodeTitle(data, 'Transcriber')}
      subtitle={subtitle}
      accent={ACCENT_GRADIENTS.data}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      <p className='text-xs text-muted-foreground'>Transcribes audio/video via anubis-extractor</p>
      {output?.kind === 'json' && typeof output.value?.text === 'string' ? (
        <div className='mt-3 max-h-[160px] overflow-auto rounded-xl border border-border bg-muted/30 p-2'>
          {output.value.language && (
            <div className='mb-1 font-mono text-[10px] text-muted-foreground'>lang: {output.value.language}</div>
          )}
          <pre className='whitespace-pre-wrap break-words text-[10px] text-muted-foreground'>{output.value.text || '(empty)'}</pre>
        </div>
      ) : null}
    </NodeShell>
  )
})
