import { useEditorStore } from '../editor-store'
import {
  InstagramDraftPreview,
  type InstagramDraftPreviewOutput,
} from '@/components/workflow/instagram-draft-preview'

export function RunViewer() {
  const selection = useEditorStore((s) => s.selection)
  const activeRun = useEditorStore((s) => s.activeRun)
  if (!activeRun) return <p className='text-xs text-muted-foreground'>No active run.</p>

  // No node selected — show the run-level summary (and the run error if it failed).
  if (selection.length !== 1) {
    return (
      <div className='space-y-3'>
        <p className='text-xs uppercase tracking-wider text-muted-foreground'>Run · {activeRun.runId}</p>
        <p className='text-sm'>Status: <b>{activeRun.status}</b></p>
        {activeRun.status === 'failed' ? (
          <pre className='whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive'>
            {activeRun.error || '(no error message returned by the runner)'}
          </pre>
        ) : null}
        <p className='text-xs text-muted-foreground'>Select a node on the canvas to inspect its output.</p>
      </div>
    )
  }

  const nodeId = selection[0]!
  const step = activeRun.steps[nodeId]
  if (!step) return <p className='text-xs text-muted-foreground'>This node has no run state yet.</p>
  const instagramPreview = step.output && typeof step.output === 'object' && (step.output as { kind?: unknown }).kind === 'instagramDraftPreview'
    ? step.output as InstagramDraftPreviewOutput
    : null

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Run · {nodeId}</p>
      <p className='text-sm'>Status: <b>{step.status}</b></p>
      {step.startedAt ? <p className='text-xs'>Started: {new Date(step.startedAt).toLocaleTimeString()}</p> : null}
      {step.finishedAt ? <p className='text-xs'>Finished: {new Date(step.finishedAt).toLocaleTimeString()}</p> : null}
      {step.status === 'failed' ? (
        <pre className='whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive'>
          {step.error || '(executor failed without a message)'}
        </pre>
      ) : null}
      {instagramPreview ? (
        <div className='overflow-hidden rounded-md border border-border'>
          <InstagramDraftPreview preview={instagramPreview} className='p-2' />
        </div>
      ) : step.output != null ? (
        <pre className='whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-[11px] text-foreground/80'>{JSON.stringify(step.output, null, 2)}</pre>
      ) : null}
    </div>
  )
}
