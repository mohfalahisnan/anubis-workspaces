import { type SVGProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * The Anubis monogram — a geometric jackal silhouette built from a
 * sharp triangle + an oval ear. Used as the app mark in the sidebar,
 * splash, and any brand surface.
 *
 * Defaults to the brand gold (`--anubis-gold`). Pass `className` or
 * inline `style.color` to override (the SVG paints with `currentColor`).
 *
 * See `brand-identity.html` for the canonical artwork.
 */
export function AnubisMark({
  className,
  size,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 32 32'
      width={size}
      height={size}
      role='img'
      aria-label='Anubis'
      className={cn('text-[var(--anubis-gold)]', className)}
      {...props}
    >
      <g fill='currentColor'>
        <path d='M8 13 L12.2 10.6 L29 15.8 L29 18.2 L16 19 L12 26.5 L9 26.5 Z' />
        <ellipse
          cx='10.4'
          cy='7.2'
          rx='2.8'
          ry='5.7'
          transform='rotate(16 10.4 7.2)'
        />
      </g>
    </svg>
  )
}
