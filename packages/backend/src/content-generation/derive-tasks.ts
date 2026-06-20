import type { GenerationCapability, GenerationPromptConfig, GenerationTaskStatus, GenerationTaskType, RefinedContent } from '@anubis/shared'
import { DEFAULT_GENERATION_TEMPLATES, renderImagePrompt, renderVideoPrompt } from './generation-prompts.js'

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

function spec(type: GenerationTaskType, inputPrompt: string, status: GenerationTaskStatus = 'pending'): TaskSpec {
  return { type, capability: TASK_CAPABILITY[type], inputPrompt, status }
}

export function deriveTasks(
  refined: RefinedContent,
  mediaKind: 'image' | 'video' | 'carousel' | undefined,
  manual: ManualMediaFlags = {},
  prompts: GenerationPromptConfig = {},
): TaskSpec[] {
  const tasks: TaskSpec[] = []

  // Text — carry-forward from the refined content.
  tasks.push(spec('final_caption', refined.caption))
  const hashtags = [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
  tasks.push(spec('final_hashtags', hashtags.join(' ')))

  const overlay = refined.visualBrief.textOverlay ?? refined.copywriting.textOverlay
  if (overlay) tasks.push(spec('text_overlay', overlay))

  // Visual. The prompt comes from the per-project template (or the shipped default),
  // rendered with the Refine step's visual brief. `manual.*` marks the task prompt-only.
  const imageTpl = prompts.image ?? DEFAULT_GENERATION_TEMPLATES.image
  const videoTpl = prompts.video ?? DEFAULT_GENERATION_TEMPLATES.video
  const imageStatus: GenerationTaskStatus = manual.image ? 'manual' : 'pending'
  if (mediaKind === 'carousel') {
    const slides = refined.copywriting.carouselSlides?.length ? refined.copywriting.carouselSlides : ['']
    for (const slide of slides) tasks.push(spec('carousel', renderImagePrompt(imageTpl, refined.visualBrief, slide), imageStatus))
  } else {
    tasks.push(spec('image', renderImagePrompt(imageTpl, refined.visualBrief), imageStatus))
  }

  // Video via the hyperframes agent generator unless opted out; voiceover stays manual.
  if (mediaKind === 'video') tasks.push(spec('video', renderVideoPrompt(videoTpl, refined), manual.video ? 'manual' : 'pending'))
  if (refined.copywriting.videoScript) tasks.push(spec('voiceover', refined.copywriting.videoScript, 'manual'))

  return tasks
}
