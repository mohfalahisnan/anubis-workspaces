import { StatusBadge } from '@/components/workflow'
import { useEditorStore } from '../editor-store'

export function RunStateBadge({ nodeId }: { nodeId: string }) {
  const step = useEditorStore((s) => s.activeRun?.steps[nodeId])
  if (!step) return null
  if (step.status === 'awaiting')  return <StatusBadge tone='info'>Awaiting review</StatusBadge>
  if (step.status === 'running')   return <StatusBadge tone='info'>Running…</StatusBadge>
  if (step.status === 'succeeded') return <StatusBadge tone='success'>Succeeded</StatusBadge>
  if (step.status === 'failed')    return <StatusBadge tone='warning'>Failed</StatusBadge>
  if (step.status === 'skipped')   return <StatusBadge>Skipped</StatusBadge>
  return <StatusBadge>Pending</StatusBadge>
}
