import { useEffect, useState } from 'react'
import { workflowsApi, type WorkflowSummary } from '@/api/workflows'
import { useNavigation } from '@/lib/navigation'
import { useActiveWorkspace } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { WorkflowCardPreview } from './workflows/workflow-card-preview'

export function WorkflowsPage() {
  const { navigate } = useNavigation()
  const { activeWorkspaceId } = useActiveWorkspace()
  const [items, setItems] = useState<WorkflowSummary[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    workflowsApi.list(activeWorkspaceId).then((r) => setItems(r.items)).catch((e) => console.error(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  async function handleCreate() {
    if (!draftName.trim()) return
    const wf = await workflowsApi.create(draftName.trim(), undefined, activeWorkspaceId)
    setIsCreating(false); setDraftName('')
    navigate({ page: 'workflow-editor', workflowId: wf.id })
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this workflow? Runs will also be removed.')) return
    await workflowsApi.remove(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleRun(id: string) {
    try {
      const r = await workflowsApi.startRun(id)
      navigate({ page: 'workflow-editor', workflowId: id })
      console.log('Run started:', r.runId)
    } catch (e) {
      console.error(e)
    }
  }

  function statusLabel(item: WorkflowSummary): string {
    if (!item.hasPublished) return 'Draft only'
    if (item.draftAhead) return 'Draft ahead of published'
    return 'Up to date'
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-4 flex items-center justify-between'>
        <div>
          <p className='text-xs uppercase tracking-[0.3em] text-[#fd551d]'>Workflows</p>
          <h1 className='mt-2 text-2xl font-semibold tracking-tight'>Your workflows</h1>
        </div>
        <Button onClick={() => setIsCreating(true)}>+ New workflow</Button>
      </div>
      <div className='flex-1 overflow-auto p-6 grid gap-4 grid-cols-3'>
        {items.length === 0 ? (
          <p className='text-sm text-muted-foreground col-span-full'>No workflows yet. Click "New workflow" to get started.</p>
        ) : items.map((item) => (
          <div key={item.id} className='flex flex-col overflow-hidden rounded-2xl border border-border bg-card max-h-72'>
            <WorkflowCardPreview graphJson={item.previewGraph} />
            <div className='space-y-3 p-5'>
              <div>
                <p className='text-base font-medium cursor-pointer hover:underline' onClick={() => navigate({ page: 'workflow-editor', workflowId: item.id })}>
                  {item.name}
                </p>
                {item.description ? <p className='text-xs text-muted-foreground'>{item.description}</p> : null}
                <p className='mt-2 text-[11px] uppercase tracking-wider text-muted-foreground'>{statusLabel(item)}</p>
                <p className='text-xs text-muted-foreground'>
                  {item.lastRun ? `Last run: ${item.lastRun.status}` : 'Never run'}
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' variant='secondary' onClick={() => navigate({ page: 'workflow-editor', workflowId: item.id })}>Open</Button>
                <Button size='sm' disabled={!item.hasPublished} onClick={() => handleRun(item.id)}>Run</Button>
                <Button size='sm' variant='ghost' onClick={() => handleDelete(item.id)}>Delete</Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New workflow</DialogTitle></DialogHeader>
          <Input autoFocus placeholder='Workflow name' value={draftName} onChange={(e) => setDraftName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }} />
          <DialogFooter>
            <Button variant='ghost' onClick={() => setIsCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
