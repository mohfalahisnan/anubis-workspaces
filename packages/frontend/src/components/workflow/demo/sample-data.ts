import type { Edge, Node } from '@xyflow/react'

import {
  workflowEdgeDefaults,
  workflowEdgeLabelDefaults,
} from '../separated-edge'
import {
  WORKFLOW_SOURCE_HANDLE,
  WORKFLOW_TARGET_HANDLE,
} from '../handles'

import type { InstagramPostNodeData } from '../nodes/instagram-post-node'
import type { TransformerNodeData }   from '../nodes/transformer-node'
import type { TextNodeData }          from '../nodes/text-node'
import type { SearchNodeData }        from '../nodes/search-node'
import type { ContextBuilderNodeData } from '../nodes/context-builder-node'
import type { AIAgentNodeData }       from '../nodes/ai-agent-node'
import type { AgentReviewNodeData }   from '../nodes/agent-review-node'
import type { FinalContentNodeData }  from '../nodes/final-content-node'

/** Realistic fixtures — one per node type — shared by gallery and wired flow. */
export const sampleNodeData = {
  instagramPost: {
    account: '@competitor.brand',
    caption:
      'Stop creating random content. Build one repeatable content engine that converts attention into trust, then trust into sales.',
    imageUrl:
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?q=80&w=1200&auto=format&fit=crop',
    metrics: { likes: '12.8k' },
  } satisfies InstagramPostNodeData,

  postCrawler: {
    title: 'Post Crawler',
    subtitle:
      'Extracts competitor post content and sends normalized raw output to the transformer.',
    badge: 'Crawler output',
    body: 'Extracts caption, media URLs, hashtags, engagement metrics, post structure, creator metadata, CTA, timestamp, comments signal, and raw media references.',
  } satisfies TextNodeData,

  mediaOutputTransformer: {
    kind: 'media',
    title: 'Output Transformer',
    subtitle:
      'Refines crawler output and renders content as image/video objects for downstream extraction.',
    badge: 'Image / Video render',
    imageUrl:
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?q=80&w=1200&auto=format&fit=crop',
    videoUrl:
      'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    videoPoster:
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1200&auto=format&fit=crop',
  } satisfies TransformerNodeData,

  ocrTranscriptExtractor: {
    title: 'OCR / Transcript Extractor',
    subtitle: 'Extracts text from images and speech from video/reel content.',
    badge: 'Text extracted',
    body: 'Produces on-image text, scene notes, speech transcript, hook timestamps, key claims, visual framing, CTA extraction, and content pattern signals.',
  } satisfies TextNodeData,

  briefOutputTransformer: {
    kind: 'brief',
    title: 'Output Transformer',
    subtitle: 'Transforms extracted OCR/transcript data into structured content atoms for context building.',
    badge: 'Structured atoms',
    items: [
      { label: 'Core topic',       value: 'Content operations as a repeatable growth system.' },
      { label: 'Content angle',    value: 'Problem-aware educational framing with operational authority.' },
      { label: 'Reusable pattern', value: 'Problem → cost of inaction → framework → proof → CTA.' },
    ],
  } satisfies TransformerNodeData,

  brandGuideline: {
    title: 'Brand Guideline',
    subtitle: 'Additional input for context builder.',
    badge: 'Brand rules',
    body: 'Defines tone, banned claims, visual style, positioning, vocabulary, compliance constraints, and CTA boundaries.',
  } satisfies TextNodeData,

  similarityContext: {
    latency: '482ms',
    context: [
      { title: 'Similar previous post', score: '0.91',
        summary: 'Explains content workflow from competitor research to source-backed generation.' },
      { title: 'Competitor cluster', score: '0.86',
        summary: 'Market pattern shows strong response to operational content systems.' },
      { title: 'Internal offer positioning', score: '0.84',
        summary: 'Frames Anubis as orchestration layer for knowledge, competitor intelligence, and execution.' },
    ],
  } satisfies SearchNodeData,

  aiContextBuilder: {
    brief: [
      { label: 'Executor brief', source: 'crawler + transformer',
        value: 'Create content inspired by competitor structure but grounded in internal brand and offer context.' },
      { label: 'Required context', source: 'brand + KB + similarity',
        value: 'Use brand guideline, knowledge base references, previous similar posts, and content angle constraints.' },
      { label: 'Review loop rule', source: 'agent review',
        value: 'If rejected, rebuild the brief using reviewer feedback and send back to executor.' },
    ],
  } satisfies ContextBuilderNodeData,

  agentExecutor: {
    mode: 'executor',
    steps: [
      'Proceed with the approved brief from the context builder.',
      'Generate caption, carousel/reel direction, creative notes, and source-backed claims.',
      'Package draft output for agent review instead of publishing directly.',
    ],
  } satisfies AIAgentNodeData,

  agentReview: {
    checks: [
      { label: 'Brand fit',      description: 'Tone and positioning match guideline', pass: true },
      { label: 'Source support', description: 'Claims backed by context',             pass: true },
      { label: 'Originality',    description: 'Not too close to competitor',          pass: true },
      { label: 'Publish ready',  description: 'Approved path continues',              pass: true },
    ],
  } satisfies AgentReviewNodeData,

  readyToPost: {
    title: 'Post: Build a Content Engine, Not Random Posts',
    caption:
      'Most teams do not have a content problem. They have a context problem. A strong workflow connects competitor insight, internal knowledge, brand rules, and execution into one repeatable system.',
    format: 'Carousel / Reel',
    channel: 'Instagram',
    status: 'Ready',
  } satisfies FinalContentNodeData,
} as const

/** 11 nodes positioned to match the reference layout. */
export const sampleFlowNodes: Node[] = [
  { id: 'competitor-post',           type: 'instagramPost',   position: { x: 0,    y:  160 }, data: { ...sampleNodeData.instagramPost } },
  { id: 'post-crawler',              type: 'textBlock',       position: { x: 440,  y:  160 }, data: { ...sampleNodeData.postCrawler } },
  { id: 'media-output-transformer',  type: 'transformer',     position: { x: 880,  y:  160 }, data: { ...sampleNodeData.mediaOutputTransformer } },
  { id: 'ocr-transcript-extractor',  type: 'textBlock',       position: { x: 1320, y:  160 }, data: { ...sampleNodeData.ocrTranscriptExtractor } },
  { id: 'brief-output-transformer',  type: 'transformer',     position: { x: 1760, y:  160 }, data: { ...sampleNodeData.briefOutputTransformer } },
  { id: 'brand-guideline',           type: 'textBlock',       position: { x: 1760, y: -250 }, data: { ...sampleNodeData.brandGuideline } },
  { id: 'similarity-context',        type: 'contextSearch',   position: { x: 1760, y:  890 }, data: { ...sampleNodeData.similarityContext } },
  { id: 'ai-context-builder',        type: 'contextBuilder',  position: { x: 2200, y:  160 }, data: { ...sampleNodeData.aiContextBuilder } },
  { id: 'agent-executor',            type: 'aiAgent',         position: { x: 2640, y:  160 }, data: { ...sampleNodeData.agentExecutor } },
  { id: 'agent-review',              type: 'agentReview',     position: { x: 3080, y:  160 }, data: { ...sampleNodeData.agentReview } },
  { id: 'ready-to-post',             type: 'finalContent',    position: { x: 3520, y:  160 }, data: { ...sampleNodeData.readyToPost } },
]

interface EdgeSpec {
  id: string
  source: string
  target: string
  label: string
}

const EDGE_SPECS: EdgeSpec[] = [
  { id: 'e1',  source: 'competitor-post',          target: 'post-crawler',             label: 'crawl post' },
  { id: 'e2',  source: 'post-crawler',             target: 'media-output-transformer', label: 'raw output' },
  { id: 'e3',  source: 'media-output-transformer', target: 'ocr-transcript-extractor', label: 'image / video' },
  { id: 'e4',  source: 'ocr-transcript-extractor', target: 'brief-output-transformer', label: 'extracted text' },
  { id: 'e5',  source: 'brief-output-transformer', target: 'ai-context-builder',       label: 'content atoms' },
  { id: 'e6',  source: 'brand-guideline',          target: 'ai-context-builder',       label: 'brand rules' },
  { id: 'e8',  source: 'similarity-context',       target: 'ai-context-builder',       label: 'similarity' },
  { id: 'e9',  source: 'ai-context-builder',       target: 'agent-executor',           label: 'brief' },
  { id: 'e10', source: 'agent-executor',           target: 'agent-review',             label: 'draft' },
  { id: 'e11', source: 'agent-review',             target: 'ready-to-post',            label: 'approved' },
  { id: 'e12', source: 'agent-review',             target: 'ai-context-builder',       label: 'rejected: rebuild brief' },
]

export const sampleFlowEdges: Edge[] = EDGE_SPECS.map((spec) => ({
  ...workflowEdgeDefaults,
  ...workflowEdgeLabelDefaults,
  id: spec.id,
  source: spec.source,
  target: spec.target,
  sourceHandle: WORKFLOW_SOURCE_HANDLE,
  targetHandle: WORKFLOW_TARGET_HANDLE,
  label: spec.label,
}))
