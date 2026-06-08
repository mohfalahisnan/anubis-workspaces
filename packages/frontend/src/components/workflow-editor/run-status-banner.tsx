import { useState } from 'react'
import { useEditorStore } from './editor-store'
import { workflowsApi } from '@/api/workflows'

const TONE: Record<string, { dot: string; text: string; bg: string; border: string; label: string }> = {
  running:   { dot: 'bg-primary animate-pulse',  text: 'text-primary',         bg: 'bg-primary/10',         border: 'border-primary/30',         label: 'Running' },
  succeeded: { dot: 'bg-anubis-success',         text: 'text-anubis-success',  bg: 'bg-anubis-success/10',  border: 'border-anubis-success/30',  label: 'Succeeded' },
  failed:    { dot: 'bg-destructive',            text: 'text-destructive',     bg: 'bg-destructive/10',     border: 'border-destructive/30',     label: 'Failed' },
  cancelled: { dot: 'bg-[#d99412]',              text: 'text-[#d99412]',       bg: 'bg-[#f59e0b]/10',       border: 'border-[#f59e0b]/30',       label: 'Cancelled' },
}

export function RunStatusBanner() {
  const run = useEditorStore((s) => s.activeRun)
  const dismiss = useEditorStore((s) => s.setActiveRun)
  const [isStopping, setIsStopping] = useState(false)

  if (!run) return null
  const tone = TONE[run.status] ?? TONE.running!

  const stepCount = Object.keys(run.steps).length
  const failedSteps = Object.entries(run.steps).filter(([, s]) => s.status === 'failed')

  // If the run failed at the run level (no individual node failed) — show the run error.
  // If a node failed — show "node X failed: message".
  let detail: string | null = null
  if (run.status === 'failed') {
    if (failedSteps.length > 0) {
      const [nodeId, step] = failedSteps[0]!
      detail = `Node "${nodeId}" failed: ${step.error ?? '(no error message)'}`
    } else if (run.error) {
      detail = run.error
    } else {
      detail = '(no error message returned by the runner)'
    }
  } else if (run.status === 'running') {
    const running = Object.values(run.steps).filter((s) => s.status === 'running').length
    const done = Object.values(run.steps).filter((s) => s.status === 'succeeded').length
    detail = `${done} succeeded · ${running} running · ${stepCount} total`
  }

  async function handleStop() {
    if (!run?.runId) return
    setIsStopping(true)
    try {
      await workflowsApi.cancelRun(run.runId)
    } catch (err) {
      console.error('Failed to stop run:', err)
    } finally {
      setIsStopping(false)
    }
  }

  return (
    <div className={`mx-6 my-2 flex items-center gap-3 rounded-lg border ${tone.border} ${tone.bg} px-3 py-2`}>
      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
      <p className={`text-xs font-semibold ${tone.text}`}>Run {tone.label}</p>
      {detail ? <p className='flex-1 truncate text-xs text-muted-foreground'>{detail}</p> : null}
      {run.status === 'running' && (
        <button
          type='button'
          disabled={isStopping}
          onClick={handleStop}
          className='text-[10px] uppercase tracking-wider text-destructive hover:underline font-semibold disabled:opacity-50'
        >
          {isStopping ? 'Stopping...' : 'Stop'}
        </button>
      )}
      {(run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') ? (
        <button
          type='button'
          onClick={() => dismiss(null)}
          className='text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground'
        >
          Dismiss
        </button>
      ) : null}
    </div>
  )
}
