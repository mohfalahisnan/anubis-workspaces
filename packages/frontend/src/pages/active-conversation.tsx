import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  GlobeIcon, PaperclipIcon, SendIcon, BrainIcon, SquareIcon, Loader2Icon, ChevronDownIcon, QuoteIcon, XIcon,
  FolderIcon, FolderOpenIcon, PencilIcon,
} from 'lucide-react'

import type { AgentAvailability, ConversationSummary, MessageSummary, ProfileSummary } from '@anubis/shared'

import {
  NoCredentialsError,
  cancelConversation,
  getConversation,
  listProfiles,
  sendMessage as apiSendMessage,
  updateConversation,
  type ReasoningEffort,
} from '@/api'
import { LoginModal } from '@/components/login-modal'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'
import { MdxContent } from '@/components/mdx'
import {
  useConversationMessages,
  type Fragment as LiveFragment,
  type OptimisticUserMessage,
  type ToolEvent,
} from '@/lib/conversation-stream'
import { useCatalog } from '@/lib/use-catalog'
import { useDefaultProfile } from '@/lib/use-default-profile'
import { useEnsureConversation } from '@/lib/use-ensure-conversation'
import { ProfilePicker } from '@/components/composer/profile-picker'
import { ReasoningPicker } from '@/components/composer/reasoning-picker'

function useProfiles() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const refetchProfiles = useCallback(() => {
    listProfiles()
      .then((items) => setProfiles(items))
      .catch(() => {})
  }, [])
  useEffect(() => {
    refetchProfiles()
  }, [refetchProfiles])
  return { profiles, refetchProfiles }
}

export function ActiveConversationPage({ conversationId }: { conversationId?: string }) {
  const { navigate } = useNavigation()
  const { profiles, refetchProfiles } = useProfiles()
  const { catalog } = useCatalog()
  const {
    messages,
    optimistic,
    streaming,
    error: streamError,
    chunks,
    partialChars,
    pushOptimisticUser,
    clearError: clearStreamError,
  } = useConversationMessages(conversationId)

  const [conv, setConv] = useState<ConversationSummary | null>(null)
  const [defaultProfile, setDefaultProfile] = useDefaultProfile(profiles)
  const [pickedProfile, setPickedProfile] = useState<ProfileSummary | null>(null)
  const [pickedEffort, setPickedEffort] = useState<ReasoningEffort | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [forceStopped, setForceStopped] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [loginFor, setLoginFor] = useState<{ profileId: string; pendingContent: string } | null>(null)
  const [selectionPopup, setSelectionPopup] = useState<
    | {
        x: number
        y: number
        text: string
        isCode: boolean
        language?: string
      }
    | null
  >(null)
  const [pendingQuote, setPendingQuote] = useState<string | null>(null)

  const lastCheckedProfileIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  // "pinned" means the user is at (or near) the bottom of the transcript
  // and new content should auto-scroll. As soon as they scroll up, we stop
  // yanking the viewport so they can read older messages in peace.
  const pinnedRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedRef.current = distance < 96
    // Position of the selection popup is anchored to the viewport, so a scroll
    // makes it stale — just dismiss it. The user can reselect if they want.
    setSelectionPopup((prev) => (prev ? null : prev))
  }, [])

  const handleTranscriptMouseUp = useCallback(() => {
    // Defer one tick so the selection range is finalized after mouseup.
    setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) { setSelectionPopup(null); return }
      const rawText = sel.toString()
      if (!rawText.trim()) { setSelectionPopup(null); return }
      const anchor = sel.anchorNode
      const focus = sel.focusNode
      const container = scrollRef.current
      if (!container || !anchor || !focus) { setSelectionPopup(null); return }
      if (!container.contains(anchor) || !container.contains(focus)) {
        setSelectionPopup(null); return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) { setSelectionPopup(null); return }
      // Detect whether the whole selection sits inside a code block; if so
      // we'll later wrap it in a fenced code block instead of a blockquote.
      const ancestor = range.commonAncestorContainer
      const ancestorEl = ancestor.nodeType === Node.ELEMENT_NODE
        ? (ancestor as Element)
        : ancestor.parentElement
      const codeEl = ancestorEl?.closest('pre, code') ?? null
      let isCode = !!codeEl
      let language: string | undefined
      if (codeEl) {
        const codeChild = codeEl.tagName === 'PRE' ? codeEl.querySelector('code') : codeEl
        const cls = codeChild?.className || codeEl.className || ''
        const m = cls.match(/language-([\w+-]+)/)
        if (m) language = m[1]
        // An inline `<code>` (no surrounding <pre>) is usually a one-liner;
        // treat that as plain text so we don't fence trivial single tokens.
        if (codeEl.tagName === 'CODE' && !codeEl.closest('pre')) isCode = false
      }
      // Streamdown's syntax-highlighted code blocks render each line as a
      // sibling <span> with no `\n` text node between them — so plain
      // `sel.toString()` returns the tokens concatenated and the quote
      // collapses to one line. Walk the line spans instead and join with
      // explicit newlines, clipping each line range to the selection.
      const text = isCode && codeEl
        ? extractCodeSelectionText(codeEl, range) || rawText
        : rawText.trim()
      setSelectionPopup({
        x: rect.left + rect.width / 2,
        y: rect.top,
        text,
        isCode,
        language,
      })
    }, 0)
  }, [])

  useEffect(() => {
    if (!selectionPopup) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target
      if (target instanceof Element && target.closest('[data-quote-popup]')) return
      setSelectionPopup(null)
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setSelectionPopup(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [selectionPopup])

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

  useEffect(() => {
    if (!selectedProfile) return
    if (lastCheckedProfileIdRef.current === selectedProfile.id) return

    lastCheckedProfileIdRef.current = selectedProfile.id

    if (selectedProfile.home && !selectedProfile.home.hasCredentials) {
      setLoginFor({ profileId: selectedProfile.id, pendingContent: '' })
    }
  }, [selectedProfile])

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

  // Re-pin to bottom whenever we switch conversations, so a fresh transcript
  // starts at the latest message rather than wherever the previous one left us.
  useEffect(() => {
    pinnedRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversationId])

  // Discrete content changes (new message lands, streaming starts/ends,
  // optimistic bubble appears): smooth-scroll if the user is pinned.
  useEffect(() => {
    if (!pinnedRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, optimistic.length, !!streaming, !!streamError, !!sendError])

  // High-frequency growth during a live stream: jump to bottom without
  // animation so the smooth-scroll queue doesn't fight every partial.
  useEffect(() => {
    if (!streaming || !pinnedRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streaming, chunks, partialChars])

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
    // Wipe the previous turn's stream error (e.g. usageLimitExceeded) so the
    // user isn't staring at it forever — the new turn either succeeds or
    // surfaces its own error.
    clearStreamError()
    // Show the user's message instantly. It will be reconciled out when the
    // backend's persisted copy comes back via listMessages on `done`.
    if (conversationId) pushOptimisticUser(content)
    try {
      const id = await ensure(content)
      await apiSendMessage(id, content)
      if (id !== conversationId) navigate({ page: 'active-conversation', conversationId: id })
    } catch (e) {
      if (e instanceof NoCredentialsError) {
        setLoginFor({ profileId: e.profileId, pendingContent: content })
        return
      }
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [ensure, conversationId, navigate, pushOptimisticUser, clearStreamError])

  const onChangeWorkdir = useCallback(async () => {
    if (!conversationId || !conv) return
    const next = window.prompt('Working directory for this conversation:', conv.workspacePath)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === conv.workspacePath) return
    try {
      const updated = await updateConversation(conversationId, { workspacePath: trimmed })
      setConv(updated)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, conv])

  const onOpenWorkdir = useCallback(async () => {
    if (!conv?.workspacePath || !window.anubis) return
    const err = await window.anubis.shell.openPath(conv.workspacePath)
    if (err) setSendError(`Couldn't open folder: ${err}`)
  }, [conv?.workspacePath])

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
      <div className='flex flex-shrink-0 items-start justify-between gap-5 border-b border-border px-7 pb-4 pt-[18px]'>
        <div className='min-w-0 flex-1'>
          <h1 className='m-0 text-[25px] font-semibold leading-[1.15] tracking-[-0.022em]'>
            {conv?.title ?? (conversationId ? 'Active conversation' : 'New conversation')}
          </h1>
          {conversationId && (
            <div className='mt-2.5 flex flex-wrap items-center gap-3'>
              <span className='font-mono text-[12px] text-muted-foreground/65'>
                session: {conversationId.slice(0, 13)}
              </span>
              {conv?.workspacePath && (
                <span
                  className='inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-card/70 px-2 py-1 font-mono text-[11.5px] text-muted-foreground'
                  title={conv.workspacePath}
                >
                  <FolderIcon className='size-[12px] shrink-0 text-[var(--anubis-gold)]' strokeWidth={2} />
                  <span className='truncate'>{conv.workspacePath}</span>
                  <button
                    type='button'
                    onClick={() => void onChangeWorkdir()}
                    aria-label='Change working directory'
                    className='ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    <PencilIcon className='size-[11px]' strokeWidth={2} />
                  </button>
                  {!!window.anubis && (
                    <button
                      type='button'
                      onClick={() => void onOpenWorkdir()}
                      aria-label='Open working directory in file manager'
                      className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    >
                      <FolderOpenIcon className='size-[11px]' strokeWidth={2} />
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseUp={handleTranscriptMouseUp}
        className='flex-1 overflow-y-auto px-7 pb-[30px] pt-[34px] scroll-smooth'
      >
        <div className='mx-auto flex max-w-[720px] flex-col gap-6'>
          {messages.map((m) => (
            <RenderedMessage key={m.id} message={m} conversationId={conversationId ?? ''} />
          ))}
          {optimistic.map((m) => (
            <OptimisticUserBubble key={m.id} message={m} />
          ))}
          {optimistic.length > 0 && !streaming && !streamError && !sendError && (
            <ThinkingIndicator />
          )}
          {streaming && (
            <StreamingMessage
              live={streaming}
              conversationId={conversationId ?? ''}
              chunks={chunks}
              tokens={tokens}
              elapsed={elapsed}
            />
          )}
          {(streamError ?? sendError) && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 font-mono text-[12px] text-destructive'>
              {streamError ?? sendError}
            </div>
          )}
          {/* Sentinel: scroll target for smooth auto-scroll. */}
          <div ref={bottomRef} aria-hidden className='h-px w-px' />
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
        pendingQuote={pendingQuote}
        onConsumeQuote={() => setPendingQuote(null)}
        conversationId={conversationId ?? ''}
      />

      {selectionPopup && (
        <button
          type='button'
          data-quote-popup
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const md = selectionPopup.isCode
              ? formatCodeFence(selectionPopup.text, selectionPopup.language)
              : formatBlockquote(selectionPopup.text)
            setPendingQuote(md)
            setSelectionPopup(null)
            window.getSelection()?.removeAllRanges()
          }}
          style={{
            position: 'fixed',
            left: selectionPopup.x,
            top: selectionPopup.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
          className='z-50 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-lg shadow-black/30 transition-colors hover:bg-muted'
        >
          <QuoteIcon className='size-[12px]' strokeWidth={2} />
          Quote selection
        </button>
      )}

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

      {loginFor && (
        <LoginModal
          profileId={loginFor.profileId}
          open
          onClose={() => setLoginFor(null)}
          onSuccess={() => {
            const pending = loginFor.pendingContent
            setLoginFor(null)
            refetchProfiles()
            if (pending.trim()) {
              void onSend(pending)
            }
          }}
        />
      )}
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

function ThinkingIndicator() {
  return (
    <div className='flex items-center gap-2.5 self-start rounded-md px-1 py-1'>
      <AnubisMark size={15} />
      <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
        Anubis
      </span>
      <span className='inline-flex items-center gap-1'>
        <span className='inline-block size-[5px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.4s_ease-out_infinite]' />
        <span
          className='inline-block size-[5px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.4s_ease-out_infinite]'
          style={{ animationDelay: '0.18s' }}
        />
        <span
          className='inline-block size-[5px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.4s_ease-out_infinite]'
          style={{ animationDelay: '0.36s' }}
        />
      </span>
      <span className='text-[13px] italic text-muted-foreground'>thinking…</span>
    </div>
  )
}

function OptimisticUserBubble({ message }: { message: OptimisticUserMessage }) {
  return (
    <div className='flex justify-end'>
      <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground opacity-80'>
        {message.content}
      </div>
    </div>
  )
}

function StreamingMessage({
  live,
  conversationId,
  chunks,
  tokens,
  elapsed,
}: {
  live: { fragments: LiveFragment[]; toolEvents: Record<string, ToolEvent> }
  conversationId: string
  chunks: number
  tokens: number
  elapsed: number
}) {
  const [collapsed, setCollapsed] = useState(false)
  const toolCount = live.fragments.filter((f) => f.kind === 'tool').length

  return (
    <div className='flex flex-col gap-3'>
      <button
        type='button'
        onClick={() => setCollapsed((v) => !v)}
        className='group flex items-center gap-2 self-start rounded-md px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--anubis-gold-hi)]'
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand Anubis progress' : 'Collapse Anubis progress'}
      >
        <ChevronDownIcon
          className={cn(
            'size-[14px] text-muted-foreground transition-transform',
            collapsed && '-rotate-90',
          )}
          strokeWidth={2}
        />
        <AnubisMark size={15} />
        <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
          Anubis
        </span>
        <span className='font-mono text-[11px] text-muted-foreground/70'>
          · {chunks} chunks · {(tokens / 1000).toFixed(1)}k · {elapsed}s
          {toolCount > 0 && ` · ${toolCount} tool${toolCount === 1 ? '' : 's'}`}
        </span>
      </button>
      {!collapsed && (
        <div className='flex flex-col gap-3'>
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
      )}
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
  pendingQuote,
  onConsumeQuote,
  conversationId,
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
  pendingQuote?: string | null
  onConsumeQuote?: () => void
  conversationId: string
}) {
  const [value, setValue] = useState('')
  const [quotes, setQuotes] = useState<string[]>([])
  const ref = useRef<HTMLTextAreaElement | null>(null)

  function autoGrow() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(() => {
    if (!pendingQuote) return
    setQuotes((prev) => [...prev, pendingQuote])
    onConsumeQuote?.()
    requestAnimationFrame(() => ref.current?.focus())
  }, [pendingQuote, onConsumeQuote])

  function buildPayload() {
    const blocks = quotes.join('\n\n')
    const body = value.trim()
    if (!blocks) return body
    return body ? `${blocks}\n\n${body}` : blocks
  }

  function commit() {
    const payload = buildPayload()
    if (!payload) return
    onSend(payload)
    setValue('')
    setQuotes([])
    if (ref.current) ref.current.style.height = 'auto'
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (streaming) { onStop(); return }
    commit()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends. Shift+Enter inserts newline (default behavior).
    // Ignore IME composition so multi-keystroke input methods aren't truncated.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (streaming) { onStop(); return }
    if (agentUnavailable) return
    commit()
  }

  const agent = profile?.config.agent as 'claude' | 'codex' | undefined
  const agentUnavailable =
    availability && agent ? !availability[agent].available : false
  const installHint =
    agentUnavailable && agent
      ? `\`${agent}\` not found on PATH. Install ${agent === 'claude' ? 'Claude Code' : 'Codex CLI'} first.`
      : null

  const hasContent = value.trim().length > 0 || quotes.length > 0
  const sendDisabled = !streaming && (!hasContent || agentUnavailable)

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
      <div className='relative mx-auto max-w-[768px] rounded-[13px] border border-border bg-card px-2.5 pb-2 pt-2 focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'>
        {quotes.length > 0 && (
          <div className='mb-1.5 flex flex-col gap-1.5 px-1 pt-1'>
            {quotes.map((q, i) => (
              <div
                key={i}
                className='group relative overflow-hidden rounded-md border-l-2 border-[var(--anubis-gold)] bg-muted/40 py-1 pl-2.5 pr-7 text-[13.5px] leading-[1.45] text-foreground/85'
              >
                <div className='max-h-[200px] overflow-y-auto'>
                  <MdxContent source={q} conversationId={conversationId} />
                </div>
                <button
                  type='button'
                  aria-label='Remove quote'
                  onClick={() => setQuotes((prev) => prev.filter((_, idx) => idx !== i))}
                  className='absolute right-1 top-1 flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                >
                  <XIcon className='size-[12px]' strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => { setValue(e.target.value); autoGrow() }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder='Reply to Anubis… (Enter to send, Shift+Enter for newline)'
          disabled={streaming}
          className='block max-h-[160px] min-h-[28px] w-full resize-none bg-transparent px-1 py-1.5 text-[14.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60'
        />

        <div className='mt-1 flex items-center gap-2 pr-[110px]'>
          <button
            type='button'
            aria-label='Attach'
            disabled={streaming}
            className='flex size-[30px] flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            <PaperclipIcon className='size-[17px]' strokeWidth={2} />
          </button>

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
        </div>

        {streaming ? (
          <button
            type='submit'
            disabled={stopping}
            className='absolute bottom-2 right-2 inline-flex h-[34px] items-center gap-1.5 rounded-md bg-destructive/15 px-4 text-[14px] font-semibold tracking-[-0.01em] text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50'
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
              'absolute bottom-2 right-2 inline-flex h-[34px] items-center gap-1.5 rounded-md px-4 text-[14px] font-semibold tracking-[-0.01em] transition-colors',
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

/**
 * Reconstruct a multi-line selection inside a Shiki-highlighted code
 * block. Each line is rendered as a sibling <span> with no `\n` between
 * them, so we walk those line-spans, build a Range per line clipped to
 * the user's selection, and join with explicit newlines.
 *
 * Returns "" if the structure doesn't look like Shiki (caller falls back
 * to plain `sel.toString()`).
 */
function extractCodeSelectionText(codeEl: Element, sel: Range): string {
  const codeNode = codeEl.tagName === 'PRE'
    ? codeEl.querySelector('code') ?? codeEl
    : codeEl
  const lineSpans = Array.from(codeNode.children).filter(
    (el): el is HTMLElement => el.tagName === 'SPAN',
  )
  if (lineSpans.length === 0) return ''
  const out: string[] = []
  for (const line of lineSpans) {
    if (!sel.intersectsNode(line)) continue
    const lineRange = document.createRange()
    lineRange.selectNodeContents(line)
    if (sel.compareBoundaryPoints(Range.START_TO_START, lineRange) > 0) {
      lineRange.setStart(sel.startContainer, sel.startOffset)
    }
    if (sel.compareBoundaryPoints(Range.END_TO_END, lineRange) < 0) {
      lineRange.setEnd(sel.endContainer, sel.endOffset)
    }
    // Shiki emits the literal `\n` inside empty-line spans; strip a single
    // trailing newline so it doesn't double up with our join separator.
    out.push(lineRange.toString().replace(/\n$/, ''))
  }
  return out.join('\n')
}

/**
 * Wrap a code selection in a fenced code block, picking a fence length
 * longer than any backtick run inside the snippet so the fence can't be
 * closed early. The renderer then gets a proper code block (preserves
 * line breaks, ships with copy/download buttons).
 */
function formatCodeFence(text: string, language?: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const runs = body.match(/`{3,}/g)
  const maxRun = runs ? Math.max(...runs.map((s) => s.length)) : 2
  const fence = '`'.repeat(Math.max(3, maxRun + 1))
  return `${fence}${language ?? ''}\n${body}\n${fence}`
}

/**
 * Serialize a prose selection as a markdown blockquote where each input
 * line becomes its own paragraph inside the same blockquote. We use the
 * paragraph form (`> a\n>\n> b`) instead of hard breaks because
 * trailing-space hard breaks get eaten by the renderer's sanitizer,
 * collapsing everything onto one line.
 */
function formatBlockquote(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    out.push(line.length === 0 ? '>' : `> ${line}`)
    if (
      i < lines.length - 1 &&
      line.length > 0 &&
      lines[i + 1]!.length > 0
    ) {
      out.push('>')
    }
  }
  return out.join('\n')
}
