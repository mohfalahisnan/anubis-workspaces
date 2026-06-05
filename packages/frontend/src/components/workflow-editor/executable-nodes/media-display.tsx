import { memo } from 'react'
import { Film } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { FileThumb } from '@/components/workflow/file-thumb'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface MediaDisplayNodeData {}

export const MediaDisplayExecutableNode = memo(function MediaDisplayExecutableNode(
  { id }: { id: string; data: MediaDisplayNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as { kind: 'file'; path: string; mimeType?: string } | undefined
  return (
    <NodeShell
      icon={Film}
      title='Media'
      subtitle='Passive — displays an upstream image / video'
      accent='from-[#fd551d] to-[#8b5cf6]'
      handles='in'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge>output</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      {output?.kind === 'file' ? (
        <div className='mt-1 rounded-xl border border-white/10 bg-black/30 p-2'>
          <FileThumb path={output.path} />
          {output.mimeType ? <p className='mt-1 truncate text-[10px] text-zinc-500'>{output.mimeType}</p> : null}
        </div>
      ) : (
        <p className='text-xs text-zinc-300'>Connect a node that outputs a file.</p>
      )}
    </NodeShell>
  )
})
