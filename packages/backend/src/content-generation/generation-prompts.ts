import type { GenerationPromptDefaults, RefinedContent, VisualBrief } from '@anubis/shared'
import { renderPrompt } from '../content-pipeline/prompts.js'

/** Shipped default generation-prompt templates (editable per-project in Pipeline Settings). */
export const DEFAULT_GENERATION_TEMPLATES: GenerationPromptDefaults = {
  image: [
    '{{concept}}',
    '{{sceneDirection}}',
    'Subject: {{subject}}',
    'Layout: {{layout}}',
    'Mood: {{mood}}',
    'Style: {{style}}',
    'Key elements: {{keyElements}}',
    'Text overlay: {{textOverlay}}',
    'Slide: {{slide}}',
    'Avoid: {{negativeDirection}}',
  ].join('\n'),
  video: '{{videoScript}}',
}

/** Render an image/carousel generation prompt from the Refine step's visual brief. */
export function renderImagePrompt(template: string, v: VisualBrief, slide = ''): string {
  return renderPrompt(template, {
    concept: v.concept,
    sceneDirection: v.sceneDirection,
    subject: v.subject,
    layout: v.layout,
    mood: v.mood,
    style: v.style,
    keyElements: v.keyElements.join(', '),
    textOverlay: v.textOverlay ?? '',
    slide,
    negativeDirection: v.negativeDirection ?? '',
  }).trim()
}

/** Render a video generation prompt; videoScript falls back to the visual concept. */
export function renderVideoPrompt(template: string, refined: RefinedContent): string {
  return renderPrompt(template, {
    videoScript: refined.copywriting.videoScript || refined.visualBrief.concept,
    concept: refined.visualBrief.concept,
  }).trim()
}
