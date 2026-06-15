import type { DraftOutput, GenerationTask } from '@anubis/shared'
import { Section } from './sections'

const STATUS_TONE: Record<GenerationTask['status'], string> = {
  pending: 'text-muted-foreground',
  running: 'text-[var(--anubis-gold)]',
  completed: 'text-[var(--anubis-success)]',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground line-through',
  manual: 'text-[#9db8d2]',
}

export function GenerationQueueSection({
  tasks, busy, onStart, onRetry, onCancel, onOpenConversation,
}: {
  tasks: GenerationTask[]
  busy: boolean
  onStart: () => void
  onRetry: (taskId: string) => void
  onCancel: (taskId: string) => void
  onOpenConversation: (conversationId: string) => void
}) {
  return (
    <Section
      id='section-generation'
      title='Generation Queue'
      right={<button type='button' disabled={busy} onClick={onStart} className='inline-flex h-8 items-center rounded-md bg-[var(--anubis-gold)] px-3 text-[12px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'>Start generation</button>}
    >
      {tasks.length === 0 ? (
        <p className='text-muted-foreground'>No tasks yet. Approve human review to enqueue.</p>
      ) : (
        <ul className='space-y-2'>
          {tasks.map((t) => (
            <li key={t.id} className='rounded border border-border bg-background p-2'>
              <div className='flex items-center justify-between'>
                <span className='text-[12.5px] font-medium'>{t.type} <span className='text-[11px] text-muted-foreground'>· {t.capability}{t.generator ? ` · ${t.generator}` : ''}</span></span>
                <span className={`text-[11px] font-medium ${STATUS_TONE[t.status]}`}>{t.status}{t.retryCount ? ` (retry ${t.retryCount})` : ''}</span>
              </div>
              <p className='mt-1 line-clamp-2 text-[11.5px] text-muted-foreground'>{t.inputPrompt}</p>
              {t.error ? <p className='mt-1 text-[11.5px] text-destructive'>{t.error}</p> : null}
              {t.output?.assetPaths?.length ? <p className='mt-1 text-[11px] text-muted-foreground'>{t.output.assetPaths.length} asset(s)</p> : null}
              {t.output?.text ? <p className='mt-1 text-[11.5px] text-foreground/80'>{t.output.text}</p> : null}
              <div className='mt-1.5 flex gap-2'>
                {t.status === 'failed' || t.status === 'cancelled' ? (
                  <button type='button' disabled={busy} onClick={() => onRetry(t.id)} className='text-[11px] text-[var(--anubis-gold)] hover:underline disabled:opacity-50'>Retry</button>
                ) : null}
                {t.status === 'pending' || t.status === 'running' ? (
                  <button type='button' disabled={busy} onClick={() => onCancel(t.id)} className='text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50'>Cancel</button>
                ) : null}
                {t.conversationId ? (
                  <button type='button' onClick={() => onOpenConversation(t.conversationId!)} className='text-[11px] text-muted-foreground hover:underline'>View generation log</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function DraftOutputSection({ draft }: { draft: DraftOutput | null }) {
  if (!draft) return <Section title='Draft Output'><p className='text-muted-foreground'>No draft yet. Run generation to assemble it.</p></Section>
  return (
    <Section title='Draft Output'>
      <p className='text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>Final caption</p>
      <p className='mt-0.5 whitespace-pre-wrap'>{draft.finalCaption}</p>
      <p className='mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>Final hashtags</p>
      <p className='mt-0.5 text-muted-foreground'>{draft.finalHashtags.join(' ')}</p>
      {draft.assets.length ? (
        <div className='mt-2'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>Assets</p>
          <ul className='mt-1 space-y-0.5'>
            {draft.assets.flatMap((a) => a.paths).map((p, i) => <li key={i} className='truncate font-mono text-[11px] text-muted-foreground'>{p}</li>)}
          </ul>
        </div>
      ) : null}
      <p className='mt-2 text-[11px] text-muted-foreground'>Stitched from {draft.generationMeta.length} task(s).</p>
    </Section>
  )
}
