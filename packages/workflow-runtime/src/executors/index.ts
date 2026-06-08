import type { Executor } from '../types.js'
import { tableExecutor }                from './table.js'
import { transformerBriefExecutor }     from './transformer-brief.js'
import { jsonTransformerExecutor }      from './json-transformer.js'
import { instagramPostExecutor }        from './instagram-post.js'
import { transformerMediaExecutor }     from './transformer-media.js'
import { ocrExtractorExecutor }         from './ocr-extractor.js'
import { imageVideoExecutor }           from './image-video.js'
import { aiAgentConversationExecutor }  from './ai-agent-conversation.js'
import { humanApprovalExecutor }        from './human-approval.js'
import { lessonWriterExecutor }         from './lesson-writer.js'
import { markdownDisplayExecutor }      from './markdown-display.js'
import { mediaDisplayExecutor }         from './media-display.js'
import { originalCopyExecutor }         from './original-copy.js'
import { scheduleTriggerExecutor }      from './schedule-trigger.js'
import { fileWatchTriggerExecutor }     from './file-watch-trigger.js'
import { savePlannerExecutor }          from './save-planner.js'

export const executorRegistry: Record<string, Executor<unknown>> = {
  table:                tableExecutor as Executor<unknown>,
  transformerBrief:     transformerBriefExecutor as Executor<unknown>,
  jsonTransformer:      jsonTransformerExecutor as Executor<unknown>,
  instagramPost:        instagramPostExecutor as Executor<unknown>,
  transformerMedia:     transformerMediaExecutor as Executor<unknown>,
  ocrExtractor:         ocrExtractorExecutor as Executor<unknown>,
  imageVideo:           imageVideoExecutor as Executor<unknown>,
  aiAgentConversation:  aiAgentConversationExecutor as Executor<unknown>,
  humanApproval:        humanApprovalExecutor as Executor<unknown>,
  lessonWriter:         lessonWriterExecutor as Executor<unknown>,
  markdownDisplay:      markdownDisplayExecutor as Executor<unknown>,
  mediaDisplay:         mediaDisplayExecutor as Executor<unknown>,
  originalCopy:         originalCopyExecutor as Executor<unknown>,
  scheduleTrigger:      scheduleTriggerExecutor as Executor<unknown>,
  fileWatchTrigger:     fileWatchTriggerExecutor as Executor<unknown>,
  savePlanner:          savePlannerExecutor as Executor<unknown>,
}

export type ExecutorKey = keyof typeof executorRegistry

export {
  tableExecutor, transformerBriefExecutor, jsonTransformerExecutor,
  instagramPostExecutor, transformerMediaExecutor, ocrExtractorExecutor,
  imageVideoExecutor, aiAgentConversationExecutor,
  humanApprovalExecutor, lessonWriterExecutor,
  markdownDisplayExecutor, mediaDisplayExecutor, originalCopyExecutor,
  scheduleTriggerExecutor, fileWatchTriggerExecutor, savePlannerExecutor,
}
