import type { ReactNode } from 'react'

export function Buttons({ children }: { children?: ReactNode }) {
  return <div className='mt-3 flex flex-wrap gap-2'>{children}</div>
}
