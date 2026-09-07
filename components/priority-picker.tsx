'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PRIORITIES, type Priority } from '@/lib/workflow-board'
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
 * Proper menu semantics — `menu` / `menuitemradio` with `aria-checked` — so a
 * screen reader hears "Priority: Medium, button" and then a radio-style list,
 * rather than four anonymous buttons. Escape closes it, as does clicking
 * anywhere else. The current level is checked so the user knows what they are
 * changing from.
 *
 * One popover per card, not one shared dialog, because a popover is a few
 * <button>s rendered only while open — nothing sits in the document when it is
 * closed, which is the problem a shared dialog exists to avoid.
 */
export function PriorityPicker({
  value,
  onChange,
  name,
}: {
  value: Priority
  onChange: (next: Priority) => void
  /** The card's name, for the accessible label. */
  name: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const label = PRIORITIES.find((p) => p.id === value)!.label

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Priority: ${label}. Change priority of ${name}`}
        title={`Priority: ${label}`}
        onClick={() => setOpen((o) => !o)}
        // Stop a press from starting a drag of the card behind it.
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-6 w-6 items-center justify-center rounded-md outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <PriorityGlyph priority={value} />
      </button>

      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={`Priority of ${name}`}
          className="absolute left-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
        >
          {PRIORITIES.map((p) => {
            const current = p.id === value
            return (
              <li key={p.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  onClick={() => {
                    setOpen(false)
                    if (!current) onChange(p.id)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-neutral-100 focus-visible:bg-neutral-100 ${
                    current ? 'font-medium text-neutral-900' : 'text-neutral-700'
                  }`}
                >
                  <PriorityGlyph priority={p.id} />
                  {p.label}
                  {current ? <span className="ml-auto text-[10px] uppercase tracking-wider text-neutral-400">now</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
