'use client'

import type { ComponentType } from 'react'
import { usePathname } from 'next/navigation'
import { GridIcon, KeyIcon, SparkIcon } from './icons'
import { isCurrentNavItem } from '@/lib/nav'

/**
 * The pill beside the brand mark that names the AREA you are standing in.
 *
 * It exists because the admin page gave up its heading block on 25 September
 * 2026 — the menu names the section, but nothing on the page said which area
 * of the product you were in, and the four nav links deliberately list neither
 * `/admin` nor `/help`. This is that statement, in the chrome, where it costs
 * no height. Q-Intelligence joined the same day for the knowledge-base pages,
 * and later that day the pill stopped being an exception at all: the ordinary
 * pages now carry CRM, so the slot beside the mark always says where you are
 * and the bar's left flank holds one width instead of two.
 *
 * ONE dress, three colourways. Same shape, weight and light in every area;
 * only the glyph, the word and the hue change, so the pill reads as one device
 * saying different things rather than a different sticker per page. The hues
 * are each deliberate:
 *
 *   - **CRM is blue** — not `sky`, which is the insurance tile's colour; the
 *     full-strength blue family was unspent.
 *   - **Q-Intelligence is purple** — not the `violet` the workflow tiles own.
 *     Adjacent on the wheel, two families apart in the palette, and this one
 *     appears only in the chrome where no tile sits beside it.
 *   - **Administration keeps the brand**, which the house rules allow for
 *     small state marks — and standing in the admin area IS a state.
 *
 * The tone strings are written out whole per area, not composed, because
 * Tailwind scans source text and a constructed `from-${hue}-50` would never
 * be generated — the same rule `Tabs` documents for its gutters.
 *
 * A client leaf inside the server header, the same arrangement as
 * `TopNavLinks` and for the same reason: knowing where you are takes the
 * pathname, and only this needs it. `isCurrentNavItem` is the top bar's own
 * segment matcher, so `/admin` and `/admin/templates/…` both count and some
 * future `/administrivia` would not — it falls through to CRM, as any path
 * outside a named territory should.
 *
 * Where and whether it shows is the BAR's decision, not this component's: the
 * top bar seats it in a fixed-width slot (which is what keeps the nav from
 * shifting between areas) and hides that slot below `sm`. A label added here
 * has to fit the slot — 144px — and the bar's comment says how to check.
 */
type Area = {
  label: string
  icon: ComponentType<{ className?: string }>
  tone: string
}

const AREAS: (Area & { href: string })[] = [
  {
    href: '/admin',
    label: 'Administration',
    icon: KeyIcon,
    tone: 'border-brand-200/80 from-brand-50 to-brand-100/70 text-brand-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.65),0_1px_2px_rgb(232_85_36/0.08)]',
  },
  {
    href: '/help',
    label: 'Q-Intelligence',
    icon: SparkIcon,
    tone: 'border-purple-200/80 from-purple-50 to-purple-100/70 text-purple-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.65),0_1px_2px_rgb(147_51_234/0.08)]',
  },
]

/** Everywhere else: the product itself. */
const CRM: Area = {
  label: 'CRM',
  icon: GridIcon,
  tone: 'border-blue-200/80 from-blue-50 to-blue-100/70 text-blue-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.65),0_1px_2px_rgb(37_99_235/0.08)]',
}

export function AreaBadge() {
  const pathname = usePathname()
  const area = AREAS.find((a) => isCurrentNavItem(pathname, a.href)) ?? CRM
  const Icon = area.icon

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-gradient-to-b',
        'px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.1em]',
        area.tone,
      ].join(' ')}
    >
      <Icon className="h-3 w-3" />
      {area.label}
    </span>
  )
}
