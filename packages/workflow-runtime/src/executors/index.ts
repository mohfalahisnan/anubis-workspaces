import type { Executor } from '../types.js'
import { tableExecutor }                from './table.js'
import { transformerBriefExecutor }     from './transformer-brief.js'
import { instagramPostExecutor }        from './instagram-post.js'
import { transformerMediaExecutor }     from './transformer-media.js'
import { ocrExtractorExecutor }         from './ocr-extractor.js'
import { imageVideoExecutor }           from './image-video.js'
import { aiAgentConversationExecutor }  from './ai-agent-conversation.js'

export const executorRegistry: Record<string, Executor<unknown>> = {
  table:                tableExecutor as Executor<unknown>,
  transformerBrief:     transformerBriefExecutor as Executor<unknown>,
  instagramPost:        instagramPostExecutor as Executor<unknown>,
  transformerMedia:     transformerMediaExecutor as Executor<unknown>,
  ocrExtractor:         ocrExtractorExecutor as Executor<unknown>,
  imageVideo:           imageVideoExecutor as Executor<unknown>,
  aiAgentConversation:  aiAgentConversationExecutor as Executor<unknown>,
}

export type ExecutorKey = keyof typeof executorRegistry

export {
  tableExecutor, transformerBriefExecutor,
  instagramPostExecutor, transformerMediaExecutor, ocrExtractorExecutor,
  imageVideoExecutor, aiAgentConversationExecutor,
}
