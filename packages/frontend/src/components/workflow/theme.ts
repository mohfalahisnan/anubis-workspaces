export const WORKFLOW_ACCENT = '#fd551d'

export const ACCENT_GRADIENTS = {
  default: 'from-[#fd551d] to-[#ff9b7a]',
  media:   'from-[#fd551d] to-[#8b5cf6]',
  data:    'from-[#fd551d] to-[#3b82f6]',
  review:  'from-[#fd551d] to-[#22c55e]',
  warning: 'from-[#fd551d] to-[#f59e0b]',
  final:   'from-[#fd551d] via-[#ff7a45] to-[#fefefe]',
} as const

export type AccentKey = keyof typeof ACCENT_GRADIENTS
