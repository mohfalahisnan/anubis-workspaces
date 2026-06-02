import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ChevronDownIcon,
  GlobeIcon,
  PaperclipIcon,
  SendIcon,
  BrainIcon,
} from 'lucide-react'

import type { MessageSummary } from '@anubis/shared'

import { listMessages } from '@/api'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'

/* -----------------------------------------------------------
   The active conversation view. When a real conversationId is
   provided via the route, we pull messages from the backend;
   otherwise we render the brand-faithful mock transcript that
   matches `mockup/Anubis - Active Conversation.html`.
   ----------------------------------------------------------- */

interface ToolCardData {
  tool: string
  summary: string
  state: 'success' | 'running'
  collapsed?: boolean
}

export function ActiveConversationPage({ conversationId }: { conversationId?: string }) {
  const { navigate } = useNavigation()
  const [messages, setMessages] = useState<MessageSummary[] | null>(null)
  const [, setError] = useState<string | null>(null)

  // Live counters for the status bar (mock-driven so the UI feels alive
  // even without a real running agent; replace with SSE events once wired).
  const [chunks, setChunks] = useState(142)
  const [tokens, setTokens] = useState(3400)
  const [elapsed, setElapsed] = useState(12)
  const [cancelled, setCancelled] = useState(false)

  // Streaming caption simulator for the running tool card
  const [capIdx, setCapIdx] = useState(25)
  const [capHook, setCapHook] = useState<'question' | 'confession' | 'curiosity' | 'claim' | 'listicle'>('question')
  const [capConf, setCapConf] = useState('0.82')

  useEffect(() => {
    if (!conversationId) return
    let active = true
    listMessages(conversationId)
      .then((items) => active && setMessages(items))
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      active = false
    }
  }, [conversationId])

  useEffect(() => {
    if (cancelled) return
    const tick = setInterval(() => {
      setChunks((c) => c + 1 + Math.floor(Math.random() * 2))
      setTokens((t) => t + 18 + Math.floor(Math.random() * 36))
    }, 280)
    const second = setInterval(() => setElapsed((e) => e + 1), 1000)
    const cap = setInterval(() => {
      setCapIdx((i) => (i >= 30 ? 25 : i + 1))
      const hooks: (typeof capHook)[] = ['question', 'confession', 'curiosity', 'claim', 'listicle']
      setCapHook(hooks[Math.floor(Math.random() * hooks.length)]!)
      setCapConf((0.6 + Math.random() * 0.39).toFixed(2))
    }, 900)
    return () => {
      clearInterval(tick)
      clearInterval(second)
      clearInterval(cap)
    }
  }, [cancelled])

  const live = !cancelled && (messages?.length ?? 0) === 0
  const hasRealMessages = messages !== null && messages.length > 0

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
      {/* Conversation header */}
      <div className='flex flex-shrink-0 items-start justify-between gap-5 border-b border-border px-7 pb-4 pt-[18px]'>
        <div>
          <h1 className='m-0 text-[25px] font-semibold leading-[1.15] tracking-[-0.022em]'>
            Audit @kayla.studio's last 30 posts
          </h1>
          <div className='mt-2.5 flex flex-wrap items-center gap-3'>
            <span className='inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-card px-2.5 pl-2.5 font-mono text-[12px] text-foreground'>
              <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
              Claude · Coding (plan)
            </span>
            <span className='font-mono text-[12px] text-muted-foreground/65'>
              session: a4f9-c2e1-7b3d
            </span>
          </div>
        </div>
        <button
          type='button'
          onClick={() => setCancelled(true)}
          disabled={cancelled}
          className={cn(
            'inline-flex h-[34px] items-center gap-[7px] rounded-md px-3.5 text-[14px] font-medium transition-colors',
            cancelled
              ? 'text-muted-foreground opacity-50'
              : 'text-muted-foreground hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive',
          )}
        >
          {cancelled ? 'Cancelled' : 'Cancel'}
        </button>
      </div>

      {/* Transcript */}
      <div className='flex-1 overflow-y-auto px-7 pb-[30px] pt-[34px]'>
        <div className='mx-auto flex max-w-[720px] flex-col gap-6'>
          {hasRealMessages ? (
            <RealMessages messages={messages!} />
          ) : (
            <MockTranscript
              cancelled={cancelled}
              capIdx={capIdx}
              capHook={capHook}
              capConf={capConf}
            />
          )}
        </div>
      </div>

      {/* Composer */}
      <Composer
        onSend={(content) => {
          if (!conversationId) {
            navigate({ page: 'conversations' })
            return
          }
          // sendMessage(conversationId, content) — wire when the SSE relay UI lands
          console.info('[anubis] send queued (not yet wired):', content)
        }}
        disabled={live && !cancelled}
      />

      {/* Status bar */}
      <div className='flex flex-shrink-0 items-center justify-center gap-2 px-7 pb-3 pt-[7px] font-mono text-[11px] text-muted-foreground'>
        {cancelled ? (
          <span>Cancelled · {elapsed}s elapsed</span>
        ) : (
          <>
            <span className='inline-block size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
            <span>
              Streaming · <span>{chunks}</span> chunks · <span>{(tokens / 1000).toFixed(1)}k</span>{' '}
              tokens · <span>{elapsed}</span>s elapsed
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Composer ---------- */

function Composer({
  onSend,
  disabled,
}: {
  onSend: (content: string) => void
  disabled: boolean
}) {
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

/* ---------- Real backend messages ---------- */

function RealMessages({ messages }: { messages: MessageSummary[] }) {
  return (
    <>
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className='flex justify-end'>
              <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground'>
                {m.content}
              </div>
            </div>
          )
        }
        if (m.role === 'system') {
          return (
            <div
              key={m.id}
              className='rounded-md border border-border bg-muted px-3.5 py-2.5 font-mono text-[12px] text-muted-foreground'
            >
              {m.content}
            </div>
          )
        }
        return (
          <div key={m.id} className='flex flex-col gap-4'>
            <div className='flex items-center gap-2'>
              <AnubisMark size={15} />
              <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
                Anubis
              </span>
            </div>
            <p className='m-0 whitespace-pre-wrap text-[15.5px] leading-[1.68] tracking-[-0.003em] text-foreground'>
              {m.content}
            </p>
          </div>
        )
      })}
    </>
  )
}

/* ---------- Mock transcript (matches the mockup verbatim) ---------- */

function MockTranscript({
  cancelled,
  capIdx,
  capHook,
  capConf,
}: {
  cancelled: boolean
  capIdx: number
  capHook: string
  capConf: string
}) {
  return (
    <>
      {/* Turn 1 — user */}
      <div className='flex justify-end'>
        <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground'>
          Walk me through the 30 most recent posts from @kayla.studio and group them by hook archetype.
        </div>
      </div>

      {/* Turn 2 — assistant streaming */}
      <div className='flex flex-col gap-4'>
        <div className='-mb-1 flex items-center gap-2'>
          <AnubisMark size={15} />
          <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
            Anubis
          </span>
        </div>

        <p className='m-0 text-[15.5px] leading-[1.68] tracking-[-0.003em] text-foreground'>
          I'll start by pulling the profile's recent posts via the research-crawler tool, then cluster them by the opening hook so we can see which archetypes @kayla.studio leans on most.
        </p>

        <ToolCardSuccess
          icon={<GlobeIcon className='size-[15px]' strokeWidth={2} />}
          label='research-crawler · capture-instagram-profile'
          summary='fetched 30 posts · avgLikes 4,210'
        />

        <p className='m-0 text-[15.5px] leading-[1.68] tracking-[-0.003em] text-foreground'>
          Thirty posts came back cleanly — a healthy mix of Reels and carousels, averaging 4,210 likes. Now I'm scoring each caption's first line against the hook taxonomy (curiosity gap, bold claim, relatable confession, listicle, question) to find the dominant patterns.
        </p>

        <ToolCardRunning
          icon={<BrainIcon className='size-[15px]' strokeWidth={2} />}
          label='analyze · cluster-by-hook'
          summary='scoring hook patterns…'
          capIdx={capIdx}
          capHook={capHook}
          capConf={capConf}
          cancelled={cancelled}
        />

        <p className='m-0 text-[15.5px] leading-[1.68] tracking-[-0.003em] text-foreground'>
          Early signal: her strongest performers open with a{' '}
          <em className='not-italic text-[var(--anubis-gold)]'>relatable confession</em>, while
          curiosity-gap hooks drive the most saves. I'm still clustering the remaining posts and
          will have the full archetype breakdown with example captions in just a
          {!cancelled && <span className='ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-[anubisBlink_1.05s_steps(1)_infinite] bg-[var(--anubis-gold)]' />}
        </p>
      </div>
    </>
  )
}

/* ---------- Tool cards ---------- */

function ToolCardSuccess({
  icon,
  label,
  summary,
}: {
  icon: React.ReactNode
  label: string
  summary: string
}) {
  const [collapsed, setCollapsed] = useState(true)
  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card p-3'>
      <button
        type='button'
        onClick={() => setCollapsed((c) => !c)}
        className='flex w-full items-center gap-2.5 text-left'
      >
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          {icon}
        </span>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {label}
          </span>
          <span className='mt-1 truncate font-mono text-[11.5px] text-muted-foreground'>
            {summary}
          </span>
        </span>
        <span className='flex shrink-0 items-center gap-2.5 text-muted-foreground'>
          <span className='size-[7px] rounded-full bg-[var(--anubis-success)]' />
          <ChevronDownIcon
            className={cn('size-[15px] transition-transform', collapsed && '-rotate-90')}
            strokeWidth={2}
          />
        </span>
      </button>
    </div>
  )
}

function ToolCardRunning({
  icon,
  label,
  summary,
  capIdx,
  capHook,
  capConf,
  cancelled,
}: {
  icon: React.ReactNode
  label: string
  summary: string
  capIdx: number
  capHook: string
  capConf: string
  cancelled: boolean
}) {
  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card p-3'>
      <div className='flex items-center gap-2.5'>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          {icon}
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {label}
          </span>
          <span className='mt-1 truncate font-mono text-[11.5px] text-muted-foreground'>
            {cancelled ? 'cancelled' : summary}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-2.5 text-muted-foreground'>
          <span
            className={cn(
              'size-[7px] rounded-full',
              cancelled
                ? 'bg-[var(--anubis-success)]'
                : 'bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]',
            )}
          />
          <ChevronDownIcon className='size-[15px]' strokeWidth={2} />
        </div>
      </div>

      <div className='mt-2.5 rounded-md border border-border bg-background px-3 py-2 font-mono text-[11.5px] leading-[1.7] text-muted-foreground'>
        <div className='truncate'>
          <span className='text-[var(--anubis-gold)]'>›</span> matched{' '}
          <span className='text-[var(--anubis-success)]'>24</span>/30 · confession=7 curiosity=6
          question=5 claim=4
        </div>
        <div className='truncate'>
          <span className='text-[var(--anubis-gold)]'>›</span> scoring caption[
          <span>{capIdx}</span>] hook=<span>{capHook}</span> conf=<span>{capConf}</span>
          {!cancelled && (
            <span className='ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-[anubisBlink_1.05s_steps(1)_infinite] bg-[var(--anubis-gold)]' />
          )}
        </div>
      </div>

      {!cancelled && (
        <div className='absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)]'>
          <div className='h-full w-[32%] animate-[anubisIndeterminate_1.7s_cubic-bezier(0.5,0.1,0.5,0.9)_infinite] rounded-sm bg-[var(--anubis-gold)]' />
        </div>
      )}
    </div>
  )
}
