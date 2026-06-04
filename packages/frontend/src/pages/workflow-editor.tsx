import { useEffect, useState } from 'react'
import { workflowsApi, openRunEventStream } from '@/api/workflows'
import { useNavigation } from '@/lib/navigation'
import { useEditorStore } from '@/components/workflow-editor/editor-store'
import { useAutosaveDraft } from '@/components/workflow-editor/autosave'
import { useEditorKeymap } from '@/components/workflow-editor/keymap'
import { NodePalette } from '@/components/workflow-editor/node-palette'
import { EditorCanvas } from '@/components/workflow-editor/editor-canvas'
import { InspectorPanel } from '@/components/workflow-editor/inspector-panel'
import { Button } from '@/components/ui/button'
import { ReactFlowProvider } from '@xyflow/react'
import { RunStatusBanner } from '@/components/workflow-editor/run-status-banner'

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const { navigate } = useNavigation()
  const hydrate       = useEditorStore((s) => s.hydrate)
  const name          = useEditorStore((s) => s.name)
  const isDirty       = useEditorStore((s) => s.isDirty)
  const publishedAt   = useEditorStore((s) => s.publishedAt)
  const setActiveRun  = useEditorStore((s) => s.setActiveRun)
  const applyRunEvent = useEditorStore((s) => s.applyRunEvent)
  const activeRun     = useEditorStore((s) => s.activeRun)
  const markPublished = useEditorStore((s) => s.markPublished)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    workflowsApi.get(workflowId).then((wf) => {
      hydrate({
        workflowId: wf.id, name: wf.name, description: wf.description,
        draft: JSON.parse(wf.draftGraph),
        published: wf.publishedGraph ? JSON.parse(wf.publishedGraph) : null,
        draftUpdatedAt: wf.draftUpdatedAt, publishedAt: wf.publishedAt ?? null,
      })
    }).catch((e) => setError(String(e)))
  }, [workflowId, hydrate])

  useAutosaveDraft()
  useEditorKeymap()

  async function publish() {
    try {
      const wf = await workflowsApi.publish(workflowId)
      if (wf.publishedAt) markPublished(wf.publishedAt, JSON.parse(wf.publishedGraph ?? '{"nodes":[],"edges":[]}'))
    } catch (e) { setError(String(e)) }
  }

  async function startRun() {
    try {
      const { runId } = await workflowsApi.startRun(workflowId)
      setActiveRun({ runId, steps: {}, status: 'running' })
      await openRunEventStream(runId, (ev) => applyRunEvent(ev))
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-3 flex items-center justify-between gap-4'>
        <Button size='sm' variant='ghost' onClick={() => navigate({ page: 'workflows' })}>← Workflows</Button>
        <p className='text-sm font-medium truncate'>{name}{isDirty ? ' •' : ''}</p>
        <div className='flex gap-2'>
          <Button size='sm' variant='secondary' onClick={publish}>{publishedAt ? 'Re-publish' : 'Publish'}</Button>
          <Button size='sm' onClick={startRun} disabled={!publishedAt || activeRun?.status === 'running'}>▶ Run published</Button>
        </div>
      </div>
      {error ? <p className='px-6 py-2 text-xs text-red-300'>{error}</p> : null}
      {activeRun ? <RunStatusBanner /> : null}
      <div className='flex min-h-0 flex-1'>
        <NodePalette />
        <div className='flex-1 min-w-0'>
          <ReactFlowProvider><EditorCanvas /></ReactFlowProvider>
        </div>
        <InspectorPanel />
      </div>
    </div>
  )
}
