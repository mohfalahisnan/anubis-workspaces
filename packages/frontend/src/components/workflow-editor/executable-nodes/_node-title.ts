export interface TitledNodeData {
  title?: string
  label?: string
  name?: string
  titleTemplate?: string
}

export function nodeTitle(data: TitledNodeData | undefined, fallback: string): string {
  const title = data?.title ?? data?.label ?? data?.name ?? data?.titleTemplate
  return title?.trim() || fallback
}
