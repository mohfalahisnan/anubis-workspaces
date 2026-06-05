import type { Executor } from '../types.js'
import { tableExecutor }                from './table.js'
import { transformerBriefExecutor }     from './transformer-brief.js'
import { instagramPostExecutor }        from './instagram-post.js'
import { transformerMediaExecutor }     from './transformer-media.js'
import { ocrExtractorExecutor }         from './ocr-extractor.js'
import { imageVideoExecutor }           from './image-video.js'
import { aiAgentConversationExecutor }  from './ai-agent-conversation.js'
import { markdownDisplayExecutor }      from './markdown-display.js'
import { mediaDisplayExecutor }         from './media-display.js'
import { scheduleTriggerExecutor }      from './schedule-trigger.js'
import { fileWatchTriggerExecutor }     from './file-watch-trigger.js'

export const executorRegistry: Record<string, Executor<unknown>> = {
  table:                tableExecutor as Executor<unknown>,
  transformerBrief:     transformerBriefExecutor as Executor<unknown>,
  instagramPost:        instagramPostExecutor as Executor<unknown>,
  transformerMedia:     transformerMediaExecutor as Executor<unknown>,
  ocrExtractor:         ocrExtractorExecutor as Executor<unknown>,
  imageVideo:           imageVideoExecutor as Executor<unknown>,
  aiAgentConversation:  aiAgentConversationExecutor as Executor<unknown>,
  markdownDisplay:      markdownDisplayExecutor as Executor<unknown>,
  mediaDisplay:         mediaDisplayExecutor as Executor<unknown>,
  scheduleTrigger:      scheduleTriggerExecutor as Executor<unknown>,
  fileWatchTrigger:     fileWatchTriggerExecutor as Executor<unknown>,
}

export type ExecutorKey = keyof typeof executorRegistry

export {
  tableExecutor, transformerBriefExecutor,
  instagramPostExecutor, transformerMediaExecutor, ocrExtractorExecutor,
  imageVideoExecutor, aiAgentConversationExecutor,
  markdownDisplayExecutor, mediaDisplayExecutor,
  scheduleTriggerExecutor, fileWatchTriggerExecutor,
}
