'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { WELL } from './ui'

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
  alignFirst = false,
  bleed = true,
  ground = false,
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
  /**
   * Horizontal padding of the container the strip bleeds across, in Tailwind
   * steps: 4 is 16px, 5 is 20px, **6 is 24px** — a `Card padding="roomy"`,
   * which is what the workflow detail page's columns take — and **8 is 32px**,
   * added 11 September 2026 for the member panel, which is the roomiest
   * surface in the app.
   *
   * Written out per step rather than interpolated, because Tailwind scans
   * source text and a constructed `-mx-${gutter}` would never be generated.
   * That is why this is a closed set and not a number, and why adding a step
   * means adding it in four places below rather than one.
   */
  gutter?: 4 | 5 | 6 | 8
  /**
   * Pull the strip up into the container's top padding, so it caps a card.
   * False when something sits above it — in a panel with a header, the negative
   * margin drags the strip over that header instead.
   */
  flushTop?: boolean
  /**
   * Line the first tab's TEXT up with the container's own text, rather than its
   * button box. A tab button carries px-3 for a comfortable hit area, which
   * otherwise pushes the first label 12px further in than every heading and
   * value below it — a small misalignment that is very visible in a column.
   */
  alignFirst?: boolean
  /**
   * Cancel the parent's horizontal padding with a negative margin, so the strip
   * reaches the container's edges. True inside a padded card. FALSE when the
   * parent has no padding of its own — otherwise the negative margin drags the
   * strip outside the container entirely, which is what it did in the member
   * panel until this existed.
   */
  bleed?: boolean
  /**
   * Put the panel's content on a light grey ground, and darken the strip a
   * shade so it still caps it.
   *
   * This is what makes a list of white records read as records. `DataRow` sits
   * on a full-strength border and a 1px shadow precisely because it was white
   * on a white card — measured at 1.00:1 fill contrast, which is why the
   * accounts list looked like one undifferentiated block. A ground behind them
   * is the structural version of that fix rather than a workaround on each row.
   *
   * Opt-in, not the default: the member panel's tabs hold bordered edit forms
   * rather than records, and its ground was deliberately left white.
   */
  ground?: boolean
}) {
  const [active, setActive] = useState(items[0]?.id)

  /**
   * Which tabs have been opened, in order of first opening. The first tab is
   * seeded because it is selected before anyone clicks anything.
   *
   * ## Why panels are not all mounted up front
   *
   * They used to be: every panel rendered, the inactive ones carrying `hidden`.
   * That is cheap for text, and it is wrong for a panel that DOES something on
   * mount. The investment ring is the case that forced this — it played its
   * draw animation at page load, inside a hidden div, and was therefore already
   * finished by the time anyone reached the Accounts tab. Asked for on
   * 11 September: draw it when the tab is selected.
   *
   * Mount on first open and KEEP, rather than mounting only the active panel.
   * Unmounting on the way out would restart the draw on every visit, throw away
   * anything typed in a panel's form, and lose its scroll position — the
   * property the all-mounted version was there for. Keeping is the half of it
   * worth having; mounting everything up front was the half that was not.
   *
   * An array rather than a Set: state has to be replaced, not mutated, for
   * React to see the change, and an array of at most a handful of ids says the
   * order too.
   */
  const [opened, setOpened] = useState<string[]>(() => (items[0] ? [items[0].id] : []))

  const select = useCallback((id: string) => {
    setActive(id)
    setOpened((seen) => (seen.includes(id) ? seen : [...seen, id]))
  }, [])
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

    select(items[next].id)
    tabRefs.current[next]?.focus()
  }

  // Written out rather than interpolated: Tailwind scans source text, so a
  // constructed class name like `-mx-${gutter}` would never be generated.
  // Left padding is reduced by the button's own px-3 so the first label lands on
  // the container's text edge: a 20px gutter minus 12px of button padding is
  // 8px, and a 32px gutter minus the same 12px is 20px.
  const pad = alignFirst
    ? gutter === 8
      ? 'pl-5 pr-8'
      : gutter === 6
        ? 'pl-3 pr-6'
        : gutter === 5
          ? 'pl-2 pr-5'
          : 'pl-1 pr-4'
    : gutter === 8
      ? 'px-8'
      : gutter === 6
        ? 'px-6'
        : gutter === 5
          ? 'px-5'
          : 'px-4'
  const pull = !bleed
    ? ''
    : gutter === 8
      ? '-mx-8'
      : gutter === 6
        ? '-mx-6'
        : gutter === 5
          ? '-mx-5'
          : '-mx-4'
  const lift = !flushTop
    ? ''
    : gutter === 8
      ? '-mt-8'
      : gutter === 6
        ? '-mt-6'
        : gutter === 5
          ? '-mt-5'
          : '-mt-4'
  // The rounded corners only belong on a strip that caps its container.
  const cap = flushTop ? 'rounded-t-[7px]' : ''

  /* A grounded panel has to reach the container's edges the same way the strip
     does, or the grey sits in a white picture frame. So it cancels the parent's
     padding, restores it inside, and runs to the bottom edge — where it takes
     the card's own corner radius. Without `bleed` there is no padding to
     cancel, and the panel simply gets the colour. */
  const panelGround = !ground
    ? ''
    : bleed
      ? gutter === 8
        ? `-mx-8 px-8 pb-8 -mb-8 rounded-b-[7px] ${WELL}`
        : gutter === 6
          ? `-mx-6 px-6 pb-6 -mb-6 rounded-b-[7px] ${WELL}`
          : gutter === 5
            ? `-mx-5 px-5 pb-5 -mb-5 rounded-b-[7px] ${WELL}`
            : `-mx-4 px-4 pb-4 -mb-4 rounded-b-[7px] ${WELL}`
      : WELL

  /* The strip is one step darker than the well it caps (see WELL in ui.tsx for
     why the well is so light). Reversed — a lighter strip over a darker body —
     the strip reads as part of the content rather than as the chrome above it.

     A charcoal strip with inverted labels was tried on 6 Sep 2026 and rejected:
     it measured well (15:1 labels, 4.2:1 indicator) but a dark bar under a white
     top nav read as a foreign element rather than as this card's chrome. */
  const stripTone = ground ? 'bg-neutral-100 border-neutral-200' : 'bg-neutral-50 border-neutral-200'

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={`no-scrollbar relative ${pull} ${pad} ${lift} ${cap} flex shrink-0 items-center gap-1 overflow-x-auto border-b ${stripTone} pt-1`}
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
              onClick={() => select(tab.id)}
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
          className={[
            fill
              ? 'min-h-0 flex-1 overflow-y-auto pt-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/20'
              : 'pt-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/20',
            panelGround,
          ].join(' ')}
        >
          {opened.includes(tab.id) ? tab.panel : null}
        </div>
      ))}
    </div>
  )
}
