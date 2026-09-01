'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type TabItem = {
  id: string
  label: string
  panel: ReactNode
}

/**
 * Tabs following the ARIA tabs pattern, with an underline that slides between
 * them.
 *
 * Roving tabindex: only the selected tab is reachable by Tab, and the arrow keys
 * move between them — so a keyboard user tabs once to reach the tablist, then
 * arrows across, rather than tabbing through every tab to get past it. Home and
 * End jump to the ends.
 *
 * The indicator is one absolutely-positioned bar whose offset and width are
 * measured from the active tab, rather than a border toggled per tab — a border
 * cannot animate between elements. Measured in a layout effect so it is
 * positioned before paint, and re-measured on resize and on font load, both of
 * which change tab widths after the first measurement.
 */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  // Suppresses the transition for the very first measurement, so the bar does
  // not slide in from the left edge on load. Derived rather than held in its own
  // state: a zero width *is* "not yet measured", so a second state variable would
  // only be a chance for the two to disagree — and setting it in the layout
  // effect meant an extra render pass on every mount.
  const measured = indicator.width > 0

  const listRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const measure = useCallback(() => {
    const i = items.findIndex((t) => t.id === active)
    const el = tabRefs.current[i]
    if (!el) return
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [active, items])

  useLayoutEffect(measure, [measure])

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const observer = new ResizeObserver(measure)
    observer.observe(list)
    for (const el of tabRefs.current) if (el) observer.observe(el)

    // Web fonts land after first paint and change text width.
    document.fonts?.ready.then(measure).catch(() => {})

    return () => observer.disconnect()
  }, [measure])

  function onKeyDown(e: React.KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(e.key)) return
    e.preventDefault()

    const i = items.findIndex((t) => t.id === active)
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % items.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : items.length - 1

    setActive(items[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="no-scrollbar relative -mx-4 flex items-center gap-1 overflow-x-auto border-b border-neutral-200 px-4"
      >
        {items.map((tab, i) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={[
                'shrink-0 rounded-t px-3 py-2 text-sm font-medium outline-none transition-colors',
                'focus-visible:bg-brand-50 focus-visible:text-brand-700',
                selected ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-800',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}

        <span
          aria-hidden
          className={[
            'absolute bottom-0 h-0.5 rounded-full bg-brand',
            // Only animate once a real position is known, and respect a reduced
            // motion preference.
            measured ? 'transition-[left,width] duration-300 ease-out' : '',
            'motion-reduce:transition-none',
          ].join(' ')}
          style={{ left: indicator.left, width: indicator.width }}
        />
      </div>

      {items.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className="pt-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  )
}
