import { z } from 'zod'
import type { Executor } from '../types.js'

const OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'exists',
  'is_empty',
  'regex',
] as const

export type JsonFilterOperator = (typeof OPERATORS)[number]

const RuleSchema = z.object({
  field: z.string(),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
})

const ConfigSchema = z.object({
  sourcePath: z.string().optional(),
  matchType: z.enum(['all', 'any']).default('all'),
  rules: z.array(RuleSchema).default([]),
})

export type JsonFilterRule = z.infer<typeof RuleSchema>
export type JsonFilterConfig = z.infer<typeof ConfigSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unwrapJsonEnvelope(value: unknown): unknown {
  if (isRecord(value) && value.kind === 'json' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return value.value
  }
  return value
}

function resolvePath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      return undefined
    }
    if (current === undefined) return undefined
  }
  return current
}

/** Pick the array/object to filter from the upstream payload. */
function pickInput(upstream: Record<string, unknown>, sourcePath?: string): unknown {
  const scope = { upstream, ...upstream }
  if (sourcePath && sourcePath.trim()) return unwrapJsonEnvelope(resolvePath(scope, sourcePath.trim()))

  const values = Object.values(upstream)
  if (values.length === 1) return unwrapJsonEnvelope(values[0])
  return upstream
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.length === 0
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Numeric coercion so a rule value typed as a string ("5") matches number 5.
  const an = asNumber(a)
  const bn = asNumber(b)
  if (an !== undefined && bn !== undefined) return an === bn
  return false
}

function evalRule(record: unknown, rule: JsonFilterRule): boolean {
  const actual = resolvePath(record, rule.field)
  const expected = rule.value

  switch (rule.operator) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'is_empty':
      return isEmpty(actual)
    case 'equals':
      return looseEquals(actual, expected)
    case 'not_equals':
      return !looseEquals(actual, expected)
    case 'contains': {
      if (Array.isArray(actual)) return actual.some((item) => looseEquals(item, expected))
      if (typeof actual === 'string') return actual.includes(String(expected))
      return false
    }
    case 'not_contains': {
      if (Array.isArray(actual)) return !actual.some((item) => looseEquals(item, expected))
      if (typeof actual === 'string') return !actual.includes(String(expected))
      return true
    }
    case 'starts_with':
      return typeof actual === 'string' && actual.startsWith(String(expected))
    case 'ends_with':
      return typeof actual === 'string' && actual.endsWith(String(expected))
    case 'greater_than': {
      const a = asNumber(actual)
      const b = asNumber(expected)
      return a !== undefined && b !== undefined && a > b
    }
    case 'greater_than_or_equal': {
      const a = asNumber(actual)
      const b = asNumber(expected)
      return a !== undefined && b !== undefined && a >= b
    }
    case 'less_than': {
      const a = asNumber(actual)
      const b = asNumber(expected)
      return a !== undefined && b !== undefined && a < b
    }
    case 'less_than_or_equal': {
      const a = asNumber(actual)
      const b = asNumber(expected)
      return a !== undefined && b !== undefined && a <= b
    }
    case 'regex': {
      if (typeof actual !== 'string') return false
      try {
        return new RegExp(String(expected)).test(actual)
      } catch {
        throw new Error(`jsonFilter: invalid regex: ${String(expected)}`)
      }
    }
    default:
      return false
  }
}

function matchesRecord(record: unknown, config: JsonFilterConfig): boolean {
  if (config.rules.length === 0) return true
  if (config.matchType === 'any') {
    return config.rules.some((rule) => evalRule(record, rule))
  }
  return config.rules.every((rule) => evalRule(record, rule))
}

export const jsonFilterExecutor: Executor<JsonFilterConfig> = {
  type: 'jsonFilter',
  validateConfig(raw) {
    return ConfigSchema.parse(raw ?? {})
  },
  async run(input) {
    const source = pickInput(input.upstream, input.config.sourcePath)
    // Normalise to an array of records: a single object is treated as a 1-element list.
    const items = Array.isArray(source) ? source : source === undefined ? [] : [source]
    const filteredArray = items.filter((item) => matchesRecord(item, input.config))
    return { kind: 'json', value: filteredArray }
  },
}
