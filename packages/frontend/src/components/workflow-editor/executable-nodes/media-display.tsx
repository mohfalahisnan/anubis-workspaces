import { memo } from 'react'
import { Film } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { FileThumb } from '@/components/workflow/file-thumb'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'

export interface MediaDisplayNodeData {}

interface FileOutput { kind: 'file'; path: string; mimeType?: string }
interface FilesOutput { kind: 'files'; files: Array<{ path: string }> }

export const MediaDisplayExecutableNode = memo(function MediaDisplayExecutableNode(
  { id }: { id: string; data: MediaDisplayNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as FileOutput | FilesOutput | undefined

  const paths =
    output?.kind === 'file' ? [output.path]
    : output?.kind === 'files' ? output.files.map((f) => f.path)
    : []

  const hasMedia = paths.length > 0

  return (
    <NodeShell
      icon={Film}
      title='Media'
      accent={ACCENT_GRADIENTS.media}
      handles='in'
      runStatus={runStatus}
      bleed={hasMedia}
    >
      {hasMedia ? (
        // Full-bleed media grid — no padding, no captions, just the media.
        <div className={`grid ${paths.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {paths.map((path) => (
            <FileThumb key={path} path={path} fill />
          ))}
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>Connect a node that outputs a file.</p>
      )}
    </NodeShell>
  )
})
