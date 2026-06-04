import { memo } from 'react'
import { Table as TableIcon } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'

export interface TableNodeData { staticData?: Array<Record<string, unknown>> }

export const TableExecutableNode = memo(function TableExecutableNode({ id, data }: { id: string; data: TableNodeData }) {
  const count = data.staticData?.length ?? 0
  const runStatus = useNodeRunStatus(id)
  return (
    <NodeShell
      icon={TableIcon}
      title='Table'
      subtitle='Passive — displays input or static rows'
      accent='from-[#fd551d] to-[#22c55e]'
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge>{count} static rows</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-zinc-300'>Whatever flows in shows up here.</p>
    </NodeShell>
  )
})
