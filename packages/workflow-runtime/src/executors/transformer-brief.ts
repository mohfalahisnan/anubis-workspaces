import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({ jsonTemplate: z.string() })
export type TransformerBriefConfig = z.infer<typeof ConfigSchema>

const TOKEN_RE = /\{\{([^}]+)\}\}/g

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = root
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      throw new Error(`missing path: ${path}`)
    }
    current = (current as Record<string, unknown>)[part]
    if (current === undefined) throw new Error(`missing path: ${path}`)
  }
  return current
}

function renderTemplate(template: string, upstream: Record<string, unknown>): string {
  return template.replace(TOKEN_RE, (_, raw) => {
    const path = String(raw).trim()
    const value = resolvePath(upstream, path)
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  })
}

export const transformerBriefExecutor: Executor<TransformerBriefConfig> = {
  type: 'transformerBrief',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const rendered = renderTemplate(input.config.jsonTemplate, input.upstream)
    const value = JSON.parse(rendered)
    return { kind: 'json', value }
  },
}
