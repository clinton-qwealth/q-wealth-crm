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
export function Tabs({
  items,
  label,
  fill = false,
  gutter = 4,
  flushTop = true,
}: {
  items: TabItem[]
  label: string
  /**
   * `fill` makes the tabs own a fixed-height container: the strip stays put and
   * the active panel scrolls beneath it. Without it the whole component grows
   * and the page scrolls, which is right inside a card and wrong inside a panel
   * where scrolling the tabs out of reach is a dead end.
   */
  fill?: boolean
  /** Horizontal padding of the container the strip bleeds across. */
  gutter?: 4 | 5
  /**
   * Pull the strip up into the container's top padding, so it caps a card.
   * False when something sits above it — in a panel with a header, the negative
   * margin drags the strip over that header instead.
   */
  flushTop?: boolean
}) {
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

  // Written out rather than interpolated: Tailwind scans source text, so a
  // constructed class name like `-mx-${gutter}` would never be generated.
  const bleed = gutter === 5 ? '-mx-5 px-5' : '-mx-4 px-4'
  const lift = !flushTop ? '' : gutter === 5 ? '-mt-5' : '-mt-4'
  // The rounded corners only belong on a strip that caps its container.
  const cap = flushTop ? 'rounded-t-[7px]' : ''

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={`no-scrollbar relative ${bleed} ${lift} ${cap} flex shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50 pt-1`}
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
          className={
            fill
              ? 'min-h-0 flex-1 overflow-y-auto pt-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/20'
              : 'pt-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/20'
          }
        >
          {tab.panel}
        </div>
      ))}
    </div>
  )
}
