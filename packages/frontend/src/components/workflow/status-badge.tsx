import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type StatusBadgeTone = 'default' | 'success' | 'warning' | 'info'

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  default: 'border-[#fd551d]/20 bg-white/5 text-zinc-300',
  success: 'border-[#22c55e]/25 bg-[#22c55e]/10 text-[#86efac]',
  warning: 'border-[#f59e0b]/25 bg-[#f59e0b]/10 text-[#fcd34d]',
  info:    'border-[#3b82f6]/25 bg-[#3b82f6]/10 text-[#93c5fd]',
}

export interface StatusBadgeProps {
  children: ReactNode
  tone?: StatusBadgeTone
  className?: string
}

export function StatusBadge({ children, tone = 'default', className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
