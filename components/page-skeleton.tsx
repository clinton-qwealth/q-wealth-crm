import { SHEET } from './ui'

/**
 * What a page looks like while it is arriving.
 *
 * This is the fallback behind every `loading.tsx` under the shell. Before it
 * existed there was no loading state anywhere, so a navigation was
 * all-or-nothing: the old page stayed fully painted while the server ran the
 * whole auth-and-data chain, and nothing — not even the nav highlight —
 * acknowledged the click. It read as sluggish because, for the ~600ms the
 * server took, it was indistinguishable from a click that had not registered.
 *
 * **Grid children of `<main>`, no wrapper.** The shell's `<main>` is a 12-column
 * grid and pages place themselves with `col-span-*`; a wrapping element would
 * lose the tracks unless it used subgrid. So this returns a fragment.
 *
 * **Honest, in two senses.** It shows nothing readable except an `sr-only`
 * "Loading page" — no fake title, no fake figures, nothing a person could
 * mistake for the record they asked for. And it is NOT the dashed
 * `Placeholder`, which in this app means "planned, not built"; a skeleton means
 * "arriving", which is a different claim and must not borrow that mark.
 *
 * **The anchor holds still.** The first block uses `PageHeading`'s own metrics
 * — a 16px eyebrow line, `mt-1`, a 32px title line — so the thing the eye is
 * tracking does not move when the real heading swaps in. The body is one
 * `SHEET` of hairline rows: the ledger object the index, the board card and
 * the reports card all are, and the closest single shape to the rest.
 *
 * **Bars are decorative.** `bg-neutral-200` measures about 1.2:1 on white; the
 * pulse is what says "transient", and under reduced motion the still grey
 * blocks read correctly on their own. WCAG's 3:1 non-text floor does not apply
 * to decoration, and every bar is `aria-hidden`.
 *
 * **`role="status"`, and deliberately no `aria-busy`.** A polite live region
 * announces the sr-only text once. `aria-busy="true"` on that same element would
 * tell assistive technology to SUPPRESS announcements until it clears — the
 * opposite of the intent — and this element is replaced wholesale when the page
 * lands, so it would never clear. `aria-busy` belongs on `<main>`, which a
 * loading file cannot reach.
 */
const BAR = 'rounded bg-neutral-200 animate-pulse motion-reduce:animate-none'

export function PageSkeleton() {
  return (
    <>
      <div role="status" className="col-span-full">
        <span className="sr-only">Loading page</span>
        <div aria-hidden="true">
          {/* Eyebrow line, then the title line, at PageHeading's sizes. */}
          <div className={`h-4 w-24 ${BAR}`} />
          <div className={`mt-1 h-8 w-64 ${BAR}`} />
        </div>
      </div>

      <div aria-hidden="true" className={`col-span-full ${SHEET}`}>
        <ul className="divide-y divide-neutral-200/80">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 px-3.5 py-3">
              <span className={`h-9 w-9 shrink-0 rounded-lg ${BAR}`} />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={`h-3.5 w-1/3 ${BAR}`} />
                <span className={`h-3 w-1/2 ${BAR}`} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
