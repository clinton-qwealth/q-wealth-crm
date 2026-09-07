'use client'

import type { ReactNode } from 'react'
import { PRIORITIES, type Priority } from '@/lib/workflow-board'
import { MenuPicker } from './menu-picker'
import { ChevronDownIcon } from './icons'
import {
  PriorityHighIcon,
  PriorityLowIcon,
  PriorityMediumIcon,
  PriorityUrgentIcon,
} from './icons'

/**
 * Colour says the level as well as the glyph, so it reads at card size.
 * Medium is neutral on purpose: it is the default, and a coloured default
 * would make every unprioritised card shout. Only the three deliberate levels
 * carry a hue — cool for low, warm for high, red for urgent.
 *
 * Every tone clears 3:1 on white, the floor for a non-text control. Medium
 * was first set at neutral-400 for quietness and measured 2.58:1 — a glyph
 * that fails the floor is a glyph some people cannot see. neutral-500 is
 * 4.6:1 and still the quietest of the four.
 */
const PRIORITY_STYLE: Record<Priority, { icon: (p: { className?: string }) => ReactNode; tone: string }> = {
  low: { icon: PriorityLowIcon, tone: 'text-sky-600' },
  medium: { icon: PriorityMediumIcon, tone: 'text-neutral-500' },
  high: { icon: PriorityHighIcon, tone: 'text-amber-600' },
  urgent: { icon: PriorityUrgentIcon, tone: 'text-red-600' },
}

export function PriorityGlyph({ priority, className = 'h-4 w-4' }: { priority: Priority; className?: string }) {
  const { icon: Icon, tone } = PRIORITY_STYLE[priority]
  return (
    <span className={`inline-flex ${tone}`}>
      <Icon className={className} />
    </span>
  )
}

/**
 * A glyph that is a button; pressing it opens a menu of the four levels.
 *
 * The menu itself is MenuPicker — see there for the accessibility, which is the
 * reason it is shared with the status control rather than copied.
 *
 * `withLabel` puts the level in words beside the glyph. Cards use the glyph
 * alone, because at card size the colour and shape carry it and the row has no
 * room. The workflow detail page uses both: it is a page about one workflow, so
 * the reader should not have to know the glyphs to read it.
 */
export function PriorityPicker({
  value,
  onChange,
  name,
  withLabel = false,
}: {
  value: Priority
  onChange: (next: Priority) => void
  /** The workflow's name, for the accessible label. */
  name: string
  withLabel?: boolean
}) {
  const label = PRIORITIES.find((p) => p.id === value)!.label
  return (
    <MenuPicker
      value={value}
      options={PRIORITIES.map((p) => ({
        id: p.id,
        label: p.label,
        glyph: <PriorityGlyph priority={p.id} />,
      }))}
      onChange={onChange}
      trigger={
        withLabel ? (
          /* The chevron is here for one reason: next to a status pill that
             carries one, a bare glyph and a word read as a caption rather than
             a control. Cards keep the bare glyph — there is no editable
             neighbour there to be inconsistent with, and no room. */
          <span className="flex items-center gap-1.5">
            <PriorityGlyph priority={value} className="h-3.5 w-3.5" />
            <span className="text-xs text-neutral-700">{label}</span>
            <ChevronDownIcon className="-ml-0.5 h-3 w-3 text-neutral-400" />
          </span>
        ) : (
          <PriorityGlyph priority={value} />
        )
      }
      triggerAriaLabel={`Priority: ${label}. Change priority of ${name}`}
      triggerTitle={`Priority: ${label}`}
      menuAriaLabel={`Priority of ${name}`}
      triggerClassName={
        withLabel
          ? 'h-6 rounded-md px-1.5 hover:bg-neutral-100'
          : 'h-6 w-6 rounded-md hover:bg-neutral-100'
      }
      menuClassName="w-36"
    />
  )
}
