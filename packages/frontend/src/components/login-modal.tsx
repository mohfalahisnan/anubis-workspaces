import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AgentNotInstalledError, getProfile, openLoginTerminal } from '@/api'
import { Loader2Icon, TerminalIcon } from 'lucide-react'

interface LoginModalProps {
  profileId: string
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type Status =
  | { kind: 'connecting'; message?: string }
  | { kind: 'running' }
  | { kind: 'logged-in' }
  | { kind: 'failed'; message: string }
  | { kind: 'not-installed'; agent: 'claude' | 'codex'; message: string }

export function LoginModal({ profileId, open, onClose, onSuccess }: LoginModalProps) {
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Keep latest callbacks in refs so the launch-terminal effect doesn't
  // re-fire (spawning extra terminals) every time the parent re-renders
  // and passes new inline arrow functions for onSuccess/onClose.
  const onSuccessRef = useRef(onSuccess)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onSuccessRef.current = onSuccess }, [onSuccess])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const triggerOpenTerminal = async () => {
    setStatus({ kind: 'connecting', message: 'Launching native terminal...' })
    try {
      await openLoginTerminal(profileId)
      setStatus({ kind: 'running' })
    } catch (e) {
      if (e instanceof AgentNotInstalledError) {
        setStatus({ kind: 'not-installed', agent: e.agent, message: e.message })
        return
      }
      setStatus({ kind: 'failed', message: e instanceof Error ? e.message : 'Could not open native terminal.' })
    }
  }

  useEffect(() => {
    if (!open) return

    void triggerOpenTerminal()

    // Start polling the profile credentials status
    const interval = setInterval(async () => {
      try {
        const profile = await getProfile(profileId)
        if (profile.home?.hasCredentials) {
          clearInterval(interval)
          setStatus({ kind: 'logged-in' })
          setTimeout(() => {
            onSuccessRef.current()
            onCloseRef.current()
          }, 800)
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000)

    pollingRef.current = interval

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
    // Intentionally only re-run when modal opens or profile changes. Callbacks
    // are read through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profileId])

  const footer = (() => {
    switch (status.kind) {
      case 'connecting':
        return status.message ?? 'Opening terminal...'
      case 'running':
        return 'Waiting for login in native terminal...'
      case 'logged-in':
        return 'Logged in — closing…'
      case 'failed':
        return status.message
      case 'not-installed':
        return status.message
    }
  })()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className='max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>Log in to profile</DialogTitle>
        </DialogHeader>
        
        <div className='flex flex-col items-center justify-center py-6 text-center'>
          <div className='flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--anubis-gold)_12%,transparent)] text-[var(--anubis-gold)]'>
            <TerminalIcon className='size-6' data-testid='login-terminal' />
          </div>

          {status.kind === 'not-installed' ? (
            <>
              <h3 className='mt-4 text-[16px] font-semibold text-foreground'>
                {status.agent === 'codex' ? 'Codex CLI' : 'Claude Code CLI'} not installed
              </h3>
              <p className='mt-2.5 max-w-[380px] text-[13.5px] leading-relaxed text-muted-foreground'>
                {status.agent === 'codex'
                  ? 'Install the Codex CLI (npm i -g @openai/codex) and make sure `codex` is on your PATH, then close and reopen this app.'
                  : 'Install Claude Code (https://docs.claude.com/claude-code) and make sure `claude` is on your PATH, then close and reopen this app.'}
              </p>
            </>
          ) : (
            <>
              <h3 className='mt-4 text-[16px] font-semibold text-foreground'>
                Native Terminal Launched
              </h3>
              <p className='mt-2.5 max-w-[380px] text-[13.5px] leading-relaxed text-muted-foreground'>
                A terminal window has been opened on your desktop to log in. Please switch to that window, complete the credentials prompt, and this screen will automatically refresh.
              </p>
            </>
          )}

          <div className='mt-6 flex items-center justify-center gap-2.5 font-mono text-[12px] text-[var(--anubis-gold)]'>
            {(status.kind === 'connecting' || status.kind === 'running') && (
              <Loader2Icon className='size-4 animate-spin' />
            )}
            <span>{footer}</span>
          </div>
        </div>

        <div className='flex justify-end gap-2.5 border-t border-border pt-4'>
          {status.kind === 'failed' && (
            <button
              type='button'
              onClick={() => void triggerOpenTerminal()}
              className='inline-flex h-9 items-center justify-center rounded-md bg-[var(--anubis-gold)] px-4 text-[13px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)] transition-colors'
            >
              Relaunch terminal
            </button>
          )}
          <button
            type='button'
            onClick={onClose}
            className='inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-4 text-[13px] font-medium text-foreground hover:bg-muted transition-colors'
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
