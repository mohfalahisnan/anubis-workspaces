import { useEditorStore } from '../editor-store'

export function useNodeRunOutput(nodeId: string): unknown {
  return useEditorStore((s) => s.activeRun?.steps[nodeId]?.output)
}
