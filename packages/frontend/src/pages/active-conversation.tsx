import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDownIcon, GlobeIcon, PaperclipIcon, SendIcon, BrainIcon } from 'lucide-react'

import type { MessageSummary } from '@anubis/shared'

import { sendMessage as apiSendMessage } from '@/api'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'
import { MdxContent } from '@/components/mdx'
import {
  useConversationMessages,
  type Fragment as LiveFragment,
  type ToolEvent,
} from '@/lib/conversation-stream'

export function ActiveConversationPage({ conversationId }: { conversationId?: string }) {
  const { navigate } = useNavigation()
  const { messages, streaming, error, chunks, partialChars } =
    useConversationMessages(conversationId)
  const [elapsed, setElapsed] = useState(0)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    if (!streaming || cancelled) return
    setElapsed(0)
    const start = streaming.startedAt
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 250)
    return () => clearInterval(tick)
  }, [streaming, cancelled])

  const tokens = Math.round(partialChars / 4)
  const isLive = !!streaming && !cancelled

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
      <div className='flex flex-shrink-0 items-start justify-between gap-5 border-b border-border px-7 pb-4 pt-[18px]'>
        <div>
          <h1 className='m-0 text-[25px] font-semibold leading-[1.15] tracking-[-0.022em]'>
            {conversationId ? 'Active conversation' : 'New conversation'}
          </h1>
          <div className='mt-2.5 flex flex-wrap items-center gap-3'>
            <span className='inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-card px-2.5 pl-2.5 font-mono text-[12px] text-foreground'>
              <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
              Claude · Coding (plan)
            </span>
            {conversationId && (
              <span className='font-mono text-[12px] text-muted-foreground/65'>
                session: {conversationId.slice(0, 13)}
              </span>
            )}
          </div>
        </div>
        <button
          type='button'
          onClick={() => setCancelled(true)}
          disabled={cancelled || !isLive}
          className={cn(
            'inline-flex h-[34px] items-center gap-[7px] rounded-md px-3.5 text-[14px] font-medium transition-colors',
            cancelled || !isLive
              ? 'text-muted-foreground opacity-50'
              : 'text-muted-foreground hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive',
          )}
        >
          {cancelled ? 'Cancelled' : 'Cancel'}
        </button>
      </div>

      <div className='flex-1 overflow-y-auto px-7 pb-[30px] pt-[34px]'>
        <div className='mx-auto flex max-w-[720px] flex-col gap-6'>
          {messages.map((m) => (
            <RenderedMessage key={m.id} message={m} conversationId={conversationId ?? ''} />
          ))}
          {streaming && (
            <StreamingMessage
              live={streaming}
              conversationId={conversationId ?? ''}
              cancelled={cancelled}
            />
          )}
          {error && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 font-mono text-[12px] text-destructive'>
              {error}
            </div>
          )}
        </div>
      </div>

      <Composer
        onSend={(content) => {
          if (!conversationId) {
            navigate({ page: 'conversations' })
            return
          }
          void apiSendMessage(conversationId, content)
        }}
        disabled={isLive}
      />

      <div className='flex flex-shrink-0 items-center justify-center gap-2 px-7 pb-3 pt-[7px] font-mono text-[11px] text-muted-foreground'>
        {cancelled ? (
          <span>Cancelled · {elapsed}s elapsed</span>
        ) : isLive ? (
          <>
            <span className='inline-block size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
            <span>
              Streaming · <span>{chunks}</span> chunks · <span>{(tokens / 1000).toFixed(1)}k</span>{' '}
              tokens · <span>{elapsed}</span>s elapsed
            </span>
          </>
        ) : (
          <span>Idle</span>
        )}
      </div>
    </div>
  )
}

function RenderedMessage({
  message,
  conversationId,
}: {
  message: MessageSummary
  conversationId: string
}) {
  if (message.role === 'user') {
    return (
      <div className='flex justify-end'>
        <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground'>
          {message.content}
        </div>
      </div>
    )
  }
  if (message.role === 'system') {
    return (
      <div className='rounded-md border border-border bg-muted px-3.5 py-2.5 font-mono text-[12px] text-muted-foreground'>
        {message.content}
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <AnubisMark size={15} />
        <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
          Anubis
        </span>
      </div>
      <MdxContent source={message.content} conversationId={conversationId} />
    </div>
  )
}

function StreamingMessage({
  live,
  conversationId,
  cancelled,
}: {
  live: { fragments: LiveFragment[]; toolEvents: Record<string, ToolEvent> }
  conversationId: string
  cancelled: boolean
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <AnubisMark size={15} />
        <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
          Anubis
        </span>
      </div>
      {live.fragments.map((frag, i) => {
        if (frag.kind === 'text') {
          return <MdxContent key={i} source={frag.text} conversationId={conversationId} />
        }
        const ev = live.toolEvents[frag.callId]
        if (!ev) return null
        return ev.kind === 'call' ? (
          <ToolCardRunning key={i} ev={ev} cancelled={cancelled} />
        ) : (
          <ToolCardSuccess key={i} ev={ev} />
        )
      })}
    </div>
  )
}

function ToolCardSuccess({ ev }: { ev: ToolEvent & { kind: 'result' } }) {
  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card p-3'>
      <div className='flex items-center gap-2.5'>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          <GlobeIcon className='size-[15px]' strokeWidth={2} />
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {ev.name}
          </span>
          <span className='mt-1 truncate font-mono text-[11.5px] text-muted-foreground'>
            completed
          </span>
        </div>
        <span className='size-[7px] rounded-full bg-[var(--anubis-success)]' />
      </div>
    </div>
  )
}

function ToolCardRunning({
  ev,
  cancelled,
}: {
  ev: ToolEvent & { kind: 'call' }
  cancelled: boolean
}) {
  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card p-3'>
      <div className='flex items-center gap-2.5'>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          <BrainIcon className='size-[15px]' strokeWidth={2} />
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {ev.name}
          </span>
          <span className='mt-1 truncate font-mono text-[11.5px] text-muted-foreground'>
            {cancelled ? 'cancelled' : 'running…'}
          </span>
        </div>
        <span
          className={cn(
            'size-[7px] rounded-full',
            cancelled
              ? 'bg-muted-foreground'
              : 'bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]',
          )}
        />
      </div>
      {!cancelled && (
        <div className='absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)]'>
          <div className='h-full w-[32%] animate-[anubisIndeterminate_1.7s_cubic-bezier(0.5,0.1,0.5,0.9)_infinite] rounded-sm bg-[var(--anubis-gold)]' />
        </div>
      )}
    </div>
  )
}

function Composer({ onSend, disabled }: { onSend: (content: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  function autoGrow() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    onSend(value)
    setValue('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  return (
    <form
      onSubmit={submit}
      className='flex-shrink-0 border-t border-border px-7 pb-2.5 pt-3.5'
    >
      <div className='mx-auto flex max-w-[768px] items-center gap-2.5 rounded-[13px] border border-border bg-card py-[7px] pl-2.5 pr-2 focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'>
        <button
          type='button'
          aria-label='Attach'
          className='flex size-[30px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PaperclipIcon className='size-[17px]' strokeWidth={2} />
        </button>

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoGrow()
          }}
          rows={1}
          placeholder='Reply to Anubis…'
          className='max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground'
        />

        <button
          type='button'
          aria-label='Switch profile'
          className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 pl-2.5 font-mono text-[12px] text-foreground'
        >
          <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
          Claude · Coding
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>

        <button
          type='submit'
          disabled={disabled || !value.trim()}
          className={cn(
            'inline-flex h-[34px] items-center gap-1.5 rounded-md px-4 text-[14px] font-semibold tracking-[-0.01em] transition-colors',
            disabled || !value.trim()
              ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-[0.42]'
              : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
          )}
          title={disabled ? 'Send is disabled while a run is in progress' : undefined}
        >
          <SendIcon className='size-[14px]' strokeWidth={2} />
          Send
        </button>
      </div>
    </form>
  )
}
