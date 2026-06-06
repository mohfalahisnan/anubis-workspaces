import { memo } from 'react'
import { FolderSearch } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface FileWatchTriggerNodeData {
  path?: string
  watchKind?: 'file' | 'folder'
  glob?: string
  events?: Array<'add' | 'change' | 'unlink'>
}

export const FileWatchTriggerExecutableNode = memo(function FileWatchTriggerExecutableNode(
  { id, data }: { id: string; data: FileWatchTriggerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={FolderSearch}
      title='File watcher'
      subtitle={data.path ?? 'No path set'}
      accent={ACCENT_GRADIENTS.data}
      handles='out'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge tone='info'>trigger</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      <p className='text-xs text-muted-foreground'>
        Fires when {(data.events ?? ['add', 'change']).join(' / ')} happen in the watched {data.watchKind ?? 'folder'}.
      </p>
    </NodeShell>
  )
})
