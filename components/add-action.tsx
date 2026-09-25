'use client'

import { PlusIcon } from './icons'
import { PRIMARY_ACTION, QUIET_ACTION } from './ui'

/**
 * The button that opens a "new record" dialog, in the two places a
 * `DataSection` puts one.
 *
 * ## Why this is a component and not a pair of class strings
 *
 * There were four of these by 25 September 2026 — user groups, templates,
 * workflow roles, and `DataSection`'s own default link — written out
 * separately, and they had drifted. Templates was the one Clinton noticed: its
 * quiet trigger was grey with no plus, so the Templates tab was the only list
 * on the site whose "add" affordance did not read as an add. Its primary
 * variant was off too, hovering to `brand-700` where every other one goes to
 * `brand-600`, and carrying no focus ring at all.
 *
 * None of that is visible in a diff — each file looked reasonable on its own.
 * It is only visible with two tabs side by side, which is how it was found.
 * So the button is one component now, and `__tests__/add-action.test.tsx`
 * fails if a list with an add affordance stops using it.
 *
 * ## The two variants are one decision, made by DataSection
 *
 * `DataSection` shows exactly one add affordance and inverts its prominence:
 * `primary` when the section is empty, because the empty state IS the call to
 * action, and `quiet` in the toolbar once there are records to compete with.
 * That reasoning lives in `data-section.tsx`; this file only draws it. The
 * plus is in both — it is the part that says "add" without being read.
 */
export function AddAction({
  label,
  onClick,
  variant = 'primary',
}: {
  /** The whole accessible name, e.g. "New template". Not a noun to prefix. */
  label: string
  onClick: () => void
  variant?: 'primary' | 'quiet'
}) {
  const quiet = variant === 'quiet'
  return (
    <button type="button" onClick={onClick} className={quiet ? QUIET_ACTION : PRIMARY_ACTION}>
      {/* Smaller in the toolbar, where it sits on a 12px label rather than a
          14px one, so the glyph and the text keep their proportion. */}
      <PlusIcon className={quiet ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      {label}
    </button>
  )
}
