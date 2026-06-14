// Qoder SDK message shapes (subset used by the runner)

export interface QoderTextDelta {
  type: 'text_delta'
  text: string
}

export interface QoderStreamEvent {
  type: 'stream_event'
  uuid: string
  session_id: string
  parent_tool_use_id: string | null
  event: {
    type: string
    index?: number
    delta?: QoderTextDelta | { type: string; partial_json?: string; thinking?: string }
    content_block?: { type: string; id?: string; name?: string }
  }
}

export interface QoderTextBlock {
  type: 'text'
  text: string
}

export interface QoderToolUseBlock {
  type: 'tool_use'
  id?: string
  name: string
  input: unknown
}

export interface QoderToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type QoderContentBlock = QoderTextBlock | QoderToolUseBlock | QoderToolResultBlock

export interface QoderAssistantMessage {
  type: 'assistant'
  uuid: string
  session_id: string
  parent_tool_use_id: string | null
  message: { role: 'assistant'; content: QoderContentBlock[] }
}

export interface QoderUserMessage {
  type: 'user'
  uuid?: string
  session_id?: string
  parent_tool_use_id: string | null
  message: { role: 'user'; content: QoderContentBlock[] }
}

export interface QoderSystemMessage {
  type: 'system'
  subtype: string
  uuid: string
  session_id: string
}

export interface QoderResultMessage {
  type: 'result'
  subtype: string // 'success' | 'error_max_turns' | 'error_during_execution'
  uuid?: string
  session_id?: string
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  result?: string
  is_error?: boolean
  errors?: string[]
}

export type QoderMessage =
  | QoderStreamEvent
  | QoderAssistantMessage
  | QoderUserMessage
  | QoderSystemMessage
  | QoderResultMessage
