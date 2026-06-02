import type { Db } from '../client.js'
import type { Message } from '../../conversations/types.js'

interface Row {
  id: string
  conversation_id: string
  msg_id: string
  role: string
  content: string
  metadata: string | null
  created_at: number
}

function toMsg(r: Row): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    msgId: r.msg_id,
    role: r.role as Message['role'],
    content: r.content,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.created_at,
  }
}

export class MessagesRepo {
  constructor(private db: Db) {}

  insert(m: Message): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, msg_id, role, content, metadata, created_at)
      VALUES (@id, @conversationId, @msgId, @role, @content, @metadata, @createdAt)
    `).run({
      id: m.id, conversationId: m.conversationId, msgId: m.msgId, role: m.role,
      content: m.content, metadata: m.metadata ? JSON.stringify(m.metadata) : null,
      createdAt: m.createdAt,
    })
  }

  upsertAssistant(m: Message): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, msg_id, role, content, metadata, created_at)
      VALUES (@id, @conversationId, @msgId, @role, @content, @metadata, @createdAt)
      ON CONFLICT(id) DO UPDATE SET content=excluded.content, metadata=excluded.metadata
    `).run({
      id: m.id, conversationId: m.conversationId, msgId: m.msgId, role: m.role,
      content: m.content, metadata: m.metadata ? JSON.stringify(m.metadata) : null,
      createdAt: m.createdAt,
    })
  }

  listForConversation(conversationId: string, limit = 200): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
    `).all(conversationId, limit) as Row[]
    return rows.map(toMsg)
  }

  findById(id: string): Message | null {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    return r ? toMsg(r) : null
  }
}
