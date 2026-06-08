import { useState, useRef, useEffect } from 'react'
import {
  openQwenLoginChrome,
  getQwenConversations,
  getQwenConversationDetails,
  streamQwenPrompt,
  type QwenConversationListItem,
  type QwenMessageListItem,
  type CdpDebugInfo
} from '@/api'
import {
  RefreshCwIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  CalendarIcon,
  TerminalIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  SendIcon,
  UserIcon,
  BotIcon,
  PlusIcon,
  Loader2Icon,
} from 'lucide-react'

export function QwenPlaygroundPage() {
  const [openNewTab, setOpenNewTab] = useState(false)
  const [headless, setHeadless] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(30000)
  const [keepTabOpen, setKeepTabOpen] = useState(true)

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [conversations, setConversations] = useState<QwenConversationListItem[]>([])

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [activeMessages, setActiveMessages] = useState<QwenMessageListItem[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [sendingPrompt, setSendingPrompt] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  const [chromeLoading, setChromeLoading] = useState(false)
  const [chromeSuccess, setChromeSuccess] = useState<string | null>(null)

  const [debugInfo, setDebugInfo] = useState<CdpDebugInfo | null>(null)
  const [debugLabel, setDebugLabel] = useState<string>('')
  const [debugOpen, setDebugOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeMessages])

  async function handleLaunchChrome() {
    setChromeLoading(true)
    setChromeSuccess(null)
    setError(null)
    try {
      const res = await openQwenLoginChrome()
      if (res.ok) {
        setChromeSuccess(`Launched Chrome on port ${res.remoteDebuggingPort}. Reused: ${res.reused}`)
      } else {
        throw new Error('Could not launch Chrome')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to launch Chrome')
    } finally {
      setChromeLoading(false)
    }
  }

  async function handleFetchConversations(selectFirst = false) {
    setLoading(true)
    setError(null)
    setStatus('Fetching conversation list from chat.qwen.ai...')
    try {
      const res = await getQwenConversations({ openNewTab, headless, timeoutMs, keepTabOpen })
      setDebugInfo(res.meta?.debug ?? null)
      setDebugLabel('List conversations')
      if (res.ok) {
        const list = res.output.conversations || []
        setConversations(list)
        if (selectFirst && list.length > 0) {
          handleSelectConversation(list[0].id)
        }
      } else {
        setError(res.error?.message || 'Failed to fetch conversations')
        setDebugOpen(true)
      }
    } catch (e: any) {
      setError(e.message || 'An error occurred during fetch')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }

  async function handleSelectConversation(id: string) {
    setSelectedChatId(id)
    setMessagesLoading(true)
    setError(null)
    setActiveMessages([])
    try {
      const res = await getQwenConversationDetails(id, { openNewTab: false, headless, timeoutMs, keepTabOpen })
      setDebugInfo(res.meta?.debug ?? null)
      setDebugLabel(`Conversation details (${id})`)
      if (res.ok) {
        setActiveMessages(res.output.chatMessages || [])
      } else {
        setError(res.error?.message || 'Failed to load conversation details')
        setDebugOpen(true)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load conversation details')
    } finally {
      setMessagesLoading(false)
    }
  }

  async function handleSendPrompt() {
    if (!promptText.trim()) return
    const textToSend = promptText.trim()
    setPromptText('')
    setSendingPrompt(true)
    setError(null)

    const optimisticMsg: QwenMessageListItem = {
      id: 'optimistic-' + Date.now(),
      role: 'user',
      content: textToSend,
      createTime: new Date().toISOString()
    }
    const STREAM_ID = 'streaming-assistant'
    setStreamingText('')
    setActiveMessages((prev) => [...prev, optimisticMsg])

    try {
      const res = await streamQwenPrompt(
        {
          prompt: textToSend,
          conversationId: selectedChatId || undefined,
          openNewTab: false,
          headless,
          timeoutMs: timeoutMs + 120000,
          keepTabOpen,
        },
        {
          onDelta: (text) => {
            setStreamingText(text)
            setActiveMessages((prev) => {
              const others = prev.filter((m) => m.id !== STREAM_ID)
              return [...others, { id: STREAM_ID, role: 'assistant', content: text, createTime: new Date().toISOString() }]
            })
          },
        },
      )

      setDebugInfo(res.meta?.debug ?? null)
      setDebugLabel('Send prompt (stream)')
      if (res.ok) {
        setActiveMessages(res.output.chatMessages || [])
        if (!selectedChatId && res.input?.conversationId) {
          setSelectedChatId(res.input.conversationId)
        }
        await handleFetchConversations()
      } else {
        setError(res.error?.message || 'Failed to send prompt')
        setDebugOpen(true)
        setActiveMessages((prev) => prev.filter(m => m.id !== optimisticMsg.id && m.id !== STREAM_ID))
      }
    } catch (e: any) {
      setError(e.message || 'Error sending prompt')
      setActiveMessages((prev) => prev.filter(m => m.id !== optimisticMsg.id && m.id !== STREAM_ID))
    } finally {
      setSendingPrompt(false)
      setStreamingText('')
    }
  }

  function handleStartNewChat() {
    setSelectedChatId(null)
    setActiveMessages([])
    setError(null)
  }

  return (
    <main className='flex-1 overflow-hidden bg-background h-screen flex flex-col'>
      {/* Header bar */}
      <div className='border-b border-border/40 px-6 py-4 flex items-center justify-between shrink-0 bg-card/10 backdrop-blur-md z-10'>
        <div className='flex flex-col'>
          <h1 className='text-xl font-bold tracking-tight bg-gradient-to-r from-[var(--anubis-gold)] to-orange-400 bg-clip-text text-transparent'>
            Qwen Crawler Playground
          </h1>
          <p className='text-xs text-muted-foreground'>
            Interact with the Qwen (chat.qwen.ai) CDP crawler using the headed/headless active login profile.
          </p>
        </div>

        <div className='flex items-center gap-3'>
          <button
            onClick={handleLaunchChrome}
            disabled={chromeLoading || loading}
            className='flex items-center justify-center gap-2 py-1.5 px-3 rounded-md border border-[var(--anubis-gold)]/30 bg-[var(--anubis-gold)]/10 hover:bg-[var(--anubis-gold)]/20 text-[var(--anubis-gold)] text-xs font-semibold transition-all disabled:opacity-50'
          >
            {chromeLoading ? <RefreshCwIcon className='size-3.5 animate-spin' /> : <ExternalLinkIcon className='size-3.5' />}
            Launch Chrome Login Profile
          </button>
          <button
            onClick={() => handleFetchConversations(false)}
            disabled={loading || chromeLoading}
            className='flex items-center gap-1.5 py-1.5 px-3 rounded-md bg-gradient-to-r from-[var(--anubis-gold)] to-amber-600 hover:brightness-110 text-white text-xs font-semibold shadow transition-all disabled:opacity-50'
          >
            <RefreshCwIcon className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh List
          </button>
          <button
            onClick={() => setDebugOpen((v) => !v)}
            className={`flex items-center gap-1.5 py-1.5 px-3 rounded-md border text-xs font-semibold transition-all ${
              debugOpen
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-border/50 bg-zinc-800/40 hover:bg-zinc-800 text-muted-foreground'
            }`}
            title='Toggle CDP debug panel'
          >
            <TerminalIcon className='size-3.5' />
            Debug
            {debugInfo && (
              <span className='ml-0.5 rounded-full bg-zinc-900/60 px-1.5 text-[9px] tabular-nums'>
                {debugInfo.responses.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {chromeSuccess && (
        <div className='bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-2 text-emerald-400 text-xs flex items-center gap-2 shrink-0'>
          <CheckCircle2Icon className='size-3.5 shrink-0' />
          <span>{chromeSuccess}</span>
        </div>
      )}

      {error && (
        <div className='bg-destructive/10 border-b border-destructive/20 px-6 py-2 text-destructive text-xs flex items-center gap-2 shrink-0'>
          <AlertCircleIcon className='size-3.5 shrink-0' />
          <span className='font-semibold'>Error:</span>
          <span className='truncate'>{error}</span>
        </div>
      )}

      {/* Main split viewport */}
      <div className='flex-1 flex overflow-hidden min-h-0 bg-card/5'>

        {/* Left Side: Conversation List Sidebar */}
        <div className='w-80 border-r border-border/40 flex flex-col shrink-0 min-h-0 bg-card/20'>
          <div className='p-3 border-b border-border/30 flex items-center justify-between shrink-0'>
            <span className='text-xs font-bold uppercase tracking-wider text-muted-foreground px-2'>
              Chats ({conversations.length})
            </span>
            <button
              onClick={handleStartNewChat}
              className='flex items-center gap-1 py-1 px-2.5 rounded bg-zinc-800 border border-zinc-700/50 hover:bg-zinc-700 text-[11px] font-medium text-foreground transition-all'
            >
              <PlusIcon className='size-3 text-[var(--anubis-gold)]' />
              New Chat
            </button>
          </div>

          {/* Settings */}
          <div className='px-4 py-3 bg-zinc-950/20 border-b border-border/30 flex flex-col gap-2 shrink-0'>
            <div className='flex items-center justify-between text-[10px] text-muted-foreground'>
              <span>Open tab: {openNewTab ? 'Yes' : 'No'}</span>
              <span>Headless: {headless ? 'Yes' : 'No'}</span>
            </div>
            <div className='flex gap-1.5 items-center'>
              <input type='checkbox' id='qwenOpenNewTab' checked={openNewTab} onChange={(e) => setOpenNewTab(e.target.checked)} className='rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)] size-3 bg-transparent' />
              <label htmlFor='qwenOpenNewTab' className='text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground'>New Tab</label>
              <input type='checkbox' id='qwenHeadless' checked={headless} onChange={(e) => setHeadless(e.target.checked)} className='ml-3 rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)] size-3 bg-transparent' />
              <label htmlFor='qwenHeadless' className='text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground'>Headless</label>
              <input type='checkbox' id='qwenKeepTabOpen' checked={keepTabOpen} onChange={(e) => setKeepTabOpen(e.target.checked)} className='ml-3 rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)] size-3 bg-transparent' />
              <label htmlFor='qwenKeepTabOpen' className='text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground'>Keep Tab</label>
            </div>
            <div className='flex items-center gap-1.5'>
              <label htmlFor='qwenTimeout' className='text-[10px] text-muted-foreground'>Timeout (ms)</label>
              <input id='qwenTimeout' type='number' value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)} className='w-24 rounded border border-border bg-transparent px-1.5 py-0.5 text-[10px] text-foreground' />
            </div>
          </div>

          <div className='flex-1 overflow-y-auto p-2 flex flex-col gap-1.5'>
            {loading && conversations.length === 0 ? (
              <div className='flex flex-col items-center justify-center p-8 text-muted-foreground gap-2'>
                <Loader2Icon className='size-5 animate-spin text-[var(--anubis-gold)]' />
                <span className='text-[11px]'>{status || 'Fetching...'}</span>
              </div>
            ) : conversations.length === 0 ? (
              <div className='flex flex-col items-center justify-center p-8 text-center text-muted-foreground gap-2'>
                <MessageSquareIcon className='size-6 opacity-40' />
                <span className='text-[11px]'>No conversation history fetched yet.</span>
                <button
                  onClick={() => handleFetchConversations(true)}
                  className='mt-2 text-[10px] py-1 px-2 border border-zinc-700 hover:bg-zinc-800 rounded text-foreground transition-all'
                >
                  Load conversations
                </button>
              </div>
            ) : (
              conversations.map((chat) => {
                const isActive = selectedChatId === chat.id
                return (
                  <button
                    key={chat.id}
                    onClick={() => handleSelectConversation(chat.id)}
                    className={`text-left p-3 rounded-lg border transition-all duration-200 flex flex-col gap-1.5 ${
                      isActive
                        ? 'bg-[var(--anubis-gold)]/10 border-[var(--anubis-gold)]/40 shadow-sm'
                        : 'border-border/40 hover:border-border/80 hover:bg-zinc-800/20'
                    }`}
                  >
                    <span className={`font-semibold text-xs leading-normal line-clamp-2 ${isActive ? 'text-[var(--anubis-gold)]' : 'text-foreground'}`}>
                      {chat.title}
                    </span>
                    <span className='font-mono text-[9px] text-muted-foreground truncate w-full'>{chat.id}</span>
                    <div className='flex items-center gap-1.5 text-[9px] text-muted-foreground mt-1'>
                      <CalendarIcon className='size-2.5 shrink-0' />
                      <span>Updated {new Date(chat.updateTime).toLocaleDateString()}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Side: Message Thread Viewport */}
        <div className='flex-1 flex flex-col min-h-0 bg-background'>
          {selectedChatId === null && activeMessages.length === 0 ? (
            <div className='flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 bg-zinc-950/5'>
              <div className='p-4 rounded-full bg-[var(--anubis-gold)]/5 border border-[var(--anubis-gold)]/20 animate-pulse'>
                <BotIcon className='size-8 text-[var(--anubis-gold)]' />
              </div>
              <h3 className='text-sm font-semibold text-foreground'>Start a New Qwen Thread</h3>
              <p className='text-xs text-muted-foreground max-w-sm'>
                Type a prompt below and send it. The browser automation will open chat.qwen.ai, submit the prompt, and display the response stream.
              </p>
            </div>
          ) : (
            <div className='flex-1 flex flex-col min-h-0'>
              <div className='px-6 py-3 border-b border-border/30 bg-card/5 shrink-0 flex items-center justify-between'>
                <div className='flex flex-col gap-0.5 truncate pr-4'>
                  <span className='text-xs font-semibold text-foreground truncate'>
                    {conversations.find((c) => c.id === selectedChatId)?.title || 'Active Chat Session'}
                  </span>
                  <span className='font-mono text-[9px] text-muted-foreground truncate'>ID: {selectedChatId}</span>
                </div>
              </div>

              <div className='flex-1 overflow-y-auto p-6 flex flex-col gap-4 min-h-0 bg-zinc-950/10'>
                {messagesLoading ? (
                  <div className='flex flex-col items-center justify-center py-20 gap-3'>
                    <Loader2Icon className='size-6 animate-spin text-[var(--anubis-gold)]' />
                    <span className='text-xs text-muted-foreground'>Loading conversation history...</span>
                  </div>
                ) : (
                  activeMessages.map((msg) => {
                    const isUser = msg.role === 'user'
                    return (
                      <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}>
                        <div className={`size-7 rounded-full border flex items-center justify-center shrink-0 mt-0.5 shadow-sm ${
                          isUser ? 'bg-[var(--anubis-gold)]/10 border-[var(--anubis-gold)]/30 text-[var(--anubis-gold)]' : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                        }`}>
                          {isUser ? <UserIcon className='size-3.5' /> : <BotIcon className='size-3.5' />}
                        </div>
                        <div className='flex flex-col gap-1'>
                          <div className={`px-4 py-3 rounded-2xl text-xs leading-relaxed break-words border shadow-sm ${
                            isUser ? 'bg-zinc-900/40 border-[var(--anubis-gold)]/10 text-foreground rounded-tr-none' : 'bg-card border-border/40 text-foreground rounded-tl-none'
                          }`}>
                            <p className='whitespace-pre-wrap'>{msg.content}</p>
                          </div>
                          <span className={`text-[8px] text-muted-foreground ${isUser ? 'text-right' : 'text-left'}`}>
                            {new Date(msg.createTime).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
                {sendingPrompt && !streamingText && (
                  <div className='flex gap-3 max-w-[85%] self-start animate-pulse'>
                    <div className='size-7 rounded-full border bg-zinc-800 border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0 mt-0.5'>
                      <BotIcon className='size-3.5' />
                    </div>
                    <div className='flex flex-col gap-1'>
                      <div className='px-4 py-3 rounded-2xl rounded-tl-none text-xs border bg-card border-border/40 text-muted-foreground flex items-center gap-2'>
                        <Loader2Icon className='size-3 animate-spin text-[var(--anubis-gold)]' />
                        <span>Qwen is generating response in the browser...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {/* Bottom Prompt Input bar */}
          <div className='p-4 border-t border-border/40 bg-card/10 backdrop-blur-md shrink-0'>
            <div className='relative flex items-center rounded-lg border border-border/60 bg-zinc-950/40 px-3 py-1.5 focus-within:ring-1 focus-within:ring-[var(--anubis-gold)] shadow-inner'>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendPrompt()
                  }
                }}
                disabled={sendingPrompt || messagesLoading}
                placeholder={sendingPrompt ? 'Waiting for response...' : 'Type a prompt for Qwen... (Enter to send)'}
                rows={1}
                className='flex-1 border-0 bg-transparent py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none min-h-[36px] max-h-[120px]'
              />
              <button
                onClick={handleSendPrompt}
                disabled={!promptText.trim() || sendingPrompt || messagesLoading}
                className='ml-2 flex size-8 items-center justify-center rounded-md bg-gradient-to-r from-[var(--anubis-gold)] to-amber-600 hover:brightness-110 text-white transition-all duration-200 disabled:opacity-30 disabled:pointer-events-none shrink-0 shadow'
              >
                {sendingPrompt ? <RefreshCwIcon className='size-4 animate-spin' /> : <SendIcon className='size-3.5 fill-current' />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Debug drawer */}
      {debugOpen && (
        <div className='border-t border-emerald-500/20 bg-zinc-950/60 backdrop-blur-md shrink-0 flex flex-col max-h-[45vh] min-h-0'>
          <div className='flex items-center justify-between px-4 py-2 border-b border-border/30 shrink-0'>
            <div className='flex items-center gap-2 text-xs'>
              <TerminalIcon className='size-3.5 text-emerald-400' />
              <span className='font-semibold text-foreground'>CDP Debug</span>
              {debugLabel && <span className='text-muted-foreground'>— {debugLabel}</span>}
            </div>
            <div className='flex items-center gap-3'>
              <button
                onClick={() => { if (debugInfo) navigator.clipboard?.writeText(JSON.stringify(debugInfo, null, 2)) }}
                disabled={!debugInfo}
                className='text-[10px] py-0.5 px-2 rounded border border-zinc-700 hover:bg-zinc-800 text-muted-foreground transition-all disabled:opacity-40'
              >
                Copy JSON
              </button>
              <button onClick={() => setDebugOpen(false)} className='text-[10px] py-0.5 px-2 rounded border border-zinc-700 hover:bg-zinc-800 text-muted-foreground transition-all'>
                Close
              </button>
            </div>
          </div>

          {!debugInfo ? (
            <div className='p-6 text-center text-xs text-muted-foreground'>
              No debug data yet. Run an operation (list, open a conversation, or send a prompt) to capture CDP diagnostics.
            </div>
          ) : (
            <div className='flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-px bg-border/20 min-h-0'>
              <div className='bg-zinc-950/40 flex flex-col min-h-0'>
                <div className='px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/20 shrink-0'>
                  Events ({debugInfo.events.length})
                </div>
                <div className='overflow-y-auto p-3 font-mono text-[10px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-all'>
                  {debugInfo.events.length === 0 ? (
                    <span className='text-muted-foreground'>(no events)</span>
                  ) : (
                    debugInfo.events.map((e, i) => <div key={i}>{e}</div>)
                  )}
                </div>
              </div>

              <div className='bg-zinc-950/40 flex flex-col min-h-0'>
                <div className='px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/20 shrink-0'>
                  Observed responses ({debugInfo.responses.length})
                </div>
                <div className='overflow-y-auto p-2 flex flex-col gap-1'>
                  {debugInfo.responses.length === 0 ? (
                    <span className='p-2 text-[10px] text-muted-foreground'>
                      No chat.qwen.ai responses were observed yet.
                    </span>
                  ) : (
                    debugInfo.responses.map((r, i) => (
                      <div key={i} className={`rounded border px-2 py-1.5 flex flex-col gap-1 ${r.matched ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/30 bg-zinc-900/30'}`}>
                        <div className='flex items-center gap-1.5 flex-wrap text-[9px]'>
                          <span className={`px-1 rounded font-bold ${r.matched ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700/40 text-zinc-400'}`}>
                            {r.matched ? 'MATCH' : 'skip'}
                          </span>
                          {typeof r.status === 'number' && (
                            <span className={`px-1 rounded tabular-nums ${r.status >= 400 ? 'bg-red-500/20 text-red-300' : 'bg-zinc-700/40 text-zinc-300'}`}>
                              {r.status}
                            </span>
                          )}
                          {r.bodyOk === true && <span className='px-1 rounded bg-sky-500/20 text-sky-300'>body ok{typeof r.bodySize === 'number' ? ` ${r.bodySize}b` : ''}</span>}
                          {r.bodyOk === false && <span className='px-1 rounded bg-amber-500/20 text-amber-300'>body empty/failed</span>}
                          {r.contentType && <span className='text-muted-foreground truncate'>{r.contentType.split(';')[0]}</span>}
                        </div>
                        <div className='font-mono text-[9px] text-zinc-400 break-all'>{r.url}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
