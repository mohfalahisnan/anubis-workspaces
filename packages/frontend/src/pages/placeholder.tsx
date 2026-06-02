import { ConstructionIcon } from 'lucide-react'

import { AnubisMark } from '@/components/brand/anubis-mark'

export function PlaceholderPage({ title, hint }: { title: string; hint: string }) {
  return (
    <div className='flex flex-1 items-center justify-center bg-background px-6 py-10'>
      <div className='flex max-w-md flex-col items-center gap-4 text-center'>
        <AnubisMark size={40} />
        <ConstructionIcon
          className='size-5 text-[var(--anubis-gold)]'
          strokeWidth={1.5}
        />
        <h2 className='text-[24px] font-semibold tracking-[-0.02em]'>{title}</h2>
        <p className='text-[14px] leading-relaxed text-muted-foreground'>{hint}</p>
      </div>
    </div>
  )
}
