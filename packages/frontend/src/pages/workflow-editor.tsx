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
import { cn } from '@/lib/utils'

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
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [hasTrigger, setHasTrigger] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let closeStream: (() => void) | undefined
    workflowsApi.get(workflowId).then(async (wf) => {
      if (cancelled) return
      hydrate({
        workflowId: wf.id, name: wf.name, description: wf.description,
        draft: JSON.parse(wf.draftGraph),
        published: wf.publishedGraph ? JSON.parse(wf.publishedGraph) : null,
        draftUpdatedAt: wf.draftUpdatedAt, publishedAt: wf.publishedAt ?? null,
      })
      setHasTrigger(!!wf.hasTrigger)
      setArmed(!!wf.armed)
      // If a run is in flight for this workflow (user navigated away and
      // came back mid-run), resubscribe so node-level progress shows up
      // again instead of just the conversation-level "running" status.
      try {
        const { runId } = await workflowsApi.activeRun(workflowId)
        if (cancelled || !runId) return
        setActiveRun({ runId, steps: {}, status: 'running' })
        closeStream = await openRunEventStream(runId, (ev) => applyRunEvent(ev))
      } catch { /* missing /active-run is non-fatal */ }
    }).catch((e) => setNotification({ message: String(e), type: 'error' }))
    return () => {
      cancelled = true
      closeStream?.()
    }
  }, [workflowId, hydrate, setActiveRun, applyRunEvent])

  useAutosaveDraft()
  useEditorKeymap()

  async function publish() {
    try {
      const isRepublish = !!publishedAt
      const wf = await workflowsApi.publish(workflowId)
      if (wf.publishedAt) {
        markPublished(wf.publishedAt, JSON.parse(wf.publishedGraph ?? '{"nodes":[],"edges":[]}'))
        setNotification({
          message: isRepublish ? 'Workflow republished successfully!' : 'Workflow published successfully!',
          type: 'success'
        })
        setTimeout(() => setNotification((prev) => prev?.message.includes('published') ? null : prev), 4000)
      }
    } catch (e) {
      setNotification({ message: `Failed to publish workflow: ${e instanceof Error ? e.message : String(e)}`, type: 'error' })
    }
  }

  async function startRun() {
    try {
      const { runId } = await workflowsApi.startRun(workflowId)
      setActiveRun({ runId, steps: {}, status: 'running' })
      await openRunEventStream(runId, (ev) => applyRunEvent(ev))
    } catch (e) {
      setNotification({ message: String(e), type: 'error' })
    }
  }

  async function stopRun() {
    if (!activeRun?.runId) return
    try {
      await workflowsApi.cancelRun(activeRun.runId)
      setNotification({ message: 'Workflow run stopped.', type: 'success' })
      setTimeout(() => setNotification((prev) => prev?.message === 'Workflow run stopped.' ? null : prev), 4000)
    } catch (e) {
      setNotification({ message: `Failed to stop run: ${e instanceof Error ? e.message : String(e)}`, type: 'error' })
    }
  }

  async function toggleArm() {
    try {
      const r = armed ? await workflowsApi.disarm(workflowId) : await workflowsApi.arm(workflowId)
      setArmed(r.armed)
    } catch (e) {
      setNotification({ message: String(e), type: 'error' })
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-3 flex items-center justify-between gap-4'>
        <Button size='sm' variant='ghost' onClick={() => navigate({ page: 'workflows' })}>← Workflows</Button>
        <p className='text-sm font-medium truncate'>{name}{isDirty ? ' •' : ''}</p>
        <div className='flex gap-2'>
          <Button size='sm' variant='secondary' onClick={publish}>{publishedAt ? 'Re-publish' : 'Publish'}</Button>
          {hasTrigger ? (
            <Button size='sm' variant={armed ? 'destructive' : 'default'} onClick={toggleArm} disabled={!publishedAt}>
              {armed ? '■ Disarm' : '⚡ Arm'}
            </Button>
          ) : (
            activeRun?.status === 'running' ? (
              <Button size='sm' variant='destructive' onClick={stopRun}>■ Stop</Button>
            ) : (
              <Button size='sm' onClick={startRun} disabled={!publishedAt}>▶ Run published</Button>
            )
          )}
        </div>
      </div>
      {notification ? (
        <div
          className={cn(
            'px-6 py-2.5 text-xs border-b border-border flex items-center justify-between transition-colors duration-150',
            notification.type === 'success'
              ? 'bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-[color-mix(in_oklab,var(--anubis-gold)_80%,white)] border-[color-mix(in_oklab,var(--anubis-gold)_20%,transparent)]'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          )}
        >
          <span>{notification.message}</span>
          <button type='button' onClick={() => setNotification(null)} className='hover:text-foreground font-medium underline'>Dismiss</button>
        </div>
      ) : null}
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
