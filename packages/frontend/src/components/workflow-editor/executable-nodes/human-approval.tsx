import { memo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ApprovalHandles } from '@/components/workflow/handles'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { Button } from '@/components/ui/button'
import { workflowsApi } from '@/api/workflows'
import { useEditorStore } from '../editor-store'
import { useNodeRunStatus } from './_use-run-status'

export interface HumanApprovalNodeData { title?: string; instructions?: string; maxIterations?: number }

export const HumanApprovalExecutableNode = memo(function HumanApprovalExecutableNode(
  { id, data }: { id: string; data: HumanApprovalNodeData },
) {
  const status = useNodeRunStatus(id)
  const runId = useEditorStore((s) => s.activeRun?.runId)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!runId) return
    if (decision === 'rejected' && !notes.trim()) return
    setBusy(true)
    try { await workflowsApi.decide(runId, { nodeId: id, decision, notes: notes.trim() || undefined }) }
    catch (e) { console.error('decision failed', e) }
    finally { setBusy(false) }
  }

  return (
    <NodeShell
      icon={ShieldCheck}
      title={data.title ?? 'Human Review'}
      subtitle={data.instructions ?? 'Approve or reject the content'}
      accent={ACCENT_GRADIENTS.review}
      runStatus={status}
      handlesNode={<ApprovalHandles />}
    >
      {status === 'awaiting' ? (
        <div className='flex flex-col gap-2'>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder='Comment (required to reject)…'
            className='nodrag w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50'
          />
          <div className='flex gap-2'>
            <Button size='sm' disabled={busy} onClick={() => decide('approved')}>Approve</Button>
            <Button size='sm' variant='destructive' disabled={busy || !notes.trim()} onClick={() => decide('rejected')}>Reject</Button>
          </div>
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>Pauses the run for your approve / reject decision.</p>
      )}
    </NodeShell>
  )
})
