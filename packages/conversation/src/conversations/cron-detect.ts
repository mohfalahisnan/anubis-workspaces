export interface CronCreateParams {
  name: string
  schedule: string
  scheduleDescription?: string
  message: string
}

export interface CronUpdateParams {
  name?: string
  schedule?: string
  scheduleDescription?: string
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

function pickCreate(kv: Record<string, string>): CronCreateParams | null {
  const name = kv.name, schedule = kv.schedule, message = kv.message
  if (!name || !schedule || !message) return null
  const out: CronCreateParams = { name, schedule, message }
  if (kv.schedule_description) out.scheduleDescription = kv.schedule_description
  return out
}

function pickUpdate(kv: Record<string, string>): CronUpdateParams {
  const out: CronUpdateParams = {}
  if (kv.name) out.name = kv.name
  if (kv.schedule) out.schedule = kv.schedule
  if (kv.schedule_description) out.scheduleDescription = kv.schedule_description
  if (kv.message) out.message = kv.message
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
