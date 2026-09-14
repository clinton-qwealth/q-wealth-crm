import { balanceSplit, type BalanceTotals } from '@/lib/balance-sheet'
import { accountMoney } from './ui'

/**
 * The two sides of the balance sheet as one thick bar: blue for what is owned,
 * red for what is owed, drawn in proportion.
 *
 * Asked for on 14 September, above the net position. The two column totals
 * state the figures and the net states the difference; neither shows the SHAPE,
 * which is the thing an adviser reads at a glance and the thing that changes
 * slowly enough to be worth watching.
 *
 * ## The colours, and why the join is marked
 *
 * Blue and red were asked for, and they are a good pair here: unlike red and
 * green they stay apart under the common forms of colour blindness. What they
 * do NOT have is a difference in LIGHTNESS — blue-600 and red-600 measure
 * 5.17:1 and 4.83:1 against white, which is 1.07:1 against each other. In
 * greyscale (a printed advice document, achromatopsia) the bar would be one
 * solid block with no join.
 *
 * So the join is drawn, not implied: the liability segment carries a white left
 * border. It is INSIDE the segment's box, so it marks the boundary without
 * taking a pixel off either proportion.
 *
 * And the percentages are printed above the bar. Colour is never the only thing
 * carrying the reading (WCAG 1.4.1) — the bar is the picture, the labels are
 * the fact.
 */
export function BalanceBar({ totals }: { totals: BalanceTotals }) {
  const split = balanceSplit(totals)
  if (!split) return null

  const label = [
    `Balance sheet composition:`,
    `assets ${accountMoney.format(totals.assets)}, ${split.assets.text};`,
    `liabilities ${accountMoney.format(totals.liabilities)}, ${split.liabilities.text}.`,
  ].join(' ')

  return (
    <div
      data-slot="balance-bar"
      className="rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgb(0_0_0/0.05)]"
    >
      {/* Owned on the left, owed on the right — the same order as the two
          columns above, so the bar reads as a summary of them rather than as a
          new arrangement to work out. */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <Swatch className="bg-blue-600" />
          <span className="truncate text-neutral-500">Assets</span>
          <span className="font-semibold tabular-nums text-neutral-900">{split.assets.text}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-semibold tabular-nums text-neutral-900">
            {split.liabilities.text}
          </span>
          <span className="truncate text-neutral-500">Liabilities</span>
          <Swatch className="bg-red-600" />
        </span>
      </div>

      {/* `role="img"` with the figures spelled out, the same treatment the
          investment ring takes: the bar is a picture of numbers that are
          already on the page, and a screen reader should get the numbers. */}
      <div
        role="img"
        aria-label={label}
        className="mt-2 flex h-7 overflow-hidden rounded-md bg-neutral-100"
      >
        {/* Rendered only when there is something to draw. A zero side with a
            minimum width would put six pixels of red on a group that owes
            nothing, which is the one thing this bar must never say. */}
        {split.assets.width > 0 ? (
          <div
            data-slot="bar-assets"
            style={{ flexBasis: `${split.assets.width}%` }}
            /* `min-w` so a small side is still visible rather than rounded out
               of existence — at 6px on a bar several hundred wide the
               distortion is under a percent, and the alternative is a debt
               that does not appear at all. Segments shrink to fit, so the pair
               still ends flush with the bar. */
            className="min-w-[6px] bg-blue-600"
          />
        ) : null}
        {split.liabilities.width > 0 ? (
          <div
            data-slot="bar-liabilities"
            style={{ flexBasis: `${split.liabilities.width}%` }}
            className="min-w-[6px] border-l-2 border-white bg-red-600"
          />
        ) : null}
      </div>
    </div>
  )
}

/** A legend chip. Square, like the record tiles — a dot would be the one round
 *  mark on a page where round means a person. */
function Swatch({ className }: { className: string }) {
  return <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${className}`} />
}
