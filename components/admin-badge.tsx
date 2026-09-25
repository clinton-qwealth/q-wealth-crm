'use client'

import { usePathname } from 'next/navigation'
import { KeyIcon } from './icons'
import { isCurrentNavItem } from '@/lib/nav'

/**
 * The pill beside the brand mark that says you are in Administration.
 *
 * It exists because the admin page gave up its heading block on 25 September
 * 2026 — the menu names the section, but nothing on the page said which AREA
 * of the product you were standing in, and the four nav links deliberately do
 * not list `/admin`. This is that statement, in the chrome, where it costs no
 * height.
 *
 * A client leaf inside the server header, the same arrangement as
 * `TopNavLinks` and for the same reason: knowing where you are takes the
 * pathname, and only this needs it. `isCurrentNavItem` is the top bar's own
 * segment matcher, so `/admin` and `/admin/templates/…` both count and some
 * future `/administrivia` would not.
 *
 * The key is the glyph the account menu already uses for Administration —
 * one association, spent twice. Brand-tinted, which the house rules allow for
 * "small state marks": this is the smallest and the most stateful, and the
 * gradient-plus-inner-light is what stops it reading as one more grey chip.
 * Hidden below `sm`, where the bar has no slack; the page itself still says
 * where you are through its `sr-only` heading and the menu.
 */
export function AdminBadge() {
  const pathname = usePathname()
  if (!isCurrentNavItem(pathname, '/admin')) return null

  return (
    <span
      className={[
        'hidden shrink-0 items-center gap-1.5 rounded-full sm:inline-flex',
        'border border-brand-200/80 bg-gradient-to-b from-brand-50 to-brand-100/70',
        'px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-brand-700',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.65),0_1px_2px_rgb(232_85_36/0.08)]',
      ].join(' ')}
    >
      <KeyIcon className="h-3 w-3" />
      Administration
    </span>
  )
}
