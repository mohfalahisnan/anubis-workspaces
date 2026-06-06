import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'

export const WORKFLOW_TARGET_HANDLE = 'in-main'
export const WORKFLOW_SOURCE_HANDLE = 'out-main'

const HANDLE_CLASS =
  '!h-9 !w-9 !rounded-full !border-2 !border-background !bg-primary !shadow-xl !shadow-black/40 !z-20 ' +
  'flex items-center justify-center text-[9px] font-bold tracking-[0.08em] text-primary-foreground'

interface NodeHandleProps {
  type: 'target' | 'source'
  position: Position
  id: string
  label: string
}

function NodeHandle({ type, position, id, label }: NodeHandleProps) {
  return (
    <Handle id={id} type={type} position={position} className={HANDLE_CLASS}>
      <span className='pointer-events-none select-none leading-none'>{label}</span>
    </Handle>
  )
}

/**
 * Handles for the Human Review node: one input, plus two labelled outputs.
 * The source-handle ids MUST be exactly `approved` / `rejected` — the runtime
 * scheduler activates the branch whose `sourceHandle` equals the decision.
 */
export function ApprovalHandles() {
  return (
    <>
      <Handle id={WORKFLOW_TARGET_HANDLE} type='target' position={Position.Left} className={HANDLE_CLASS}>
        <span className='pointer-events-none select-none leading-none'>IN</span>
      </Handle>
      <Handle id='approved' type='source' position={Position.Right} className={cn(HANDLE_CLASS, '!bg-anubis-success')}>
        <span className='pointer-events-none select-none leading-none'>OK</span>
      </Handle>
      <Handle id='rejected' type='source' position={Position.Bottom} className={cn(HANDLE_CLASS, '!bg-destructive')}>
        <span className='pointer-events-none select-none leading-none'>NO</span>
      </Handle>
    </>
  )
}

export type HandleVariant = 'both' | 'in' | 'out'

export function NodeDirectionalHandles({ variant = 'both' }: { variant?: HandleVariant } = {}) {
  return (
    <>
      {variant !== 'out' ? (
        <NodeHandle type='target' position={Position.Left}  id={WORKFLOW_TARGET_HANDLE} label='IN' />
      ) : null}
      {variant !== 'in' ? (
        <NodeHandle type='source' position={Position.Right} id={WORKFLOW_SOURCE_HANDLE} label='OUT' />
      ) : null}
    </>
  )
}
