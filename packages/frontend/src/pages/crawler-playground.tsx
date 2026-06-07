import { useState, useRef, useEffect } from 'react'
import {
  openChatGPTLoginChrome,
  getChatGPTConversations,
  getChatGPTConversationDetails,
  sendChatGPTPrompt,
  type ChatGPTConversationListItem,
  type ChatGPTMessageListItem
} from '@/api'
import {
  GlobeIcon,
  PlayIcon,
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

export function CrawlerPlaygroundPage() {
  const [openNewTab, setOpenNewTab] = useState(true)
  const [headless, setHeadless] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(30000)
  const [keepTabOpen, setKeepTabOpen] = useState(true)

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ChatGPTConversationListItem[]>([])
  
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [activeMessages, setActiveMessages] = useState<ChatGPTMessageListItem[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [sendingPrompt, setSendingPrompt] = useState(false)

  const [chromeLoading, setChromeLoading] = useState(false)
  const [chromeSuccess, setChromeSuccess] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeMessages])

  async function handleLaunchChrome() {
    setChromeLoading(true)
    setChromeSuccess(null)
    setError(null)
    try {
      const res = await openChatGPTLoginChrome()
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
    setStatus('Sniffing conversation list from chatgpt.com...')
    try {
      const res = await getChatGPTConversations({
        openNewTab,
        headless,
        timeoutMs,
        keepTabOpen
      })

      if (res.ok) {
        const list = res.output.conversations || []
        setConversations(list)
        if (selectFirst && list.length > 0) {
          handleSelectConversation(list[0].id)
        }
      } else {
        setError(res.error?.message || 'Failed to fetch conversations')
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
      const res = await getChatGPTConversationDetails(id, {
        openNewTab: false, // Re-use active tab/session
        headless,
        timeoutMs,
        keepTabOpen
      })
      if (res.ok) {
        setActiveMessages(res.output.chatMessages || [])
      } else {
        setError(res.error?.message || 'Failed to load conversation details')
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

    // Add optimistic user message to thread
    const optimisticMsg: ChatGPTMessageListItem = {
      id: 'optimistic-' + Date.now(),
      role: 'user',
      content: textToSend,
      createTime: new Date().toISOString()
    }
    setActiveMessages((prev) => [...prev, optimisticMsg])

    try {
      const res = await sendChatGPTPrompt({
        prompt: textToSend,
        conversationId: selectedChatId || undefined,
        openNewTab: false, // reuse tab
        headless,
        timeoutMs: timeoutMs + 30000, // give it extra time to generate
        keepTabOpen
      })

      if (res.ok) {
        setActiveMessages(res.output.chatMessages || [])
        // If it was a new chat, we get the resolved ID and need to refresh list
        if (!selectedChatId && res.input?.conversationId) {
          setSelectedChatId(res.input.conversationId)
        }
        // Refresh sidebar
        await handleFetchConversations()
      } else {
        setError(res.error?.message || 'Failed to send prompt')
        // Remove optimistic message on error
        setActiveMessages((prev) => prev.filter(m => m.id !== optimisticMsg.id))
      }
    } catch (e: any) {
      setError(e.message || 'Error sending prompt')
      setActiveMessages((prev) => prev.filter(m => m.id !== optimisticMsg.id))
    } finally {
      setSendingPrompt(false)
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
            ChatGPT Crawler Playground
          </h1>
          <p className='text-xs text-muted-foreground'>
            Interact with the ChatGPT CDP crawler using theheaded/headless active login profile.
          </p>
        </div>

        <div className='flex items-center gap-3'>
          <button
            onClick={handleLaunchChrome}
            disabled={chromeLoading || loading}
            className='flex items-center justify-center gap-2 py-1.5 px-3 rounded-md border border-[var(--anubis-gold)]/30 bg-[var(--anubis-gold)]/10 hover:bg-[var(--anubis-gold)]/20 text-[var(--anubis-gold)] text-xs font-semibold transition-all disabled:opacity-50'
          >
            {chromeLoading ? (
              <RefreshCwIcon className='size-3.5 animate-spin' />
            ) : (
              <ExternalLinkIcon className='size-3.5' />
            )}
            Launch Chrome Login Profile
          </button>
          <button
            onClick={() => handleFetchConversations(false)}
            disabled={loading || chromeLoading}
            className='flex items-center gap-1.5 py-1.5 px-3 rounded-md bg-gradient-to-r from-[var(--anubis-gold)] to-amber-600 hover:brightness-110 text-white text-xs font-semibold shadow transition-all disabled:opacity-50'
          >
            {loading ? (
              <RefreshCwIcon className='size-3.5 animate-spin' />
            ) : (
              <RefreshCwIcon className='size-3.5' />
            )}
            Refresh List
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

          {/* Settings panel hidden inside sidebar */}
          <div className='px-4 py-3 bg-zinc-950/20 border-b border-border/30 flex flex-col gap-2 shrink-0'>
            <div className='flex items-center justify-between text-[10px] text-muted-foreground'>
              <span>Open tab: {openNewTab ? 'Yes' : 'No'}</span>
              <span>Headless: {headless ? 'Yes' : 'No'}</span>
            </div>
            <div className='flex gap-1.5 items-center'>
              <input
                type='checkbox'
                id='openNewTab'
                checked={openNewTab}
                onChange={(e) => setOpenNewTab(e.target.checked)}
                className='rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)] size-3 bg-transparent'
              />
              <label htmlFor='openNewTab' className='text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground'>
                New Tab
              </label>
              <input
                type='checkbox'
                id='headless'
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                className='ml-3 rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)] size-3 bg-transparent'
              />
              <label htmlFor='headless' className='text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground'>
                Headless
              </label>
              <input
                type='checkbox'
                id='keepTabOpen'
                checked={keepTabOpen}
                onChange={(e) => setKeepTabOpen(e.target.checked)}
                className='ml-3 rounded border-border text-[var(--anubis-gold)] focus:ring-[var(--anubis-gold)] size-3 bg-transparent'
              />
              <label htmlFor='keepTabOpen' className='text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground'>
                Keep Tab
              </label>
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
                <span className='text-[11px]'>No conversation history sniffed yet.</span>
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
                    <span className='font-mono text-[9px] text-muted-foreground truncate w-full'>
                      {chat.id}
                    </span>
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
            /* Empty State */
            <div className='flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 bg-zinc-950/5'>
              <div className='p-4 rounded-full bg-[var(--anubis-gold)]/5 border border-[var(--anubis-gold)]/20 animate-pulse'>
                <BotIcon className='size-8 text-[var(--anubis-gold)]' />
              </div>
              <h3 className='text-sm font-semibold text-foreground'>Start a New ChatGPT Thread</h3>
              <p className='text-xs text-muted-foreground max-w-sm'>
                Type a prompt below and send it. The browser automation will open ChatGPT, submit the prompt, and display the response stream.
              </p>
            </div>
          ) : (
            /* Active Message View */
            <div className='flex-1 flex flex-col min-h-0'>
              {/* Chat thread header */}
              <div className='px-6 py-3 border-b border-border/30 bg-card/5 shrink-0 flex items-center justify-between'>
                <div className='flex flex-col gap-0.5 truncate pr-4'>
                  <span className='text-xs font-semibold text-foreground truncate'>
                    {conversations.find((c) => c.id === selectedChatId)?.title || 'Active Chat Session'}
                  </span>
                  <span className='font-mono text-[9px] text-muted-foreground truncate'>
                    ID: {selectedChatId}
                  </span>
                </div>
              </div>

              {/* Message Scroll Container */}
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
                      <div
                        key={msg.id}
                        className={`flex gap-3 max-w-[85%] ${
                          isUser ? 'self-end flex-row-reverse' : 'self-start'
                        }`}
                      >
                        {/* Avatar */}
                        <div
                          className={`size-7 rounded-full border flex items-center justify-center shrink-0 mt-0.5 shadow-sm ${
                            isUser
                              ? 'bg-[var(--anubis-gold)]/10 border-[var(--anubis-gold)]/30 text-[var(--anubis-gold)]'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                          }`}
                        >
                          {isUser ? <UserIcon className='size-3.5' /> : <BotIcon className='size-3.5' />}
                        </div>

                        {/* Content Bubble */}
                        <div className='flex flex-col gap-1'>
                          <div
                            className={`px-4 py-3 rounded-2xl text-xs leading-relaxed break-words border shadow-sm ${
                              isUser
                                ? 'bg-zinc-900/40 border-[var(--anubis-gold)]/10 text-foreground rounded-tr-none'
                                : 'bg-card border-border/40 text-foreground rounded-tl-none'
                            }`}
                          >
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
                {sendingPrompt && (
                  /* Thinking/Loading message bubble */
                  <div className='flex gap-3 max-w-[85%] self-start animate-pulse'>
                    <div className='size-7 rounded-full border bg-zinc-800 border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0 mt-0.5'>
                      <BotIcon className='size-3.5' />
                    </div>
                    <div className='flex flex-col gap-1'>
                      <div className='px-4 py-3 rounded-2xl rounded-tl-none text-xs border bg-card border-border/40 text-muted-foreground flex items-center gap-2'>
                        <Loader2Icon className='size-3 animate-spin text-[var(--anubis-gold)]' />
                        <span>ChatGPT is generating response in the browser...</span>
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
                placeholder={sendingPrompt ? 'Waiting for response...' : 'Type a prompt for ChatGPT... (Enter to send)'}
                rows={1}
                className='flex-1 border-0 bg-transparent py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none min-h-[36px] max-h-[120px]'
              />
              <button
                onClick={handleSendPrompt}
                disabled={!promptText.trim() || sendingPrompt || messagesLoading}
                className='ml-2 flex size-8 items-center justify-center rounded-md bg-gradient-to-r from-[var(--anubis-gold)] to-amber-600 hover:brightness-110 text-white transition-all duration-200 disabled:opacity-30 disabled:pointer-events-none shrink-0 shadow'
              >
                {sendingPrompt ? (
                  <RefreshCwIcon className='size-4 animate-spin' />
                ) : (
                  <SendIcon className='size-3.5 fill-current' />
                )}
              </button>
            </div>
          </div>

        </div>

      </div>
    </main>
  )
}
