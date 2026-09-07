'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export type MenuOption<T extends string> = { id: T; label: string; glyph?: ReactNode }

/**
 * A control that opens a single-choice menu — the machinery behind the priority
 * glyph and the status pill.
 *
 * Extracted 7 September when the status became editable, rather than copied.
 * The accessibility here is the whole reason: `menu` with `menuitemradio` and
 * `aria-checked`, so a screen reader hears the current value and then a
 * radio-style list rather than a row of anonymous buttons; Escape closes it; so
 * does a click anywhere else. Two copies of that would drift, and the half that
 * drifted would be the half nobody was testing.
 *
 * The menu is rendered only while open, so nothing sits in the document when it
 * is closed — the problem a shared dialog exists to avoid, and the reason each
 * card can safely have its own.
 *
 * Callers own the look: `trigger` is what the button shows and
 * `triggerClassName` is how it is shaped, because a glyph button and a pill are
 * not the same object.
 */
export function MenuPicker<T extends string>({
  value,
  options,
  onChange,
  trigger,
  triggerAriaLabel,
  triggerTitle,
  menuAriaLabel,
  triggerClassName = '',
  menuClassName = 'w-40',
}: {
  value: T
  options: readonly MenuOption<T>[]
  onChange: (next: T) => void
  /** What the button shows when closed. */
  trigger: ReactNode
  triggerAriaLabel: string
  triggerTitle?: string
  menuAriaLabel: string
  triggerClassName?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

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
        aria-label={triggerAriaLabel}
        title={triggerTitle}
        onClick={() => setOpen((o) => !o)}
        // Stop a press from starting a drag of the card behind it.
        onPointerDown={(e) => e.stopPropagation()}
        className={`flex items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/30 ${triggerClassName}`}
      >
        {trigger}
      </button>

      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={menuAriaLabel}
          className={`absolute left-0 top-full z-20 mt-1 ${menuClassName} overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)]`}
        >
          {options.map((o) => {
            const current = o.id === value
            return (
              <li key={o.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  onClick={() => {
                    setOpen(false)
                    if (!current) onChange(o.id)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-neutral-100 focus-visible:bg-neutral-100 ${
                    current ? 'font-medium text-neutral-900' : 'text-neutral-700'
                  }`}
                >
                  {o.glyph}
                  {o.label}
                  {current ? (
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-neutral-400">
                      now
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
