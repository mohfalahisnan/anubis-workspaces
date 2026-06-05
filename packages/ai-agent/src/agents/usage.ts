import type { Agent } from './catalog.js'

export interface ExtractedUsage {
  model?: string
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  remainingTokens?: number
  resetAt?: number
  raw: unknown
}

function n(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const v = Number(value)
    if (Number.isFinite(v)) return v
  }
  return 0
}

function extractCodexUsage(msg: any): ExtractedUsage {
  const u = msg?.turn?.usage ?? msg?.usage ?? {}
  const rl = msg?.turn?.rate_limits ?? msg?.rate_limits ?? null
  const input = n(u.input_tokens ?? u.prompt_tokens ?? u.inputTokens)
  const cached = n(u.cached_input_tokens ?? u.cache_read_input_tokens ?? 0)
  const output = n(u.output_tokens ?? u.completion_tokens ?? u.outputTokens)
  const reasoning = n(u.reasoning_tokens ?? 0)
  const total = n(u.total_tokens ?? input + output + reasoning)

  return {
    model: msg?.model ?? msg?.turn?.model,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: total,
    remainingTokens:
      rl?.remaining_tokens ?? rl?.remaining ?? rl?.tokens?.remaining ?? undefined,
    resetAt:
      typeof rl?.reset_at === 'number'
        ? rl.reset_at
        : typeof rl?.resets_at === 'number'
          ? rl.resets_at
          : undefined,
    raw: { usage: u, rate_limits: rl },
  }
}

function extractClaudeUsage(ev: any): ExtractedUsage {
  const u = ev?.usage ?? {}
  const input = n(u.input_tokens)
  const cached = n(u.cache_read_input_tokens ?? u.cache_creation_input_tokens)
  const output = n(u.output_tokens)
  const reasoning = n(u.thinking_tokens ?? 0)
  const total = n(input + cached + output + reasoning)

  return {
    model: ev?.model,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: total,
    raw: { usage: u },
  }
}

function extractAntigravityUsage(raw: any): ExtractedUsage {
  // `agy` serves Gemini, Claude and GPT-OSS models, so usage keys vary. Read
  // the common aliases defensively; `raw` is whatever the `done` event carried
  // (the parsed `usage` object, or the whole result object as a fallback).
  const u = raw?.usage ?? raw ?? {}
  const input = n(u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokenCount)
  const cached = n(u.cached_input_tokens ?? u.cache_read_input_tokens ?? u.cachedContentTokenCount ?? 0)
  const output = n(u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.candidatesTokenCount)
  const reasoning = n(u.reasoning_tokens ?? u.thinking_tokens ?? u.thoughtsTokenCount ?? 0)
  const total = n(u.total_tokens ?? u.totalTokenCount ?? input + cached + output + reasoning)

  return {
    model: raw?.model ?? u.model,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: total,
    raw: { usage: u },
  }
}

export function extractUsage(agent: Agent, raw: unknown): ExtractedUsage {
  switch (agent) {
    case 'codex':
      return extractCodexUsage(raw)
    case 'claude':
      return extractClaudeUsage(raw)
    case 'antigravity':
      return extractAntigravityUsage(raw)
  }
}
