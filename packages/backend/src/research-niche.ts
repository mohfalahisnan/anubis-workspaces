export interface NicheItem {
  id: string
  caption: string
  competitorHandle: string
  competitorNiche?: string
}

export interface NicheVerdict {
  id: string
  aligned: boolean
  reason: string
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function buildNichePrompt(items: NicheItem[], nicheContext?: string): string {
  const lines = items.map(
    (it, i) =>
      `${i + 1}. id: ${it.id} | competitor: ${it.competitorHandle}${it.competitorNiche ? ` (${it.competitorNiche})` : ''}\n   caption: ${truncate(it.caption, 400)}`,
  )
  return [
    'Classify each competitor Instagram post below for alignment with OUR content niche.',
    '',
    'OUR NICHE (from our workspace knowledge base):',
    nicheContext && nicheContext.length > 0
      ? nicheContext
      : '(No explicit niche notes found — infer our niche from the workspace files you can read.)',
    '',
    'For EACH post, decide if its topic/content fits OUR niche, audience, and positioning.',
    'Return ONLY a JSON array of objects {"id": string, "aligned": boolean, "reason": string}.',
    'Keep reason <= 160 chars. No markdown, no extra text.',
    '',
    'POSTS:',
    ...lines,
  ].join('\n')
}

/** Pull the first JSON array out of arbitrary agent text (handles fences / prose / object wrappers). */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON array found in agent output.')
  }
  return JSON.parse(text.slice(start, end + 1))
}

export function parseNicheVerdicts(text: string, validIds: Set<string>): NicheVerdict[] {
  const arr = extractJsonArray(text)
  if (!Array.isArray(arr)) throw new Error('Niche verdict output was not a JSON array.')
  const out: NicheVerdict[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' || !validIds.has(id)) continue
    const rawAligned = (item as { aligned?: unknown }).aligned
    const aligned = rawAligned === true || rawAligned === 'true'
    const rawReason = (item as { reason?: unknown }).reason
    const reason = typeof rawReason === 'string' ? rawReason : ''
    out.push({ id, aligned, reason })
  }
  return out
}

export async function validateSessionNiche(args: {
  items: NicheItem[]
  nicheContext?: string
  ask: (prompt: string) => Promise<string>
}): Promise<NicheVerdict[]> {
  if (args.items.length === 0) return []
  const prompt = buildNichePrompt(args.items, args.nicheContext)
  const text = await args.ask(prompt)
  return parseNicheVerdicts(text, new Set(args.items.map((it) => it.id)))
}
