import { useEditorStore } from './editor-store'

const TONE: Record<string, { dot: string; text: string; bg: string; border: string; label: string }> = {
  running:   { dot: 'bg-[#fd551d] animate-pulse',          text: 'text-[#fd551d]', bg: 'bg-[#fd551d]/10', border: 'border-[#fd551d]/30', label: 'Running' },
  succeeded: { dot: 'bg-[#22c55e]',                         text: 'text-[#22c55e]', bg: 'bg-[#22c55e]/10', border: 'border-[#22c55e]/30', label: 'Succeeded' },
  failed:    { dot: 'bg-[#ef4444]',                         text: 'text-[#ef4444]', bg: 'bg-[#ef4444]/10', border: 'border-[#ef4444]/30', label: 'Failed' },
  cancelled: { dot: 'bg-[#f59e0b]',                         text: 'text-[#f59e0b]', bg: 'bg-[#f59e0b]/10', border: 'border-[#f59e0b]/30', label: 'Cancelled' },
}

export function RunStatusBanner() {
  const run = useEditorStore((s) => s.activeRun)
  const dismiss = useEditorStore((s) => s.setActiveRun)
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

  return (
    <div className={`mx-6 my-2 flex items-center gap-3 rounded-lg border ${tone.border} ${tone.bg} px-3 py-2`}>
      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
      <p className={`text-xs font-semibold ${tone.text}`}>Run {tone.label}</p>
      {detail ? <p className='flex-1 truncate text-xs text-zinc-300'>{detail}</p> : null}
      {(run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') ? (
        <button
          type='button'
          onClick={() => dismiss(null)}
          className='text-[10px] uppercase tracking-wider text-muted-foreground hover:text-white'
        >
          Dismiss
        </button>
      ) : null}
    </div>
  )
}
