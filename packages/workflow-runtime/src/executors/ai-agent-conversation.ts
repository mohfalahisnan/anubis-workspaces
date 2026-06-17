import { z } from 'zod'
import type { Executor } from '../types.js'
import { parseEnvelope } from './_envelope.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  prompt: z.string().min(1),
  titleTemplate: z.string().optional(),
})

export type AiAgentConversationConfig = z.infer<typeof ConfigSchema>

interface FileShape {
  paths?: string[]
  mediaPaths?: string[]
  kind?: string
  path?: string
}

function collectFiles(value: unknown): string[] {
  if (value == null || typeof value !== 'object') return []
  const v = value as FileShape
  const out: string[] = []
  if (Array.isArray(v.paths)) out.push(...v.paths.filter((p) => typeof p === 'string'))
  if (Array.isArray(v.mediaPaths)) out.push(...v.mediaPaths.filter((p) => typeof p === 'string'))
  if (v.kind === 'file' && typeof v.path === 'string') out.push(v.path)
  return out
}

/**
 * Per-downstream-type contract describing what `data` the next node expects.
 * The AI sees this in the <output-spec> block and adapts its output.
 * Add an entry when adding a new executor; the registry stays small enough
 * to inline. Unknown types fall back to DEFAULT_CONTRACT.
 */
const DOWNSTREAM_CONTRACTS: Record<string, string> = {
  transformerBrief:
    'Populate `data` with the keys the next node\'s JSON template references via {{thisNode.data.key}}. Always include `text`.',
  aiAgentConversation:
    '`text` is folded into the next AI\'s context block. `paths` are attached as files. `data` is JSON-stringified into the next node\'s context.',
  aiReviewGate:
    'A reviewer reads your output. Put the content to be judged in `data` and a readable summary in `text`.',
  transformerMedia:
    'Populate `data` with the media-transformer input shape. Include `paths` for any file artifacts you produced.',
  table:
    'Populate `data` with an array of row objects matching the table input schema.',
  ocrExtractor:
    'Populate `paths` with absolute image paths to OCR. Include `text` to describe what you produced.',
  transcriber:
    'Populate `paths` with absolute audio or video paths to transcribe. Include `text` to describe what you produced.',
  instagramPost:
    '(rare downstream) — emit the standard envelope; instagramPost is usually a source node.',
  imageVideo:
    '(rare downstream) — emit the standard envelope; imageVideo is usually a source node.',
}

const DEFAULT_CONTRACT =
  'Emit the standard envelope. Downstream may consume `text` or `data`; include any file outputs in `paths`.'

function buildWorkflowContext(
  runId: string,
  nodeId: string,
  downstream: ReadonlyArray<{ nodeId: string; type: string }>,
): string {
  const annotated = downstream.map((d) => ({
    nodeId: d.nodeId,
    type: d.type,
    contract: DOWNSTREAM_CONTRACTS[d.type] ?? DEFAULT_CONTRACT,
  }))
  const payload = { runId, nodeId, downstream: annotated }
  return `<workflow-context>\n${JSON.stringify(payload, null, 2)}\n</workflow-context>`
}

function buildOutputSpec(
  downstream: ReadonlyArray<{ nodeId: string; type: string }>,
): string {
  const seenTypes = new Set<string>()
  const contractLines: string[] = []
  for (const d of downstream) {
    if (seenTypes.has(d.type)) continue
    seenTypes.add(d.type)
    const contract = DOWNSTREAM_CONTRACTS[d.type] ?? DEFAULT_CONTRACT
    contractLines.push(`- ${d.type}: ${contract}`)
  }
  if (contractLines.length === 0) {
    contractLines.push(`- (no downstream): ${DEFAULT_CONTRACT}`)
  }
  return [
    '<output-spec>',
    'End your reply with EXACTLY ONE fenced block:',
    '```anubis-output',
    '{ "text": "human-readable answer", "data": { /* optional, see contract below */ }, "paths": [/* optional absolute file paths */] }',
    '```',
    'Prose before the block is fine — it shows in the chat. Only the contents of the last `anubis-output` block are passed downstream.',
    '',
    'Downstream contracts (adapt `data` to match):',
    ...contractLines,
    '</output-spec>',
  ].join('\n')
}

function composeMessage(
  upstream: Record<string, unknown>,
  prompt: string,
  runId: string,
  nodeId: string,
  downstream: ReadonlyArray<{ nodeId: string; type: string }>,
): string {
  const contextBlocks: string[] = []
  const files: string[] = []
  for (const [src, value] of Object.entries(upstream)) {
    files.push(...collectFiles(value))
    contextBlocks.push(`<context source="${src}">\n${JSON.stringify(value, null, 2)}\n</context>`)
  }
  const parts: string[] = [
    buildWorkflowContext(runId, nodeId, downstream),
    buildOutputSpec(downstream),
  ]
  if (contextBlocks.length > 0) parts.push(contextBlocks.join('\n'))
  if (files.length > 0) parts.push(`Attached files:\n${files.map((p) => `- ${p}`).join('\n')}`)
  parts.push(prompt)
  return parts.join('\n\n')
}

export const aiAgentConversationExecutor: Executor<AiAgentConversationConfig> = {
  type: 'aiAgentConversation',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const content = composeMessage(
      input.upstream,
      input.config.prompt,
      ctx.runId,
      input.nodeId,
      input.downstream,
    )
    const title = input.config.titleTemplate ?? `Workflow · ${input.nodeId}`
    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
      source: 'workflow',
      workflow: { runId: ctx.runId, nodeId: input.nodeId },
    })
    const envelope = parseEnvelope(result.text)
    return {
      kind: 'aiAgent',
      conversationId: result.conversationId,
      messageId: result.messageId,
      text: envelope.text,
      data: envelope.data,
      paths: envelope.paths,
    }
  },
}
