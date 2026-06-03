import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  GlobeIcon, PaperclipIcon, SendIcon, BrainIcon, SquareIcon, Loader2Icon,
} from 'lucide-react'

import type { AgentAvailability, ConversationSummary, MessageSummary, ProfileSummary } from '@anubis/shared'

import {
  cancelConversation,
  getConversation,
  listProfiles,
  sendMessage as apiSendMessage,
  updateConversation,
  type ReasoningEffort,
} from '@/api'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'
import { MdxContent } from '@/components/mdx'
import {
  useConversationMessages,
  type Fragment as LiveFragment,
  type ToolEvent,
} from '@/lib/conversation-stream'
import { useCatalog } from '@/lib/use-catalog'
import { useDefaultProfile } from '@/lib/use-default-profile'
import { useEnsureConversation } from '@/lib/use-ensure-conversation'
import { ProfilePicker } from '@/components/composer/profile-picker'
import { ReasoningPicker } from '@/components/composer/reasoning-picker'

function useProfiles(): ProfileSummary[] {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  useEffect(() => {
    let cancelled = false
    listProfiles()
      .then((items) => { if (!cancelled) setProfiles(items) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return profiles
}

export function ActiveConversationPage({ conversationId }: { conversationId?: string }) {
  const { navigate } = useNavigation()
  const profiles = useProfiles()
  const { catalog } = useCatalog()
  const { messages, streaming, error: streamError, chunks, partialChars } =
    useConversationMessages(conversationId)

  const [conv, setConv] = useState<ConversationSummary | null>(null)
  const [defaultProfile, setDefaultProfile] = useDefaultProfile(profiles)
  const [pickedProfile, setPickedProfile] = useState<ProfileSummary | null>(null)
  const [pickedEffort, setPickedEffort] = useState<ReasoningEffort | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [forceStopped, setForceStopped] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!conversationId) { setConv(null); return }
    let cancelled = false
    getConversation(conversationId)
      .then((c) => { if (!cancelled) setConv(c) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [conversationId])

  const convProfile = useMemo(
    () => profiles.find((p) => p.id === conv?.profileId) ?? null,
    [profiles, conv?.profileId],
  )
  const selectedProfile: ProfileSummary | null =
    pickedProfile ?? convProfile ?? defaultProfile

  const profileDefaultEffort: ReasoningEffort =
    (selectedProfile?.config.reasoningEffort as ReasoningEffort | undefined)
    ?? catalog?.defaultReasoningEffort ?? 'medium'

  const convOverrideEffort =
    conv?.extra.overrides?.reasoningEffort as ReasoningEffort | undefined

  const effectiveEffort: ReasoningEffort =
    pickedEffort ?? convOverrideEffort ?? profileDefaultEffort
  const effortIsOverride = effectiveEffort !== profileDefaultEffort

  useEffect(() => {
    if (!streaming) { setElapsed(0); return }
    const start = streaming.startedAt
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 250)
    return () => clearInterval(tick)
  }, [streaming])

  // Reset forceStopped whenever the SSE flag flips back to false on its own.
  useEffect(() => {
    if (!streaming) setForceStopped(false)
  }, [streaming])

  const tokens = Math.round(partialChars / 4)
  const isLive = !!streaming && !forceStopped

  const { ensure } = useEnsureConversation(
    conversationId, selectedProfile, effectiveEffort, profileDefaultEffort,
  )

  const onProfileChange = useCallback(async (next: ProfileSummary) => {
    setPickedProfile(next)
    setDefaultProfile(next)
    setSendError(null)
    if (!conversationId) return
    try {
      const updated = await updateConversation(conversationId, { profileId: next.id })
      setConv(updated)
    } catch (e) {
      setPickedProfile(null)
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, setDefaultProfile])

  const onEffortChange = useCallback(async (next: ReasoningEffort) => {
    setPickedEffort(next)
    setSendError(null)
    if (!conversationId) return
    const patch = next === profileDefaultEffort ? {} : { reasoningEffort: next }
    try {
      const updated = await updateConversation(conversationId, { override: patch })
      setConv(updated)
    } catch (e) {
      setPickedEffort(null)
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, profileDefaultEffort])

  const onStop = useCallback(async () => {
    if (!conversationId || stopping) return
    setStopping(true)
    setSendError(null)
    try {
      await cancelConversation(conversationId)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
    // Safety fallback: if the SSE `done` event doesn't arrive within 3s, treat
    // the run as stopped locally so the user isn't stuck staring at "Stop".
    // The SSE hook keeps running, so transcripts remain correct.
    setTimeout(() => setForceStopped(true), 3000)
  }, [conversationId, stopping])

  const onSend = useCallback(async (content: string) => {
    setSendError(null)
    try {
      const id = await ensure(content)
      await apiSendMessage(id, content)
      if (id !== conversationId) navigate({ page: 'active-conversation', conversationId: id })
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [ensure, conversationId, navigate])

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
      <div className='flex flex-shrink-0 items-start justify-between gap-5 border-b border-border px-7 pb-4 pt-[18px]'>
        <div>
          <h1 className='m-0 text-[25px] font-semibold leading-[1.15] tracking-[-0.022em]'>
            {conv?.title ?? (conversationId ? 'Active conversation' : 'New conversation')}
          </h1>
          {conversationId && (
            <div className='mt-2.5 flex flex-wrap items-center gap-3'>
              <span className='font-mono text-[12px] text-muted-foreground/65'>
                session: {conversationId.slice(0, 13)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-7 pb-[30px] pt-[34px]'>
        <div className='mx-auto flex max-w-[720px] flex-col gap-6'>
          {messages.map((m) => (
            <RenderedMessage key={m.id} message={m} conversationId={conversationId ?? ''} />
          ))}
          {streaming && (
            <StreamingMessage live={streaming} conversationId={conversationId ?? ''} />
          )}
          {(streamError ?? sendError) && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 font-mono text-[12px] text-destructive'>
              {streamError ?? sendError}
            </div>
          )}
        </div>
      </div>

      <Composer
        onSend={onSend}
        onStop={onStop}
        streaming={isLive}
        stopping={stopping}
        profile={selectedProfile}
        profiles={profiles}
        onProfileChange={(p) => void onProfileChange(p)}
        effort={effectiveEffort}
        effortIsOverride={effortIsOverride}
        efforts={catalog?.reasoningEfforts ?? (['minimal', 'low', 'medium', 'high'] as const)}
        onEffortChange={(e) => void onEffortChange(e)}
        availability={catalog?.agentAvailability}
      />

      <div className='flex flex-shrink-0 items-center justify-center gap-2 px-7 pb-3 pt-[7px] font-mono text-[11px] text-muted-foreground'>
        {isLive ? (
          <>
            <span className='inline-block size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
            <span>
              Streaming · <span>{chunks}</span> chunks · <span>{(tokens / 1000).toFixed(1)}k</span> tokens · <span>{elapsed}</span>s elapsed
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
}: {
  live: { fragments: LiveFragment[]; toolEvents: Record<string, ToolEvent> }
  conversationId: string
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
          <ToolCardRunning key={i} ev={ev} />
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

function ToolCardRunning({ ev }: { ev: ToolEvent & { kind: 'call' } }) {
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
            running…
          </span>
        </div>
        <span className='size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
      </div>
      <div className='absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)]'>
        <div className='h-full w-[32%] animate-[anubisIndeterminate_1.7s_cubic-bezier(0.5,0.1,0.5,0.9)_infinite] rounded-sm bg-[var(--anubis-gold)]' />
      </div>
    </div>
  )
}

function Composer({
  onSend,
  onStop,
  streaming,
  stopping,
  profile,
  profiles,
  onProfileChange,
  effort,
  effortIsOverride,
  efforts,
  onEffortChange,
  availability,
}: {
  onSend: (content: string) => void
  onStop: () => void
  streaming: boolean
  stopping: boolean
  profile: ProfileSummary | null
  profiles: ProfileSummary[]
  onProfileChange: (next: ProfileSummary) => void
  effort: ReasoningEffort
  effortIsOverride: boolean
  efforts: readonly ReasoningEffort[]
  onEffortChange: (next: ReasoningEffort) => void
  availability?: Record<'claude' | 'codex', AgentAvailability>
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
    if (streaming) { onStop(); return }
    if (!value.trim()) return
    onSend(value)
    setValue('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  const agent = profile?.config.agent as 'claude' | 'codex' | undefined
  const agentUnavailable =
    availability && agent ? !availability[agent].available : false
  const installHint =
    agentUnavailable && agent
      ? `\`${agent}\` not found on PATH. Install ${agent === 'claude' ? 'Claude Code' : 'Codex CLI'} first.`
      : null

  const sendDisabled = !streaming && (!value.trim() || agentUnavailable)

  return (
    <>
      {installHint && (
        <div className='mx-7 mt-2 rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_28%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] px-3.5 py-2 font-mono text-[12px] text-foreground'>
          {installHint}
        </div>
      )}
    <form
      onSubmit={submit}
      className='flex-shrink-0 border-t border-border px-7 pb-2.5 pt-3.5'
    >
      <div className='mx-auto flex max-w-[768px] items-center gap-2.5 rounded-[13px] border border-border bg-card py-[7px] pl-2.5 pr-2 focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'>
        <button
          type='button'
          aria-label='Attach'
          disabled={streaming}
          className='flex size-[30px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
        >
          <PaperclipIcon className='size-[17px]' strokeWidth={2} />
        </button>

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => { setValue(e.target.value); autoGrow() }}
          rows={1}
          placeholder='Reply to Anubis…'
          disabled={streaming}
          className='max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60'
        />

        <ProfilePicker
          profiles={profiles}
          value={profile}
          onChange={onProfileChange}
          disabled={streaming}
          availability={availability}
        />
        <ReasoningPicker
          efforts={efforts}
          value={effort}
          isOverride={effortIsOverride}
          onChange={onEffortChange}
          disabled={streaming}
        />

        {streaming ? (
          <button
            type='submit'
            disabled={stopping}
            className='inline-flex h-[34px] items-center gap-1.5 rounded-md bg-destructive/15 px-4 text-[14px] font-semibold tracking-[-0.01em] text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50'
          >
            {stopping ? (
              <Loader2Icon className='size-[14px] animate-spin' strokeWidth={2} />
            ) : (
              <SquareIcon className='size-[14px]' strokeWidth={2.4} fill='currentColor' />
            )}
            Stop
          </button>
        ) : (
          <button
            type='submit'
            disabled={sendDisabled}
            title={agentUnavailable && agent ? `${agent} not found on PATH` : undefined}
            className={cn(
              'inline-flex h-[34px] items-center gap-1.5 rounded-md px-4 text-[14px] font-semibold tracking-[-0.01em] transition-colors',
              sendDisabled
                ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-[0.42]'
                : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
            )}
          >
            <SendIcon className='size-[14px]' strokeWidth={2} />
            Send
          </button>
        )}
      </div>
    </form>
    </>
  )
}
