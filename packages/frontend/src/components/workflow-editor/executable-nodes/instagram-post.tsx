import { memo } from 'react'
import { NodeShell, StatusBadge } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { FileThumb } from '@/components/workflow/file-thumb'
import { nodeTitle, type TitledNodeData } from './_node-title'

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='3' y='3' width='18' height='18' rx='5' />
      <circle cx='12' cy='12' r='4' />
      <circle cx='17.5' cy='6.5' r='0.8' fill='currentColor' stroke='none' />
    </svg>
  )
}

export interface InstagramPostNodeData extends TitledNodeData {
  source?: 'existing' | 'url'
  postId?: string
  url?: string
}

interface InstagramPostOutput {
  kind: 'instagramPost'
  post: {
    id: string
    caption?: string
    mediaPaths: string[]
    mediaErrors?: string[]
    metrics?: { likes?: number; comments?: number }
  }
}

function ResultSection({ output }: { output: InstagramPostOutput }) {
  const post = output.post
  return (
    <div className='mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-2'>
      {post.mediaPaths.length > 0 ? (
        <div className={`grid gap-2 ${post.mediaPaths.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {post.mediaPaths.slice(0, 4).map((p) => (
            <FileThumb key={p} path={p} />
          ))}
        </div>
      ) : null}
      {post.caption ? (
        <p className='line-clamp-3 text-xs leading-relaxed text-muted-foreground'>{post.caption}</p>
      ) : null}
      {(post.metrics || post.mediaErrors) ? (
        <div className='flex flex-wrap gap-2 text-[10px] text-muted-foreground'>
          {post.metrics?.likes != null && <span>♥ {post.metrics.likes}</span>}
          {post.metrics?.comments != null && <span>💬 {post.metrics.comments}</span>}
          {post.mediaErrors && post.mediaErrors.length > 0 && (
            <span className='text-[#d99412]'>⚠ {post.mediaErrors.length} media error{post.mediaErrors.length > 1 ? 's' : ''}</span>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const InstagramPostExecutableNode = memo(function InstagramPostExecutableNode({ id, data }: { id: string; data: InstagramPostNodeData }) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as InstagramPostOutput | undefined
  return (
    <NodeShell
      icon={InstagramIcon}
      title={nodeTitle(data, 'Instagram Post')}
      subtitle={data.source === 'url' ? data.url ?? 'No URL' : data.postId ? `Captured: ${data.postId}` : 'No source selected'}
      accent={ACCENT_GRADIENTS.default}
      runStatus={runStatus}
      footer={
        <div className='flex flex-wrap gap-2'>
          <StatusBadge tone='info'>{data.source ?? 'unset'}</StatusBadge>
          <RunStateBadge nodeId={id} />
        </div>
      }
    >
      <p className='text-xs text-muted-foreground'>{data.source === 'url' ? 'Captures via research-crawler' : 'Reads from captured_posts table'}</p>
      {output?.kind === 'instagramPost' ? <ResultSection output={output} /> : null}
    </NodeShell>
  )
})
