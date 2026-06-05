import { Handle, Position } from '@xyflow/react'

export const WORKFLOW_TARGET_HANDLE = 'in-main'
export const WORKFLOW_SOURCE_HANDLE = 'out-main'

const HANDLE_CLASS =
  '!h-9 !w-9 !rounded-full !border-2 !border-[#0b0b0c] !bg-[#fd551d] !shadow-xl !shadow-black/50 !z-20 ' +
  'flex items-center justify-center text-[9px] font-bold tracking-[0.08em] text-white'

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
