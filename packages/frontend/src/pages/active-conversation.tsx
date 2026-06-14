import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { extractImageReferencesFromUnknown } from '@anubis/shared'
import {
  GlobeIcon, PaperclipIcon, SendIcon, BrainIcon, SquareIcon, Loader2Icon, ChevronDownIcon, QuoteIcon, XIcon,
  FolderIcon, FolderOpenIcon, CopyIcon, CheckIcon,
} from 'lucide-react'

import type { AgentAvailability, AgentKind, ConversationSummary, MessageSummary, ProfileSummary, WorkspaceSummary, AppConfig } from '@anubis/shared'

import {
  NoCredentialsError,
  cancelConversation,
  getConversation,
  listProfiles,
  sendMessage as apiSendMessage,
  updateConversation,
  getAppConfig,
  type ReasoningEffort,
} from '@/api'
import { LoginModal } from '@/components/login-modal'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'
import { MdxContent } from '@/components/mdx'
import { MessageImageList } from '@/components/mdx/message-image'
import { normalizeMessageImageReferences } from '@/lib/message-image-detection'
import {
  useConversationMessages,
  type Fragment as LiveFragment,
  type OptimisticUserMessage,
  type ToolEvent,
} from '@/lib/conversation-stream'
import { useCatalog } from '@/lib/use-catalog'
import { useDefaultProfile } from '@/lib/use-default-profile'
import { useEnsureConversation } from '@/lib/use-ensure-conversation'
import { useWorkspaces } from '@/lib/use-workspaces'
import { useProject } from '@/lib/use-project'
import { ProfilePicker } from '@/components/composer/profile-picker'
import { ReasoningPicker } from '@/components/composer/reasoning-picker'
import { WorkdirPicker } from '@/components/composer/workdir-picker'
import { BudgetPicker } from '@/components/composer/budget-picker'

/**
 * Default context-pack token budget used when neither the conversation override
 * nor the profile config specifies one. Keep in sync with the backend default in
 * `packages/conversation/src/conversations/conversation-service.ts`.
 */
const DEFAULT_CONTEXT_PACK_BUDGET = 1000

/** Friendly install target per agent, used in the composer's "not on PATH" hint. */
const AGENT_INSTALL_LABEL: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  antigravity: 'the Antigravity CLI',
  'gpt-web': 'GPT Web',
  'qwen-web': 'Qwen Web',
  qoder: 'Qoder',
}

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
  const { activeProject } = useProject()
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
  const { workspaces, refetch: refetchWorkspaces, remove: removeWorkspace } = useWorkspaces()
  const [pickedWorkdir, setPickedWorkdir] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [forceStopped, setForceStopped] = useState(false)
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

  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  useEffect(() => {
    getAppConfig().then(setAppConfig).catch(() => {})
  }, [])

  // --- Prompt-optimizer local state (mirrors the pickedEffort pattern) ---
  const [pickedEnableContext, setPickedEnableContext] = useState<boolean | null>(null)
  const [pickedBudget, setPickedBudget] = useState<number | undefined | null>(null)

  const overrides = conv?.extra?.overrides || {}
  const convOverrideEnableContext =
    overrides.enableContextInjection !== undefined
      ? (overrides.enableContextInjection as boolean)
      : undefined
  const profileDefaultEnableContext =
    selectedProfile?.config.enableContextInjection !== undefined
      ? (selectedProfile.config.enableContextInjection as boolean)
      : (appConfig?.enableContextInjection ?? false)

  const effectiveEnableContext: boolean =
    pickedEnableContext ?? convOverrideEnableContext ?? profileDefaultEnableContext

  const convOverrideBudget =
    overrides.contextPackBudget !== undefined
      ? (overrides.contextPackBudget as number)
      : undefined
  const profileDefaultBudget =
    selectedProfile?.config.contextPackBudget !== undefined
      ? (selectedProfile.config.contextPackBudget as number)
      : undefined

  const effectiveBudget: number | undefined =
    pickedBudget !== null
      ? pickedBudget
      : (convOverrideBudget ?? profileDefaultBudget ?? DEFAULT_CONTEXT_PACK_BUDGET)

  const onEnableContextChange = useCallback(async (next: boolean) => {
    setPickedEnableContext(next)
    setSendError(null)
    if (!conversationId) return
    const currentOverrides = conv?.extra?.overrides || {}
    try {
      const updated = await updateConversation(conversationId, {
        override: {
          ...currentOverrides,
          enableContextInjection: next
        }
      })
      setConv(updated)
    } catch (e) {
      setPickedEnableContext(null)
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, conv])

  const onBudgetChange = useCallback(async (next: number | undefined) => {
    setPickedBudget(next === undefined ? undefined : next)
    setSendError(null)
    if (!conversationId) return
    const currentOverrides = conv?.extra?.overrides || {}
    const nextOverrides = { ...currentOverrides }
    if (next === undefined) {
      delete nextOverrides.contextPackBudget
    } else {
      nextOverrides.contextPackBudget = next
    }
    try {
      const updated = await updateConversation(conversationId, {
        override: nextOverrides
      })
      setConv(updated)
    } catch (e) {
      setPickedBudget(null)
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, conv])

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

  // For a brand-new conversation, default the working directory to the active project's
  // workdir, or the most recently used saved folder. Seed only once (while the
  // picked value is still null) so the user's later choice isn't overwritten.
  useEffect(() => {
    if (conversationId) return
    if (pickedWorkdir !== null) return
    
    if (activeProject?.workdir) {
      setPickedWorkdir(activeProject.workdir)
      return
    }
    
    if (workspaces.length > 0) setPickedWorkdir(workspaces[0]!.path)
  }, [conversationId, workspaces, pickedWorkdir, activeProject?.workdir])

  // The value the workdir picker shows. For an existing conversation it is the
  // conversation's folder; for a new one it is the local picked value.
  const selectedWorkdir: string | null = conversationId
    ? conv?.workspacePath ?? null
    : pickedWorkdir

  const onWorkdirChange = useCallback(async (path: string | null) => {
    if (!conversationId) { setPickedWorkdir(path); return }
    // Existing conversation: "new temp folder" (null) is not meaningful — only
    // persist a concrete folder.
    if (!path) return
    try {
      const updated = await updateConversation(conversationId, { workspacePath: path })
      setConv(updated)
      refetchWorkspaces()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [conversationId, refetchWorkspaces])

  const { ensure } = useEnsureConversation(
    conversationId, selectedProfile, effectiveEffort, profileDefaultEffort, selectedWorkdir,
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
    // Treat the run as stopped locally right away — the kill switch is a hard
    // force-stop, and the backend now guarantees a terminal `done` event, so we
    // don't wait on the round-trip to clear the live indicators. The SSE hook
    // stays open and reconciles the transcript when `done` lands.
    setForceStopped(true)
    try {
      await cancelConversation(conversationId)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
  }, [conversationId, stopping])

  const onSend = useCallback(async (content: string, files?: string[]) => {
    setSendError(null)
    // Wipe the previous turn's stream error (e.g. usageLimitExceeded) so the
    // user isn't staring at it forever — the new turn either succeeds or
    // surfaces its own error.
    clearStreamError()
    // Show the user's message instantly. It will be reconciled out when the
    // backend's persisted copy comes back via listMessages on `done`.
    if (conversationId) pushOptimisticUser(content, files)
    try {
      const id = await ensure(content)
      await apiSendMessage(id, content, files)
      if (id !== conversationId) {
        refetchWorkspaces()
        navigate({ page: 'active-conversation', conversationId: id })
      }
    } catch (e) {
      if (e instanceof NoCredentialsError) {
        setLoginFor({ profileId: e.profileId, pendingContent: content })
        return
      }
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [ensure, conversationId, navigate, pushOptimisticUser, clearStreamError, refetchWorkspaces])

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
                  <span className='ml-0.5 shrink-0'>
                    <WorkdirPicker
                      value={conv.workspacePath}
                      onChange={(p) => void onWorkdirChange(p)}
                      workspaces={workspaces}
                      onRemove={(p) => void removeWorkspace(p)}
                      onBrowsed={refetchWorkspaces}
                    />
                  </span>
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
        workspaces={workspaces}
        selectedWorkdir={selectedWorkdir}
        onWorkdirChange={(p) => void onWorkdirChange(p)}
        onWorkdirRemove={(p) => void removeWorkspace(p)}
        onWorkdirBrowsed={refetchWorkspaces}
        pendingQuote={pendingQuote}
        onConsumeQuote={() => setPendingQuote(null)}
        conversationId={conversationId ?? ''}
        enableContextInjection={effectiveEnableContext}
        onEnableContextInjectionChange={onEnableContextChange}
        contextPackBudget={effectiveBudget}
        onContextPackBudgetChange={onBudgetChange}
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
        {isLive && streaming ? (
          <>
            <span className='inline-block size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
            <span>
              Streaming · <span>{chunks}</span> chunks · <span>{(tokens / 1000).toFixed(1)}k</span> tokens · <StreamElapsed startedAt={streaming.startedAt} />s elapsed
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

function CollapsibleHookCard({
  contextPack,
  improvedPrompt,
}: {
  contextPack: string
  improvedPrompt: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className='flex flex-col items-end w-full max-w-[75%]'>
      <button
        type='button'
        onClick={() => setExpanded(!expanded)}
        className='flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] px-3 py-1 text-[11.5px] font-medium text-foreground hover:bg-[color-mix(in_oklab,var(--anubis-gold)_18%,transparent)] transition-all cursor-pointer'
      >
        <span className='size-[5px] rounded-full bg-[var(--anubis-gold-hi)]' />
        ✨ Prompt Optimized
        <ChevronDownIcon
          className={cn(
            'size-3 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className='mt-2 w-full rounded-lg border border-border bg-card p-3 shadow-md text-left flex flex-col gap-3 animate-in fade-in duration-200'>
          {contextPack && (
            <div>
              <div className='mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground'>
                Retrieved Context Pack
              </div>
              <div className='max-h-40 overflow-y-auto rounded border border-border bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground/90 whitespace-pre-wrap break-all scrollbar-thin'>
                {contextPack}
              </div>
            </div>
          )}
          {improvedPrompt && (
            <div>
              <div className='mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground'>
                Improved Prompt Sent to Agent
              </div>
              <div className='max-h-40 overflow-y-auto rounded border border-border bg-muted/30 p-2 font-mono text-[11.5px] text-foreground whitespace-pre-wrap scrollbar-thin'>
                {improvedPrompt}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One persisted transcript entry. Memoized so the historical transcript does
 * not re-render on every streamed chunk: `message` identity is stable between
 * fetches (the array is only replaced on initial load / `done`), and
 * `conversationId` is a string — the default shallow compare is sufficient.
 */
const RenderedMessage = memo(function RenderedMessage({
  message,
  conversationId,
}: {
  message: MessageSummary
  conversationId: string
}) {
  if (message.role === 'user') {
    const files = message.metadata?.fileReferences as string[] | undefined
    const originalPrompt = message.metadata?.originalPrompt as string | undefined
    const contextPack = message.metadata?.contextPack as string | undefined
    const improvedPrompt = message.metadata?.improvedPrompt as string | undefined

    const showHookInfo = !!(originalPrompt || contextPack || improvedPrompt)

    return (
      <div className='flex flex-col items-end gap-1.5 w-full'>
        <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground'>
          {originalPrompt ?? message.content}
        </div>

        {showHookInfo && (
          <CollapsibleHookCard
            contextPack={contextPack ?? ''}
            improvedPrompt={improvedPrompt ?? ''}
          />
        )}

        {files && files.length > 0 && (
          <div className='flex flex-col items-end gap-1 max-w-[75%]'>
            {files.map((file, idx) => {
              const filename = file.split(/[/\\]/).pop() || file
              return (
                <div
                  key={idx}
                  className='flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground'
                  title={file}
                >
                  <PaperclipIcon className='size-[11px] shrink-0 text-muted-foreground/75' strokeWidth={2} />
                  <span className='truncate max-w-[240px]'>{filename}</span>
                </div>
              )
            })}
          </div>
        )}
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
  const imageReferences = normalizeMessageImageReferences(message.metadata?.imageReferences)
  return (
    <div className='group/anubis flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <AnubisMark size={15} />
        <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
          Anubis
        </span>
        <CopyMessageButton text={message.content} />
      </div>
      <MdxContent
        source={message.content}
        conversationId={conversationId}
        imageReferences={imageReferences}
      />
    </div>
  )
})

/**
 * Leaf component owning the 250 ms "elapsed seconds" ticker. Keeping the
 * interval state here (instead of at the page level) means the tick only
 * re-renders this tiny <span>, not the whole transcript.
 */
function StreamElapsed({ startedAt }: { startedAt: number }) {
  const compute = () => Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const [elapsed, setElapsed] = useState(compute)
  useEffect(() => {
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    const tick = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 250)
    return () => clearInterval(tick)
  }, [startedAt])
  return <span>{elapsed}</span>
}

/**
 * Subtle "copy message to clipboard" button for Anubis responses. Stays
 * dimmed/hidden until the message block is hovered (revealed via the parent's
 * `group/anubis` class) or the button itself is focused — so it never competes
 * with the content. On a successful copy it swaps to a check icon + "Copied!"
 * label for ~1.5s, then reverts. On touch devices (no hover) it stays visible.
 */
function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard write can reject (permissions / insecure context); fail
      // silently rather than surfacing an error on a convenience action.
    }
  }, [text])

  return (
    <button
      type='button'
      onClick={() => void onCopy()}
      aria-label={copied ? 'Copied to clipboard' : 'Copy message to clipboard'}
      title={copied ? 'Copied!' : 'Copy'}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em]',
        'text-muted-foreground/70 transition-all hover:bg-muted hover:text-foreground',
        'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--anubis-gold-hi)]',
        // Hidden on hover-capable pointers until the message is hovered/focused;
        // always visible where hover isn't available (touch).
        'opacity-0 group-hover/anubis:opacity-100 max-[640px]:opacity-100 [@media(hover:none)]:opacity-100',
        copied && 'opacity-100 text-[var(--anubis-success)]',
      )}
    >
      {copied ? (
        <CheckIcon className='size-[12px]' strokeWidth={2.4} />
      ) : (
        <CopyIcon className='size-[12px]' strokeWidth={2} />
      )}
      {copied && <span>Copied!</span>}
    </button>
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
  const files = message.fileReferences
  return (
    <div className='flex flex-col items-end gap-1.5'>
      <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground opacity-80'>
        {message.content}
      </div>
      {files && files.length > 0 && (
        <div className='flex flex-col items-end gap-1 max-w-[75%] opacity-80'>
          {files.map((file, idx) => {
            const filename = file.split(/[/\\]/).pop() || file
            return (
              <div
                key={idx}
                className='flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground'
                title={file}
              >
                <PaperclipIcon className='size-[11px] shrink-0 text-muted-foreground/75' strokeWidth={2} />
                <span className='truncate max-w-[240px]'>{filename}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StreamingMessage({
  live,
  conversationId,
  chunks,
  tokens,
}: {
  live: { fragments: LiveFragment[]; toolEvents: Record<string, ToolEvent>; startedAt: number }
  conversationId: string
  chunks: number
  tokens: number
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
          · {chunks} chunks · {(tokens / 1000).toFixed(1)}k · <StreamElapsed startedAt={live.startedAt} />s
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
            return <ToolCard key={i} ev={ev} conversationId={conversationId} />
          })}
        </div>
      )}
    </div>
  )
}

function summarizeToolArgs(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const n = name.toLowerCase()
  if (n === 'powershell' || n === 'bash') return str(a.description) || str(a.command)
  if (n === 'read' || n === 'write' || n === 'edit' || n === 'notebookedit') return str(a.file_path)
  if (n === 'glob') return str(a.pattern) + (a.path ? ` in ${str(a.path)}` : '')
  if (n === 'grep') return str(a.pattern) + (a.path ? ` in ${str(a.path)}` : '')
  if (n === 'webfetch' || n === 'webSearch') return str(a.url) || str(a.query) || str(a.prompt)
  if (n === 'agent' || n === 'task') return str(a.description) || str(a.prompt)
  if (n === 'skill') return str(a.skill)
  for (const k of ['description', 'command', 'query', 'prompt', 'url', 'pattern', 'path', 'file_path']) {
    const v = str(a[k])
    if (v) return v
  }
  return ''
}

function formatJson(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolCard({ ev, conversationId }: { ev: ToolEvent; conversationId: string }) {
  const [expanded, setExpanded] = useState(false)
  const running = ev.kind === 'call'
  const isError = ev.kind === 'result' && ev.isError
  const args = ev.kind === 'call' ? ev.args : ev.args
  const result = ev.kind === 'result' ? ev.result : undefined
  const imageReferences = useMemo(
    () => (result == null || isError ? [] : extractImageReferencesFromUnknown(result)),
    [result, isError],
  )
  const summary = summarizeToolArgs(ev.name, args)
  const statusLabel = running ? 'running…' : isError ? 'failed' : 'completed'
  const dotClass = running
    ? 'bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]'
    : isError
      ? 'bg-[var(--destructive)]'
      : 'bg-[var(--anubis-success)]'
  const Icon = running ? BrainIcon : GlobeIcon
  const hasDetails = Boolean(summary || args || result)

  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card'>
      <button
        type='button'
        onClick={() => hasDetails && setExpanded((v) => !v)}
        disabled={!hasDetails}
        className={cn(
          'flex w-full items-center gap-2.5 p-3 text-left',
          hasDetails && 'cursor-pointer hover:bg-muted/40',
        )}
        aria-expanded={expanded}
      >
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          <Icon className='size-[15px]' strokeWidth={2} />
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {ev.name}
          </span>
          <span
            className={cn(
              'mt-1 truncate font-mono text-[11.5px]',
              isError ? 'text-[var(--destructive)]' : 'text-muted-foreground',
            )}
          >
            {summary ? `${statusLabel} · ${summary}` : statusLabel}
          </span>
        </div>
        {hasDetails && (
          <ChevronDownIcon
            className={cn(
              'size-[14px] shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90',
            )}
            strokeWidth={2}
          />
        )}
        <span className={cn('size-[7px] shrink-0 rounded-full', dotClass)} />
      </button>
      {expanded && hasDetails && (
        <div className='border-t border-border bg-muted/30 px-3 py-2 text-[11.5px]'>
          {args != null && (
            <div className='mb-2'>
              <div className='mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground'>
                input
              </div>
              <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-foreground'>
                {formatJson(args)}
              </pre>
            </div>
          )}
          {result != null && (
            <div>
              <div className='mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground'>
                {isError ? 'error' : 'output'}
              </div>
              <pre
                className={cn(
                  'overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px]',
                  isError ? 'text-[var(--destructive)]' : 'text-foreground',
                )}
              >
                {formatJson(result)}
              </pre>
            </div>
          )}
        </div>
      )}
      {imageReferences.length > 0 && (
        <div className='border-t border-border bg-muted/20 px-3 py-3'>
          <MessageImageList refs={imageReferences} conversationId={conversationId} />
        </div>
      )}
      {running && (
        <div className='absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)]'>
          <div className='h-full w-[32%] animate-[anubisIndeterminate_1.7s_cubic-bezier(0.5,0.1,0.5,0.9)_infinite] rounded-sm bg-[var(--anubis-gold)]' />
        </div>
      )}
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
  workspaces,
  selectedWorkdir,
  onWorkdirChange,
  onWorkdirRemove,
  onWorkdirBrowsed,
  pendingQuote,
  onConsumeQuote,
  conversationId,
  enableContextInjection,
  onEnableContextInjectionChange,
  contextPackBudget,
  onContextPackBudgetChange,
}: {
  onSend: (content: string, files?: string[]) => void
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
  availability?: Record<AgentKind, AgentAvailability>
  workspaces: WorkspaceSummary[]
  selectedWorkdir: string | null
  onWorkdirChange: (path: string | null) => void
  onWorkdirRemove: (path: string) => void
  onWorkdirBrowsed: () => void
  pendingQuote?: string | null
  onConsumeQuote?: () => void
  conversationId: string
  enableContextInjection: boolean
  onEnableContextInjectionChange: (next: boolean) => void
  contextPackBudget: number | undefined
  onContextPackBudgetChange: (next: number | undefined) => void
}) {
  const [value, setValue] = useState('')
  const [quotes, setQuotes] = useState<string[]>([])
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
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

  async function handleAttachFiles() {
    if (typeof window === 'undefined' || !window.anubis?.files) {
      return
    }
    try {
      const picked = await window.anubis.files.pick()
      if (picked.length > 0) {
        setAttachedFiles((prev) => Array.from(new Set([...prev, ...picked])))
      }
    } catch (e) {
      console.error('Failed to pick files:', e)
    }
  }

  function buildPayload() {
    const blocks = quotes.join('\n\n')
    const body = value.trim()
    if (!blocks) return body
    return body ? `${blocks}\n\n${body}` : blocks
  }

  function commit() {
    let payload = buildPayload()
    if (!payload && attachedFiles.length > 0) {
      payload = 'Please analyze the attached files.'
    }
    if (!payload) return
    onSend(payload, attachedFiles)
    setValue('')
    setQuotes([])
    setAttachedFiles([])
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

  const agent = profile?.config.agent as AgentKind | undefined
  const agentUnavailable =
    availability && agent ? !availability[agent].available : false
  const installHint =
    agentUnavailable && agent
      ? agent === 'qoder'
        ? 'Add a Qoder API key in Settings to use Qoder.'
        : `\`${agent}\` not found on PATH. Install ${AGENT_INSTALL_LABEL[agent]} first.`
      : null

  const hasContent = value.trim().length > 0 || quotes.length > 0 || attachedFiles.length > 0
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
        {attachedFiles.length > 0 && (
          <div className='mb-2 flex flex-wrap gap-1.5 px-1 pt-1'>
            {attachedFiles.map((path, i) => {
              const filename = path.split(/[/\\]/).pop() || path
              return (
                <div
                  key={path}
                  className='group relative flex items-center gap-1.5 rounded-md border border-border bg-muted/65 py-1 pl-2 pr-6 text-[11.5px] font-mono text-foreground'
                >
                  <PaperclipIcon className='size-3 text-muted-foreground' strokeWidth={2} />
                  <span className='truncate max-w-[180px]' title={path}>{filename}</span>
                  <button
                    type='button'
                    aria-label='Remove file'
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className='absolute right-1 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    <XIcon className='size-[10px]' strokeWidth={2.5} />
                  </button>
                </div>
              )
            })}
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

        <div className={cn('mt-1 flex items-center gap-2', enableContextInjection ? 'pr-[240px]' : 'pr-[135px]')}>
          <button
            type='button'
            aria-label='Attach'
            disabled={streaming}
            onClick={handleAttachFiles}
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
          <WorkdirPicker
            value={selectedWorkdir}
            onChange={onWorkdirChange}
            workspaces={workspaces}
            onRemove={onWorkdirRemove}
            onBrowsed={onWorkdirBrowsed}
            disabled={streaming}
          />
        </div>

        <div className='absolute bottom-2 right-2 flex items-center gap-2'>
          <button
            type='button'
            disabled={streaming}
            onClick={() => onEnableContextInjectionChange(!enableContextInjection)}
            title={enableContextInjection ? 'Prompt Optimizer: Enabled' : 'Prompt Optimizer: Disabled'}
            className={cn(
              'inline-flex size-[34px] items-center justify-center rounded-md border transition-all',
              streaming && 'cursor-not-allowed opacity-50',
              enableContextInjection
                ? 'border-[var(--anubis-gold)] bg-[color-mix(in_oklab,var(--anubis-gold)_15%,transparent)] text-[var(--anubis-gold)]'
                : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <BrainIcon className='size-[16px]' strokeWidth={2} />
          </button>

          {enableContextInjection && (
            <BudgetPicker
              value={contextPackBudget}
              onChange={onContextPackBudgetChange}
              disabled={streaming}
            />
          )}

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
