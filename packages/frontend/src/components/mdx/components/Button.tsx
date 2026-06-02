import { useState, type ReactNode } from 'react'
import { Button as UiButton } from '@/components/ui/button'
import { sendMessage } from '@/api'
import { useMdxConversation } from '../conversation-context'
import { cn } from '@/lib/utils'

export interface MdxButtonProps {
  send: string
  style?: 'primary' | 'secondary' | 'danger'
  children?: ReactNode
}

const VARIANT_MAP = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
} as const

export function Button({ send, style = 'primary', children }: MdxButtonProps) {
  const { conversationId } = useMdxConversation()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    try {
      await sendMessage(conversationId, send)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-1'>
      <UiButton
        size='sm'
        variant={VARIANT_MAP[style]}
        disabled={busy || done}
        onClick={onClick}
        className={cn(
          style === 'primary' &&
            'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
        )}
      >
        {children}
      </UiButton>
      {error && <span className='font-mono text-[11px] text-destructive'>{error}</span>}
    </div>
  )
}
