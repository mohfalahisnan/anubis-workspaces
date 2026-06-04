import { useEditorStore } from '../editor-store'

export function RunViewer() {
  const selection = useEditorStore((s) => s.selection)
  const activeRun = useEditorStore((s) => s.activeRun)
  if (!activeRun) return <p className='text-xs text-muted-foreground'>No active run.</p>
  if (selection.length !== 1) return <p className='text-xs text-muted-foreground'>Select a node to inspect its run output.</p>
  const nodeId = selection[0]!
  const step = activeRun.steps[nodeId]
  if (!step) return <p className='text-xs text-muted-foreground'>This node has no run state yet.</p>

  return (
    <div className='space-y-3'>
      <p className='text-xs uppercase tracking-wider text-muted-foreground'>Run · {nodeId}</p>
      <p className='text-sm'>Status: <b>{step.status}</b></p>
      {step.startedAt ? <p className='text-xs'>Started: {new Date(step.startedAt).toLocaleTimeString()}</p> : null}
      {step.finishedAt ? <p className='text-xs'>Finished: {new Date(step.finishedAt).toLocaleTimeString()}</p> : null}
      {step.error ? (
        <pre className='whitespace-pre-wrap rounded-md bg-red-500/10 p-2 text-[11px] text-red-200'>{step.error}</pre>
      ) : null}
      {step.output != null ? (
        <pre className='whitespace-pre-wrap rounded-md bg-white/[0.04] p-2 text-[11px] text-zinc-200'>{JSON.stringify(step.output, null, 2)}</pre>
      ) : null}
    </div>
  )
}
