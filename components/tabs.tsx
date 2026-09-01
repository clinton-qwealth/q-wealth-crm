'use client'

import { useRef, useState, type ReactNode } from 'react'

export type TabItem = {
  id: string
  label: string
  panel: ReactNode
}

/**
 * Tabs following the ARIA tabs pattern.
 *
 * Roving tabindex: only the selected tab is reachable by Tab, and the arrow keys
 * move between them — so a keyboard user tabs once to reach the tablist, then
 * arrows across, rather than tabbing through every tab to get past it. Home and
 * End jump to the ends.
 *
 * Panels are passed in as rendered nodes, so a Server Component can supply real
 * content while the selection stays client-side.
 */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

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
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="-mx-4 flex items-center gap-1 border-b border-neutral-200 px-4"
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
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors',
                'focus-visible:bg-brand-50 focus-visible:text-brand-700',
                selected
                  ? 'border-brand text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}
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
