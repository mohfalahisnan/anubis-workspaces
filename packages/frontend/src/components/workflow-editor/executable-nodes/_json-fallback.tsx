export function JsonFallback({ value }: { value: unknown }) {
  let pretty: string
  try {
    pretty = JSON.stringify(value, null, 2)
  } catch {
    pretty = String(value)
  }
  return (
    <div className='mt-3 max-h-[180px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-2'>
      <pre className='whitespace-pre-wrap break-words text-[10px] text-zinc-300'>{pretty}</pre>
    </div>
  )
}
