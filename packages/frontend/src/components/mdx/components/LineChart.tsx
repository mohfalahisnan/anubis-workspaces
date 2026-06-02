export interface LineChartProps {
  data: Array<Record<string, unknown>>
  xKey: string
  yKey: string
  title?: string
}

const W = 480
const H = 220
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28
const GRID = 4

export function LineChart({ data, xKey, yKey, title }: LineChartProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className='my-3 rounded-md border border-border bg-card px-3 py-3 text-[12px] text-muted-foreground'>
        No data
      </div>
    )
  }

  const ys = data.map((d) => Number(d[yKey]) || 0)
  const yMin = Math.min(...ys, 0)
  const yMax = Math.max(...ys, yMin + 1)

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0

  function px(i: number): number {
    return PAD_L + i * stepX
  }
  function py(v: number): number {
    const t = (v - yMin) / (yMax - yMin || 1)
    return PAD_T + innerH - t * innerH
  }

  const points = data.map((_, i) => `${px(i)},${py(ys[i]!)}`).join(' ')
  const gridLines = Array.from({ length: GRID + 1 }, (_, i) => {
    const y = PAD_T + (innerH * i) / GRID
    const v = yMax - ((yMax - yMin) * i) / GRID
    return { y, v }
  })

  return (
    <div className='my-3 rounded-md border border-border bg-card p-3'>
      {title && (
        <div className='mb-2 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground'>
          {title}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className='block h-auto w-full'>
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={g.y}
              y2={g.y}
              stroke='currentColor'
              strokeOpacity={0.08}
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={g.y + 3}
              textAnchor='end'
              fontSize={10}
              fontFamily='var(--font-mono, monospace)'
              fill='currentColor'
              fillOpacity={0.55}
            >
              {formatTick(g.v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={i}
            x={px(i)}
            y={H - 8}
            textAnchor='middle'
            fontSize={10}
            fontFamily='var(--font-mono, monospace)'
            fill='currentColor'
            fillOpacity={0.55}
          >
            {String(d[xKey] ?? '')}
          </text>
        ))}
        <polyline
          points={points}
          fill='none'
          stroke='var(--anubis-gold, currentColor)'
          strokeWidth={2}
          strokeLinejoin='round'
          strokeLinecap='round'
        />
        {data.map((_, i) => (
          <circle
            key={i}
            cx={px(i)}
            cy={py(ys[i]!)}
            r={2.5}
            fill='var(--anubis-gold, currentColor)'
          />
        ))}
      </svg>
    </div>
  )
}

function formatTick(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
