import { memo } from 'react'
import { Clock } from 'lucide-react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface ScheduleTriggerNodeData extends TitledNodeData {
  everyValue?: number
  everyUnit?: 'minute' | 'hour'
  cron?: string
}

export const ScheduleTriggerExecutableNode = memo(function ScheduleTriggerExecutableNode(
  { id, data }: { id: string; data: ScheduleTriggerNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const subtitle = data.cron && data.cron.trim()
    ? `cron: ${data.cron}`
    : `every ${data.everyValue ?? 1} ${data.everyUnit ?? 'hour'}`
  return (
    <NodeShell
      icon={Clock}
      title={nodeTitle(data, 'Schedule')}
      subtitle={subtitle}
      accent={ACCENT_GRADIENTS.warning}
      handles='out'
      runStatus={runStatus}
      footer={<div className='flex flex-wrap gap-2'><StatusBadge tone='info'>trigger</StatusBadge><RunStateBadge nodeId={id} /></div>}
    >
      <p className='text-xs text-muted-foreground'>Fires the workflow on a timer while armed.</p>
    </NodeShell>
  )
})
