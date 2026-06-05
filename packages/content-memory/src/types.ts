/** Knowledge scope. MVP supports global + workspace only. */
export type Scope = 'global' | 'workspace'

export type Platform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'linkedin'
  | 'x'
  | 'threads'
  | 'general'

export const PLATFORMS: readonly Platform[] = [
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'general',
]

/** Well-known id of the auto-created brand all legacy competitors are assigned to. */
export const DEFAULT_WORKSPACE_ID = 'default-workspace'

export type DocumentStatus = 'active' | 'archived' | 'deprecated'

export type SourceType =
  | 'brand_guideline'
  | 'competitor_post'
  | 'approved_post'
  | 'rejected_post'
  | 'campaign_brief'
  | 'manual_note'
  | 'platform_rule'
  | 'global_framework'
  | 'sop'
  | 'ai_feedback'
  | 'transcript'
  | 'ocr'
  | 'file'
