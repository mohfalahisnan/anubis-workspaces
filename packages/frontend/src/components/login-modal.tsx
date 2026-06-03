import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getApiBaseUrl } from '@/api'

interface LoginModalProps {
  profileId: string
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'running' }
  | { kind: 'logged-in' }
  | { kind: 'failed'; exitCode?: number; message?: string }

export function LoginModal({ profileId, open, onClose, onSuccess }: LoginModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })

  useEffect(() => {
    if (!open || !containerRef.current) return
    let cancelled = false
    const term = new Terminal({ convertEol: true, fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    try { fit.fit() } catch { /* fit fails in jsdom */ }
    termRef.current = term

    void getApiBaseUrl().then((base) => {
      if (cancelled) return
      const wsUrl = base.replace(/^http/, 'ws') + `/profiles/${encodeURIComponent(profileId)}/login`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => setStatus({ kind: 'running' })
      ws.onmessage = (evt) => {
        try {
          const m = JSON.parse(String(evt.data)) as
            | { type: 'data'; data: string }
            | { type: 'logged-in' }
            | { type: 'exited'; exitCode: number }
            | { type: 'failed'; message: string }
          if (m.type === 'data') term.write(m.data)
          else if (m.type === 'logged-in') {
            setStatus({ kind: 'logged-in' })
            setTimeout(() => { onSuccess(); onClose() }, 800)
          } else if (m.type === 'exited') setStatus({ kind: 'failed', exitCode: m.exitCode })
          else if (m.type === 'failed') setStatus({ kind: 'failed', message: m.message })
        } catch { /* */ }
      }
      ws.onerror = () => setStatus({ kind: 'failed', message: 'connection error' })

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })
    })

    return () => {
      cancelled = true
      try { wsRef.current?.close() } catch { /* */ }
      wsRef.current = null
      term.dispose()
      termRef.current = null
    }
  }, [open, profileId, onSuccess, onClose])

  const footer = (() => {
    switch (status.kind) {
      case 'connecting': return 'Connecting to login session…'
      case 'running': return 'Waiting for login…'
      case 'logged-in': return 'Logged in — closing…'
      case 'failed': return status.exitCode != null
        ? `Login process exited (code ${status.exitCode})`
        : (status.message ?? 'Login failed')
    }
  })()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className='max-w-[860px]'>
        <DialogHeader>
          <DialogTitle>Log in to this profile</DialogTitle>
        </DialogHeader>
        <div
          ref={containerRef}
          data-testid='login-terminal'
          className='h-[420px] w-full overflow-hidden rounded-md border border-border bg-black'
        />
        <div className='font-mono text-[12px] text-muted-foreground'>{footer}</div>
      </DialogContent>
    </Dialog>
  )
}
