import { z } from 'zod'
import type { Executor } from '../types.js'

const FormatSchema = z.enum(['post', 'reels'])

const ConfigSchema = z.object({
  caption: z.string().optional(),
  mediaUrl: z.string().optional(),
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
  likesCount: z.number().int().nonnegative().optional(),
  commentsCount: z.number().int().nonnegative().optional(),
  format: FormatSchema.optional(),
})

export type InstagramDraftPreviewConfig = z.infer<typeof ConfigSchema>

export interface InstagramDraftPreviewOutput {
  kind: 'instagramDraftPreview'
  caption: string
  mediaUrl: string
  username: string
  avatarUrl?: string
  likesCount?: number
  commentsCount?: number
  format: 'post' | 'reels'
}

type DraftPreviewFields = Omit<InstagramDraftPreviewOutput, 'kind'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unwrapJsonEnvelope(value: unknown): unknown {
  if (isRecord(value) && value.kind === 'json' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return value.value
  }
  return value
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''))
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }
  return undefined
}

function formatField(value: unknown): 'post' | 'reels' | undefined {
  return value === 'post' || value === 'reels' ? value : undefined
}

function firstStringFromArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (isRecord(item) && typeof item.path === 'string' && item.path.trim()) return item.path.trim()
    if (isRecord(item) && typeof item.url === 'string' && item.url.trim()) return item.url.trim()
  }
  return undefined
}

function applyRecord(fields: Partial<DraftPreviewFields>, value: Record<string, unknown>): void {
  const post = isRecord(value.post) ? value.post : undefined
  const metrics = isRecord(value.metrics) ? value.metrics : isRecord(post?.metrics) ? post.metrics : undefined
  const assetPaths = isRecord(post?.assetPaths) ? post.assetPaths : undefined

  fields.caption =
    textField(value.caption) ??
    textField(value.text) ??
    textField(post?.caption) ??
    fields.caption

  fields.mediaUrl =
    textField(value.mediaUrl) ??
    textField(value.mediaPath) ??
    textField(value.path) ??
    textField(value.url) ??
    firstStringFromArray(value.mediaUrls) ??
    firstStringFromArray(value.mediaPaths) ??
    firstStringFromArray(value.paths) ??
    firstStringFromArray(value.urls) ??
    firstStringFromArray(post?.mediaPaths) ??
    firstStringFromArray(post?.mediaUrls) ??
    firstStringFromArray(assetPaths?.absolute) ??
    fields.mediaUrl

  fields.username =
    textField(value.username) ??
    textField(value.author) ??
    textField(value.handle) ??
    textField(post?.username) ??
    fields.username

  fields.avatarUrl =
    textField(value.avatarUrl) ??
    textField(value.avatar) ??
    textField(post?.avatarUrl) ??
    fields.avatarUrl

  fields.likesCount =
    numberField(value.likesCount) ??
    numberField(value.likes) ??
    numberField(metrics?.likes) ??
    fields.likesCount

  fields.commentsCount =
    numberField(value.commentsCount) ??
    numberField(value.comments) ??
    numberField(metrics?.comments) ??
    fields.commentsCount

  fields.format = formatField(value.format) ?? fields.format
}

function mergeUpstream(config: InstagramDraftPreviewConfig, upstream: Record<string, unknown>): Partial<DraftPreviewFields> {
  const fields: Partial<DraftPreviewFields> = {
    caption: config.caption,
    mediaUrl: config.mediaUrl,
    username: config.username,
    avatarUrl: config.avatarUrl,
    likesCount: config.likesCount,
    commentsCount: config.commentsCount,
    format: config.format ?? 'post',
  }

  for (const raw of Object.values(upstream)) {
    const value = unwrapJsonEnvelope(raw)
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) || /^[a-z]:[\\/]/i.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
        fields.mediaUrl = value
      } else {
        fields.caption = value
      }
      continue
    }
    if (Array.isArray(value)) {
      fields.mediaUrl = firstStringFromArray(value) ?? fields.mediaUrl
      continue
    }
    if (isRecord(value)) applyRecord(fields, value)
  }

  return fields
}

export const instagramDraftPreviewExecutor: Executor<InstagramDraftPreviewConfig> = {
  type: 'instagramDraftPreview',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input): Promise<InstagramDraftPreviewOutput> {
    const fields = mergeUpstream(input.config, input.upstream)
    if (!fields.mediaUrl) throw new Error('instagramDraftPreview: mediaUrl is required')
    if (!fields.username) throw new Error('instagramDraftPreview: username is required')

    return {
      kind: 'instagramDraftPreview',
      caption: fields.caption ?? '',
      mediaUrl: fields.mediaUrl,
      username: fields.username.replace(/^@/, ''),
      ...(fields.avatarUrl ? { avatarUrl: fields.avatarUrl } : {}),
      ...(fields.likesCount !== undefined ? { likesCount: fields.likesCount } : {}),
      ...(fields.commentsCount !== undefined ? { commentsCount: fields.commentsCount } : {}),
      format: fields.format ?? 'post',
    }
  },
}
