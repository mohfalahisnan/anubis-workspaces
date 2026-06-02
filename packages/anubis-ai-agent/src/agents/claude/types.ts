export type StreamLine =
  | { type: 'system'; subtype: string; session_id?: string }
  | { type: 'assistant'; message: { content: ContentBlock[] } }
  | { type: 'user'; message: { content: ContentBlock[] } }
  | {
      type: 'result'
      subtype: string
      session_id?: string
      total_cost_usd?: number
      usage?: { input_tokens: number; output_tokens: number }
      model?: string
    }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
