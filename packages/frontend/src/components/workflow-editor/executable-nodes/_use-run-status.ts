import type { NodeRunStatus } from '@/components/workflow'
import { useEditorStore } from '../editor-store'

export function useNodeRunStatus(nodeId: string): NodeRunStatus | undefined {
  return useEditorStore((s) => s.activeRun?.steps[nodeId]?.status)
}
