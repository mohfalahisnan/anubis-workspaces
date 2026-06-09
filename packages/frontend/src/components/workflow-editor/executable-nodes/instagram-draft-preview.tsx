import { memo } from 'react'
import { Camera } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import {
  InstagramDraftPreview,
  type InstagramDraftPreviewOutput,
} from '@/components/workflow/instagram-draft-preview'
import { useNodeRunOutput } from './_use-run-output'
import { useNodeRunStatus } from './_use-run-status'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface InstagramDraftPreviewNodeData extends TitledNodeData {
  caption?: string
  mediaUrl?: string
  username?: string
  avatarUrl?: string
  likesCount?: number
  commentsCount?: number
  format?: 'post' | 'reels'
}

function previewFromData(data: InstagramDraftPreviewNodeData): InstagramDraftPreviewOutput | null {
  if (!data.mediaUrl || !data.username) return null
  return {
    kind: 'instagramDraftPreview',
    caption: data.caption ?? '',
    mediaUrl: data.mediaUrl,
    username: data.username.replace(/^@/, ''),
    ...(data.avatarUrl ? { avatarUrl: data.avatarUrl } : {}),
    ...(data.likesCount !== undefined ? { likesCount: data.likesCount } : {}),
    ...(data.commentsCount !== undefined ? { commentsCount: data.commentsCount } : {}),
    format: data.format ?? 'post',
  }
}

export const InstagramDraftPreviewExecutableNode = memo(function InstagramDraftPreviewExecutableNode(
  { id, data }: { id: string; data: InstagramDraftPreviewNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as InstagramDraftPreviewOutput | undefined
  const preview = output?.kind === 'instagramDraftPreview' ? output : previewFromData(data)

  return (
    <NodeShell
      icon={Camera}
      title={nodeTitle(data, 'Instagram Draft Preview')}
      subtitle='Final Instagram mockup before publishing'
      accent={ACCENT_GRADIENTS.media}
      handles='in'
      runStatus={runStatus}
      bleed={Boolean(preview)}
    >
      {preview ? (
        <InstagramDraftPreview preview={preview} />
      ) : (
        <p className='text-xs text-muted-foreground'>Connect draft JSON with caption, mediaUrl, and username.</p>
      )}
    </NodeShell>
  )
})
