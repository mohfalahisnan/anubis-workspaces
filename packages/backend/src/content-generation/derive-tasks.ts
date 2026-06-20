import type { GenerationCapability, GenerationTaskStatus, GenerationTaskType, RefinedContent, VisualBrief } from '@anubis/shared'

/** Reserved generation-profile value selecting manual (prompt-only) media generation. */
export const MANUAL_PROFILE_ID = 'manual'

export interface ManualMediaFlags {
  image?: boolean
  video?: boolean
}

export interface TaskSpec {
  type: GenerationTaskType
  capability: GenerationCapability
  inputPrompt: string
  status: GenerationTaskStatus
}

export const TASK_CAPABILITY: Record<GenerationTaskType, GenerationCapability> = {
  final_caption: 'text',
  final_hashtags: 'text',
  text_overlay: 'text',
  image: 'image',
  carousel: 'image',
  video: 'video',
  audio: 'audio',
  voiceover: 'voiceover',
}

export function buildImagePrompt(v: VisualBrief, slideCopy?: string): string {
  const parts = [
    v.concept,
    v.sceneDirection,
    `Subject: ${v.subject}`,
    `Layout: ${v.layout}`,
    `Mood: ${v.mood}`,
    `Style: ${v.style}`,
    v.keyElements.length ? `Key elements: ${v.keyElements.join(', ')}` : '',
    v.textOverlay ? `Text overlay: ${v.textOverlay}` : '',
    slideCopy ? `Slide: ${slideCopy}` : '',
    v.negativeDirection ? `Avoid: ${v.negativeDirection}` : '',
  ]
  return parts.filter(Boolean).join('. ')
}

function spec(type: GenerationTaskType, inputPrompt: string, status: GenerationTaskStatus = 'pending'): TaskSpec {
  return { type, capability: TASK_CAPABILITY[type], inputPrompt, status }
}

export function deriveTasks(
  refined: RefinedContent,
  mediaKind: 'image' | 'video' | 'carousel' | undefined,
  manual: ManualMediaFlags = {},
): TaskSpec[] {
  const tasks: TaskSpec[] = []

  // Text — carry-forward from the refined content.
  tasks.push(spec('final_caption', refined.caption))
  const hashtags = [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
  tasks.push(spec('final_hashtags', hashtags.join(' ')))

  const overlay = refined.visualBrief.textOverlay ?? refined.copywriting.textOverlay
  if (overlay) tasks.push(spec('text_overlay', overlay))

  // Visual. When the project opted out of auto-generation (`manual.image`), derive the
  // media task as `manual` so it surfaces the prompt but never runs a generator.
  const imageStatus: GenerationTaskStatus = manual.image ? 'manual' : 'pending'
  if (mediaKind === 'carousel') {
    const slides = refined.copywriting.carouselSlides?.length ? refined.copywriting.carouselSlides : ['']
    for (const slide of slides) tasks.push(spec('carousel', buildImagePrompt(refined.visualBrief, slide), imageStatus))
  } else {
    tasks.push(spec('image', buildImagePrompt(refined.visualBrief), imageStatus))
  }

  // Video is generatable via the hyperframes agent generator unless opted out; voiceover stays manual.
  if (mediaKind === 'video') tasks.push(spec('video', refined.copywriting.videoScript ?? refined.visualBrief.concept, manual.video ? 'manual' : 'pending'))
  if (refined.copywriting.videoScript) tasks.push(spec('voiceover', refined.copywriting.videoScript, 'manual'))

  return tasks
}
