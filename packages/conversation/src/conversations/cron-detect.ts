import type {
  CapturePostsCronConfig,
  CompetitorDiscoveryCronConfig,
  CronActionConfig,
  CronActionType,
} from '@anubis/shared'

export interface CronCreateParams {
  name: string
  schedule: string
  scheduleDescription?: string
  actionType?: CronActionType
  actionConfig?: CronActionConfig
  message?: string
}

export interface CronUpdateParams {
  name?: string
  schedule?: string
  scheduleDescription?: string
  actionType?: CronActionType
  actionConfig?: CronActionConfig
  message?: string
}

export type CronCommand =
  | { kind: 'create'; params: CronCreateParams }
  | { kind: 'update'; id: string; params: CronUpdateParams }
  | { kind: 'delete'; id: string }
  | { kind: 'list' }

const CREATE_RE = /\[CRON_CREATE\]\s*\n([\s\S]*?)\n?\[\/CRON_CREATE\]/g
const UPDATE_RE = /\[CRON_UPDATE:\s*([^\]]+)\]\s*\n([\s\S]*?)\n?\[\/CRON_UPDATE\]/g
const DELETE_RE = /\[CRON_DELETE:\s*([^\]]+)\]/g
const LIST_RE = /\[CRON_LIST\]/g

function parseKv(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const m = /^([a-z_]+)\s*:\s*(.+)$/.exec(line.trim())
    if (m) out[m[1]!] = m[2]!.trim()
  }
  return out
}

function parseActionType(raw?: string): CronActionType | undefined {
  if (!raw) return undefined
  if (raw === 'message' || raw === 'competitor-discovery' || raw === 'capture-posts') return raw
  return undefined
}

function parseActionConfig(raw: string | undefined, actionType: CronActionType | undefined): CronActionConfig | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (actionType === 'competitor-discovery' && isCompetitorDiscoveryConfig(parsed)) return parsed
    if (actionType === 'capture-posts' && isCapturePostsConfig(parsed)) return parsed
  } catch {
    return undefined
  }
  return undefined
}

function isCaptureProfile(value: unknown): value is 'public' | 'login' {
  return value === 'public' || value === 'login'
}

function isCompetitorDiscoveryConfig(value: unknown): value is CompetitorDiscoveryCronConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.projectId === 'string' &&
    typeof v.query === 'string' &&
    isCaptureProfile(v.captureProfile) &&
    (v.defaultLevel === undefined || v.defaultLevel === 'black' || v.defaultLevel === 'green' || v.defaultLevel === 'yellow' || v.defaultLevel === 'red')
  )
}

function isCapturePostsConfig(value: unknown): value is CapturePostsCronConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.projectId === 'string' &&
    (v.handles === 'all' || (Array.isArray(v.handles) && v.handles.every((item) => typeof item === 'string'))) &&
    isCaptureProfile(v.captureProfile) &&
    (v.postLimit === undefined || (Number.isInteger(v.postLimit) && Number(v.postLimit) > 0))
  )
}

function pickCreate(kv: Record<string, string>): CronCreateParams | null {
  const name = kv.name
  const schedule = kv.schedule
  const actionType = parseActionType(kv.action_type) ?? 'message'
  const actionConfig = parseActionConfig(kv.config_json, actionType)
  const message = kv.message
  if (!name || !schedule) return null
  if (actionType === 'message' && !message) return null
  if (actionType !== 'message' && !actionConfig) return null
  const out: CronCreateParams = { name, schedule }
  if (kv.schedule_description) out.scheduleDescription = kv.schedule_description
  if (actionType !== 'message') out.actionType = actionType
  if (actionConfig) out.actionConfig = actionConfig
  if (message) out.message = message
  return out
}

function pickUpdate(kv: Record<string, string>): CronUpdateParams {
  const out: CronUpdateParams = {}
  const actionType = parseActionType(kv.action_type)
  if (kv.name) out.name = kv.name
  if (kv.schedule) out.schedule = kv.schedule
  if (kv.schedule_description) out.scheduleDescription = kv.schedule_description
  if (kv.message) out.message = kv.message
  if (actionType) {
    out.actionType = actionType
    const actionConfig = parseActionConfig(kv.config_json, actionType)
    if (actionConfig) out.actionConfig = actionConfig
  }
  return out
}

export function detectCronCommands(text: string): CronCommand[] {
  const out: CronCommand[] = []
  for (const m of text.matchAll(CREATE_RE)) {
    const params = pickCreate(parseKv(m[1]!))
    if (params) out.push({ kind: 'create', params })
  }
  for (const m of text.matchAll(UPDATE_RE)) {
    out.push({ kind: 'update', id: m[1]!.trim(), params: pickUpdate(parseKv(m[2]!)) })
  }
  for (const m of text.matchAll(DELETE_RE)) {
    out.push({ kind: 'delete', id: m[1]!.trim() })
  }
  if (LIST_RE.test(text)) {
    out.push({ kind: 'list' })
  }
  return out
}
