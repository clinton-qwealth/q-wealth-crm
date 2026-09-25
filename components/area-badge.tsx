'use client'

import type { ComponentType } from 'react'
import { usePathname } from 'next/navigation'
import { KeyIcon, SparkIcon } from './icons'
import { isCurrentNavItem } from '@/lib/nav'

/**
 * The pill beside the brand mark that names the AREA you are standing in.
 *
 * It exists because the admin page gave up its heading block on 25 September
 * 2026 — the menu names the section, but nothing on the page said which area
 * of the product you were in, and the four nav links deliberately list neither
 * `/admin` nor `/help`. This is that statement, in the chrome, where it costs
 * no height. Q-Intelligence joined the same day: the knowledge-base pages are
 * the other territory reached from outside the nav's four destinations.
 *
 * ONE dress for every area — same shape, same brand tint, same weight — with
 * only the glyph and the word changing, so the pill reads as one device
 * saying different things rather than a different sticker per page. The key
 * is the glyph the account menu already uses for Administration; the spark is
 * the mark for answers.
 *
 * A client leaf inside the server header, the same arrangement as
 * `TopNavLinks` and for the same reason: knowing where you are takes the
 * pathname, and only this needs it. `isCurrentNavItem` is the top bar's own
 * segment matcher, so `/admin` and `/admin/templates/…` both count and some
 * future `/administrivia` would not.
 *
 * Brand-tinted, which the house rules allow for "small state marks": this is
 * the smallest and the most stateful, and the gradient-plus-inner-light is
 * what stops it reading as one more grey chip. Hidden below `sm`, where the
 * bar has no slack.
 */
const AREAS: { href: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { href: '/admin', label: 'Administration', icon: KeyIcon },
  { href: '/help', label: 'Q-Intelligence', icon: SparkIcon },
]

export function AreaBadge() {
  const pathname = usePathname()
  const area = AREAS.find((a) => isCurrentNavItem(pathname, a.href))
  if (!area) return null
  const Icon = area.icon

  return (
    <span
      className={[
        'hidden shrink-0 items-center gap-1.5 rounded-full sm:inline-flex',
        'border border-brand-200/80 bg-gradient-to-b from-brand-50 to-brand-100/70',
        'px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-brand-700',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.65),0_1px_2px_rgb(232_85_36/0.08)]',
      ].join(' ')}
    >
      <Icon className="h-3 w-3" />
      {area.label}
    </span>
  )
}
