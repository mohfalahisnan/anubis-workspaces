import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'

const TYPE_LABELS: Record<string, string> = {
  instagramPost: 'IG Post',
  imageVideo: 'Image / Video',
  transformerMedia: 'Transform · Media',
  transformerBrief: 'Transform · Brief',
  ocrExtractor: 'OCR',
  table: 'Table',
  aiAgentConversation: 'AI Agent',
  jsonTransformer: 'JSON',
  markdownDisplay: 'Markdown',
  humanApproval: 'Human Review',
  lessonWriter: 'Lesson',
  originalCopy: 'Original Copy',
  savePlanner: 'Save to Content Planner',
  outputCapturer: 'Output Capturer',
}

const TYPE_DOTS: Record<string, string> = {
  instagramPost: 'bg-[#ff6b35]',
  imageVideo: 'bg-[#ff9b7a]',
  transformerMedia: 'bg-[#ff9b7a]',
  transformerBrief: 'bg-[#fd551d]',
  ocrExtractor: 'bg-[#22c55e]',
  table: 'bg-[#22c55e]',
  aiAgentConversation: 'bg-white',
  jsonTransformer: 'bg-[#22c55e]',
  markdownDisplay: 'bg-[#d9a441]',
  humanApproval: 'bg-[#d9a441]',
  lessonWriter: 'bg-[#d9a441]',
  originalCopy: 'bg-[#22c55e]',
  savePlanner: 'bg-[#22c55e]',
  outputCapturer: 'bg-[#22c55e]',
}

interface PreviewNodeData {
  title?: string
  label?: string
  name?: string
  titleTemplate?: string
  type?: string
}

function titleFromData(data: PreviewNodeData | undefined, type?: string): string {
  const configured = data?.title ?? data?.label ?? data?.name ?? data?.titleTemplate
  return configured?.trim() || TYPE_LABELS[type ?? ''] || type || 'Node'
}

export const PreviewNode = memo(function PreviewNode({ type, data }: { type?: string; data?: PreviewNodeData }) {
  const label = titleFromData(data, type)
  const dot = TYPE_DOTS[type ?? ''] ?? 'bg-zinc-400'
  return (
    <>
      <Handle type='target' position={Position.Left} className='!h-1 !w-1 !border-0 !bg-transparent' isConnectable={false} />
      <div className='flex items-center gap-1.5 rounded-md border border-white/15 bg-[#161617]/95 px-2 py-1 shadow-md shadow-black/40 text-[9px] text-white'>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className='truncate'>{label}</span>
      </div>
      <Handle type='source' position={Position.Right} className='!h-1 !w-1 !border-0 !bg-transparent' isConnectable={false} />
    </>
  )
})
