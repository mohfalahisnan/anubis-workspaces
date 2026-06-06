import { memo } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'

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

export interface ImageVideoNodeData {
  source?: 'url' | 'local' | 'upstream'
  url?: string
  path?: string
  inputPath?: string
}

export const ImageVideoExecutableNode = memo(function ImageVideoExecutableNode({ id, data }: { id: string; data: ImageVideoNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as FileOutput | FilesOutput | undefined
  const subtitle =
    data.source === 'local'
      ? data.path ?? 'No local path set'
      : data.source === 'upstream'
        ? data.inputPath?.trim() ? `From ${data.inputPath}` : 'From upstream array'
      : data.source === 'url'
        ? data.url ?? 'No URL set'
        : 'No source selected'
  return (
    <NodeShell
      icon={ImageIcon}
      title='Image / Video'
      subtitle={subtitle}
      accent={ACCENT_GRADIENTS.media}
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>{data.source ?? 'unset'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-muted-foreground'>
        {data.source === 'local'
          ? 'Uses an existing local file as-is (no download).'
          : data.source === 'upstream'
            ? 'Accepts an upstream array of URLs, local paths, or file objects.'
          : 'Downloads to a run artifact and outputs the file path.'}
      </p>
      {output?.kind === 'file' ? (
        <div className='mt-3 rounded-xl border border-border bg-muted/30 p-2'>
          <FileThumb path={output.path} />
          {output.mimeType ? (
            <p className='mt-1 truncate text-[10px] text-muted-foreground'>
              {output.mimeType}{output.sizeBytes ? ` · ${(output.sizeBytes / 1024).toFixed(1)} KB` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
      {output?.kind === 'files' ? (
        <div className='mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-2'>
          <div className={`grid gap-2 ${output.files.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {output.files.slice(0, 4).map((file) => (
              <FileThumb key={file.path} path={file.path} />
            ))}
          </div>
          <p className='text-[10px] text-muted-foreground'>
            {output.files.length} file{output.files.length === 1 ? '' : 's'}
          </p>
        </div>
      ) : null}
    </NodeShell>
  )
})
