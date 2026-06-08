import { memo } from 'react'
import { Database } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface SavePlannerNodeData extends TitledNodeData {
  projectId?: string
  title?: string
  rawBrief?: string
  improvedDraft?: string
  referencePostId?: string
  referenceUrl?: string
  status?: 'idea' | 'review' | 'scheduled' | 'published' | 'rejected'
}

interface SavePlannerOutput {
  kind: 'savePlanner'
  itemId: string
  title: string
  status: string
}

export const SavePlannerExecutableNode = memo(function SavePlannerExecutableNode(
  { id, data }: { id: string; data: SavePlannerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as SavePlannerOutput | undefined
  const statusLabel = (data.status ?? 'idea').toUpperCase()

  return (
    <NodeShell
      icon={Database}
      title={nodeTitle(data, 'Save to Planner')}
      subtitle={data.projectId ? `Project: ${data.projectId} · ${statusLabel}` : `Project: default · ${statusLabel}`}
      accent={ACCENT_GRADIENTS.final}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      {output?.kind === 'savePlanner' ? (
        <div className='text-xs space-y-1 text-muted-foreground'>
          <p className='font-semibold text-foreground'>Saved successfully!</p>
          <p>ID: <code className='px-1 py-0.5 rounded bg-muted font-mono text-[10px]'>{output.itemId}</code></p>
          <p>Title: <span className='italic'>"{output.title}"</span></p>
          <p>Status: <span className='capitalize'>{output.status}</span></p>
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>
          Saves workflow execution results directly to the planner.
        </p>
      )}
    </NodeShell>
  )
})
