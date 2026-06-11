import { describe, it, expect } from 'vitest'
import { navItems } from '@/components/dashboard/data'
import { itemRoute } from '@/components/dashboard/sidebar'

describe('sidebar itemRoute', () => {
  // Every sidebar nav item must navigate to its OWN page. A missing case in
  // itemRoute's switch silently falls through to `{ page: 'home' }`, which makes
  // the item appear in the sidebar but open the Dashboard instead.
  it.each(navItems.map((i) => [i.page, i.label] as const))(
    'routes the "%s" item (%s) to its own page',
    (page) => {
      const item = navItems.find((i) => i.page === page)!
      expect(itemRoute(item).page).toBe(page)
    },
  )
})
