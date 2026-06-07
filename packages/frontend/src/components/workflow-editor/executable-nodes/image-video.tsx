import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'
import { nodeTitle, type TitledNodeData } from './_node-title'

interface FileOutput {
  kind: 'file'
  path: string
  mimeType?: string
  sizeBytes?: number
}

interface FilesOutput {
  kind: 'files'
  files: FileOutput[]
}

export interface ImageVideoNodeData extends TitledNodeData {
  source?: 'url' | 'local' | 'upstream'
  url?: string
  path?: string
  inputPath?: string
}

export const ImageVideoExecutableNode = memo(function ImageVideoExecutableNode({ id, data }: { id: string; data: ImageVideoNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as FileOutput | FilesOutput | undefined

  const paths =
    output?.kind === 'file' ? [output.path]
    : output?.kind === 'files' ? output.files.map((f) => f.path)
    : []
  const hasMedia = paths.length > 0

  return (
    <NodeShell
      icon={ImageIcon}
      title={nodeTitle(data, 'Image / Video')}
      accent={ACCENT_GRADIENTS.media}
      runStatus={runStatus}
      bleed={hasMedia}
    >
      {hasMedia ? (
        // Pure media viewer — every file at its natural aspect ratio (no crop),
        // filling the card, no header/footer/captions.
        <div className={`grid items-start gap-1.5 p-2 ${paths.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {paths.map((path) => (
            <FileThumb key={path} path={path} fill />
          ))}
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>No media yet — run this node to load files.</p>
      )}
    </NodeShell>
  )
})
