export interface AnubisEnvelope {
  text: string
  data?: unknown
  paths?: string[]
}

// Match the contents of the LAST ```anubis-output ... ``` block. The /g flag
// is needed for repeated `exec` calls; we walk all matches and keep the last.
const FENCE_RE = /```anubis-output\s*\n([\s\S]*?)```/g

export function parseEnvelope(reply: string): AnubisEnvelope {
  let match: RegExpExecArray | null
  let lastJson: string | undefined
  // Reset lastIndex so the function is safe to call repeatedly.
  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(reply)) !== null) lastJson = match[1]
  if (lastJson === undefined) {
    return { text: reply.trim() }
  }
  try {
    const parsed = JSON.parse(lastJson) as Record<string, unknown>
    return {
      text: typeof parsed.text === 'string' ? parsed.text : reply.trim(),
      data: 'data' in parsed ? parsed.data : undefined,
      paths: Array.isArray(parsed.paths)
        ? parsed.paths.filter((p): p is string => typeof p === 'string')
        : undefined,
    }
  } catch {
    return { text: reply.trim() }
  }
}
