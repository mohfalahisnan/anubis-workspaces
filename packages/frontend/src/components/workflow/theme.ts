export const WORKFLOW_ACCENT = 'var(--anubis-gold)'

/**
 * Node header accent strips. The Anubis brand is black & gold, so every accent
 * is anchored on the gold family; only state-flavoured strips (review/success)
 * lean on the brand state colours. All values are Tailwind utilities backed by
 * the theme tokens in `index.css`, so they track light/dark automatically.
 */
export const ACCENT_GRADIENTS = {
  default: 'from-anubis-gold to-anubis-gold-hi',
  media:   'from-anubis-gold-deep to-anubis-gold-hi',
  data:    'from-anubis-gold to-anubis-gold-deep',
  review:  'from-anubis-gold to-anubis-success',
  warning: 'from-anubis-gold-deep to-anubis-gold-hi',
  final:   'from-anubis-gold-deep via-anubis-gold to-anubis-gold-hi',
} as const

export type AccentKey = keyof typeof ACCENT_GRADIENTS
