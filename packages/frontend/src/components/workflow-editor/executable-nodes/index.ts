import type { NodeTypes } from '@xyflow/react'
import { InstagramPostExecutableNode }          from './instagram-post'
import { TransformerMediaExecutableNode }       from './transformer-media'
import { TransformerBriefExecutableNode }       from './transformer-brief'
import { JsonTransformerExecutableNode }        from './json-transformer'
import { OcrExtractorExecutableNode }           from './ocr-extractor'
import { TableExecutableNode }                  from './table'
import { ImageVideoExecutableNode }             from './image-video'
import { AiAgentConversationExecutableNode }    from './ai-agent-conversation'
import { HumanApprovalExecutableNode }          from './human-approval'
import { LessonWriterExecutableNode }           from './lesson-writer'
import { MarkdownDisplayExecutableNode }        from './markdown-display'
import { MediaDisplayExecutableNode }           from './media-display'
import { OriginalCopyExecutableNode }           from './original-copy'
import { ScheduleTriggerExecutableNode }        from './schedule-trigger'
import { FileWatchTriggerExecutableNode }       from './file-watch-trigger'
import { SavePlannerExecutableNode }            from './save-planner'

export const executableNodeTypes: NodeTypes = {
  instagramPost:       InstagramPostExecutableNode as never,
  transformerMedia:    TransformerMediaExecutableNode as never,
  transformerBrief:    TransformerBriefExecutableNode as never,
  jsonTransformer:     JsonTransformerExecutableNode as never,
  ocrExtractor:        OcrExtractorExecutableNode as never,
  table:               TableExecutableNode as never,
  imageVideo:          ImageVideoExecutableNode as never,
  aiAgentConversation: AiAgentConversationExecutableNode as never,
  humanApproval:       HumanApprovalExecutableNode as never,
  lessonWriter:        LessonWriterExecutableNode as never,
  markdownDisplay:     MarkdownDisplayExecutableNode as never,
  mediaDisplay:        MediaDisplayExecutableNode as never,
  originalCopy:        OriginalCopyExecutableNode as never,
  scheduleTrigger:     ScheduleTriggerExecutableNode as never,
  fileWatchTrigger:    FileWatchTriggerExecutableNode as never,
  savePlanner:         SavePlannerExecutableNode as never,
}

/**
 * Palette categories, ordered as they appear in the sidebar. Nodes are grouped
 * by capability: where data comes from (Trigger, Source, Web Search), what
 * transforms it (Tools, Agent), and where it ends up (Output).
 */
export const NODE_CATEGORIES = [
  'trigger',
  'source',
  'webSearch',
  'tools',
  'agent',
  'output',
] as const

export type NodeCategory = (typeof NODE_CATEGORIES)[number]

export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger:   'Trigger',
  source:    'Source',
  webSearch: 'Web Search',
  tools:     'Tools',
  agent:     'Agent',
  output:    'Output',
}

export const NODE_PALETTE = [
  { type: 'scheduleTrigger',     label: 'Schedule',               category: 'trigger'   },
  { type: 'fileWatchTrigger',    label: 'File watcher',           category: 'trigger'   },
  { type: 'imageVideo',          label: 'Image / Video',          category: 'source'    },
  { type: 'transformerMedia',    label: 'Transformer · Media',    category: 'source'    },
  { type: 'instagramPost',       label: 'Instagram Post',         category: 'webSearch' },
  { type: 'transformerBrief',    label: 'Transformer · Brief',    category: 'tools'     },
  { type: 'jsonTransformer',     label: 'JSON Transformer',       category: 'tools'     },
  { type: 'ocrExtractor',        label: 'OCR Extractor',          category: 'tools'     },
  { type: 'aiAgentConversation', label: 'AI Agent · Conversation', category: 'agent'    },
  { type: 'humanApproval',       label: 'Human Review',           category: 'agent'    },
  { type: 'lessonWriter',        label: 'Lesson Writer',          category: 'agent'    },
  { type: 'table',               label: 'Table',                  category: 'output'    },
  { type: 'markdownDisplay',     label: 'Markdown',               category: 'output'    },
  { type: 'mediaDisplay',        label: 'Media',                  category: 'output'    },
  { type: 'originalCopy',        label: 'Original Copy',          category: 'output'    },
  { type: 'savePlanner',         label: 'Save to Content Planner', category: 'output'   },
] as const satisfies ReadonlyArray<{ type: string; label: string; category: NodeCategory }>
