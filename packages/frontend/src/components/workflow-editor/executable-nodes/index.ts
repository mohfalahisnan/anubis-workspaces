import type { NodeTypes } from '@xyflow/react'
import { AiAgentExecutableNode }          from './ai-agent'
import { InstagramPostExecutableNode }    from './instagram-post'
import { TransformerMediaExecutableNode } from './transformer-media'
import { TransformerBriefExecutableNode } from './transformer-brief'
import { OcrExtractorExecutableNode }     from './ocr-extractor'
import { TableExecutableNode }            from './table'
import { ImageVideoExecutableNode }       from './image-video'

export const executableNodeTypes: NodeTypes = {
  aiAgent:          AiAgentExecutableNode as never,
  instagramPost:    InstagramPostExecutableNode as never,
  transformerMedia: TransformerMediaExecutableNode as never,
  transformerBrief: TransformerBriefExecutableNode as never,
  ocrExtractor:     OcrExtractorExecutableNode as never,
  table:            TableExecutableNode as never,
  imageVideo:       ImageVideoExecutableNode as never,
}

export const NODE_PALETTE = [
  { type: 'aiAgent',          label: 'AI Agent' },
  { type: 'instagramPost',    label: 'Instagram Post' },
  { type: 'imageVideo',       label: 'Image / Video' },
  { type: 'transformerMedia', label: 'Transformer · Media' },
  { type: 'transformerBrief', label: 'Transformer · Brief' },
  { type: 'ocrExtractor',     label: 'OCR Extractor' },
  { type: 'table',            label: 'Table' },
] as const
