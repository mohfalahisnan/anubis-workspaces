import type { Db } from '../client.js'
import type { Artifact } from '../../conversations/types.js'

interface Row {
  id: string
  conversation_id: string
  message_id: string | null
  kind: string
  tool_name: string
  call_id: string
  input: string | null
  output: string | null
  status: string
  created_at: number
  updated_at: number
}

function toArt(r: Row): Artifact {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id ?? undefined,
    kind: r.kind as 'tool_call',
    toolName: r.tool_name,
    callId: r.call_id,
    input: r.input ? JSON.parse(r.input) : undefined,
    output: r.output ? JSON.parse(r.output) : undefined,
    status: r.status as Artifact['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ArtifactsRepo {
  constructor(private db: Db) {}

  insert(a: Artifact): void {
    this.db.prepare(`
      INSERT INTO artifacts (id, conversation_id, message_id, kind, tool_name, call_id, input, output, status, created_at, updated_at)
      VALUES (@id, @conversationId, @messageId, @kind, @toolName, @callId, @input, @output, @status, @createdAt, @updatedAt)
    `).run({
      id: a.id, conversationId: a.conversationId, messageId: a.messageId ?? null,
      kind: a.kind, toolName: a.toolName, callId: a.callId,
      input: a.input === undefined ? null : JSON.stringify(a.input),
      output: a.output === undefined ? null : JSON.stringify(a.output),
      status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt,
    })
  }

  updateResult(callId: string, conversationId: string, output: unknown, status: Artifact['status']): void {
    this.db.prepare(`
      UPDATE artifacts SET output = ?, status = ?, updated_at = ? WHERE call_id = ? AND conversation_id = ?
    `).run(JSON.stringify(output ?? null), status, Date.now(), callId, conversationId)
  }

  listForConversation(conversationId: string): Artifact[] {
    const rows = this.db.prepare(
      'SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at ASC',
    ).all(conversationId) as Row[]
    return rows.map(toArt)
  }

  findById(id: string): Artifact | null {
    const r = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined
    return r ? toArt(r) : null
  }
}
