import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['low', 'medium', 'high']),
  prompt: z.string(),
})

export type AiAgentConfig = z.infer<typeof ConfigSchema>

/**
 * Cap on the total context block we embed in the prompt. The Claude CLI on
 * Windows is invoked via cmd.exe, which caps the full command line at 8191
 * characters. Long Instagram CDN URLs (1–2 KB each, dozens per carousel)
 * trivially blow past that.
 */
const MAX_CONTEXT_CHARS = 6000
const MAX_STRING_CHARS = 2000
/** Field names we always strip from the context — never useful to the LLM and
 * always huge (signed image URLs, raw HTTP response bodies, etc.). */
const NOISY_FIELDS = new Set(['mediaUrls', 'mediaUrl', 'raw', 'rawJson', 'imageBase64', 'videoUrl'])

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s
  return `${s.slice(0, limit)}… [truncated, ${s.length - limit} more chars]`
}

/** Walk the upstream bag and produce a slimmed, prompt-safe version. */
function slimForPrompt(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return truncate(value, MAX_STRING_CHARS)
  if (typeof value !== 'object') return value
  if (depth > 6) return '[truncated: nested too deep]'
  if (Array.isArray(value)) {
    if (value.length > 20) {
      return [
        ...value.slice(0, 20).map((v) => slimForPrompt(v, depth + 1)),
        `… [${value.length - 20} more items truncated]`,
      ]
    }
    return value.map((v) => slimForPrompt(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (NOISY_FIELDS.has(k)) {
      // Replace with a small marker so the LLM knows the field existed.
      if (Array.isArray(v)) out[k] = `[${v.length} URLs omitted]`
      else if (typeof v === 'string') out[k] = '[omitted to keep prompt under CLI length limit]'
      else out[k] = '[omitted]'
      continue
    }
    out[k] = slimForPrompt(v, depth + 1)
  }
  return out
}

export function buildContextBlock(upstream: Record<string, unknown>): string {
  const slimmed = slimForPrompt(upstream)
  const block = JSON.stringify(slimmed, null, 2)
  return truncate(block, MAX_CONTEXT_CHARS)
}

export const aiAgentExecutor: Executor<AiAgentConfig> = {
  type: 'aiAgent',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const upstreamBlock = buildContextBlock(input.upstream)
    const composedPrompt = `<context>\n${upstreamBlock}\n</context>\n\n${input.config.prompt}`
    const result = await ctx.agent.run({
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      prompt: composedPrompt,
    })
    return { kind: 'text', text: result.text }
  },
}
