import { memo } from 'react'
import { GraduationCap } from 'lucide-react'
import { NodeShell } from '@/components/workflow'
import { ACCENT_GRADIENTS } from '@/components/workflow/theme'
import { RunStateBadge } from './_run-state-badge'
import { useNodeRunStatus } from './_use-run-status'
import { useNodeRunOutput } from './_use-run-output'
import { nodeTitle, type TitledNodeData } from './_node-title'

export interface LessonWriterNodeData extends TitledNodeData {
  profileId?: string
  reasoning?: 'minimal' | 'low' | 'medium' | 'high'
  prompt?: string
  lessonType?: 'mistake' | 'lesson'
  titleTemplate?: string
}

interface LessonOutput { kind: 'lesson'; text: string }

export const LessonWriterExecutableNode = memo(function LessonWriterExecutableNode(
  { id, data }: { id: string; data: LessonWriterNodeData },
) {
  const runStatus = useNodeRunStatus(id)
  const output = useNodeRunOutput(id) as LessonOutput | undefined
  return (
    <NodeShell
      icon={GraduationCap}
      title={nodeTitle(data, 'Lesson Writer')}
      subtitle={data.profileId ? `${data.lessonType ?? 'lesson'} · ${data.profileId}` : 'Pick a profile in the inspector'}
      accent={ACCENT_GRADIENTS.review}
      runStatus={runStatus}
      footer={<RunStateBadge nodeId={id} />}
    >
      {output?.kind === 'lesson' ? (
        <p className='line-clamp-4 text-xs leading-relaxed text-muted-foreground'>{output.text}</p>
      ) : (
        <p className='text-[10px] text-muted-foreground'>Writes a lesson to anubis-core (rejected → mistake, approved → what worked).</p>
      )}
    </NodeShell>
  )
})
