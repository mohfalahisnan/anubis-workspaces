import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  sourcePath: z.string().optional(),
  template: z.string().min(1),
})

export type JsonTransformerConfig = z.infer<typeof ConfigSchema>

const TOKEN_RE = /\{\{([^}]+)\}\}/g
const WHOLE_TOKEN_RE = /^\s*\{\{([^}]+)\}\}\s*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unwrapJsonEnvelope(value: unknown): unknown {
  if (isRecord(value) && value.kind === 'json' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return value.value
  }
  return value
}

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      throw new Error(`jsonTransformer: missing path: ${path}`)
    }
    if (current === undefined) throw new Error(`jsonTransformer: missing path: ${path}`)
  }
  return current
}

function stringifyForTemplate(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function renderString(template: string, scope: Record<string, unknown>): unknown {
  const whole = template.match(WHOLE_TOKEN_RE)
  if (whole) return resolvePath(scope, whole[1]!.trim())

  return template.replace(TOKEN_RE, (_, raw) => {
    const value = resolvePath(scope, String(raw).trim())
    return stringifyForTemplate(value)
  })
}

function renderTemplate(template: unknown, scope: Record<string, unknown>): unknown {
  if (typeof template === 'string') return renderString(template, scope)
  if (Array.isArray(template)) return template.map((item) => renderTemplate(item, scope))

  if (isRecord(template)) {
    if (typeof template.$map === 'string' && Object.prototype.hasOwnProperty.call(template, 'template')) {
      const rows = resolvePath(scope, template.$map)
      if (!Array.isArray(rows)) throw new Error(`jsonTransformer: $map path is not an array: ${template.$map}`)
      return rows.map((item, index) => renderTemplate(template.template, { ...scope, item, index }))
    }

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(template)) out[key] = renderTemplate(value, scope)
    return out
  }

  return template
}

function pickInput(upstream: Record<string, unknown>, sourcePath?: string): unknown {
  const scope = { upstream, ...upstream }
  if (sourcePath && sourcePath.trim()) return unwrapJsonEnvelope(resolvePath(scope, sourcePath.trim()))

  const values = Object.values(upstream)
  if (values.length === 1) return unwrapJsonEnvelope(values[0])
  return upstream
}

export const jsonTransformerExecutor: Executor<JsonTransformerConfig> = {
  type: 'jsonTransformer',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const source = pickInput(input.upstream, input.config.sourcePath)
    const parsedTemplate = JSON.parse(input.config.template)
    const value = renderTemplate(parsedTemplate, {
      input: source,
      upstream: input.upstream,
      ...input.upstream,
    })
    return { kind: 'json', value }
  },
}
