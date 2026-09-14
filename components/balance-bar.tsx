import { balanceSplit, type BalanceTotals } from '@/lib/balance-sheet'
import { accountMoney } from './ui'

/**
 * The two sides of the balance sheet as one thick bar: blue for what is owned,
 * red for what is owed, drawn in proportion.
 *
 * Asked for on 14 September. The two column totals state the figures and the
 * net states the difference; neither shows the SHAPE, which is the thing an
 * adviser reads at a glance and the thing that changes slowly enough to be
 * worth watching.
 *
 * It began as a card of its own above the net position and was moved INSIDE it
 * the same day, between the label and the figure. That is the better home: the
 * bar and the net position are two readings of one subtraction, and a card
 * apiece made them look like two facts. The component therefore carries no
 * chrome — no border, no ground, no padding — and takes the width it is
 * handed.
 *
 * ## The colours, and why the join is marked
 *
 * **Soft tints, the same family the balance-sheet tiles wear** — asked for on
 * 14 September after saturated blue and red read as too bright beside the rest
 * of the page. The tiles are `bg-red-50` with a `red-700` glyph; these ramp
 * from 100 to 400, which is the closest a FILLED area can come to that and
 * still be seen at all.
 *
 * **The ramps point inward: each side is palest at the bar's outer edge and
 * strongest where the two meet.** That is the opposite of the usual stacked
 * bar and it is deliberate — the join is the only thing on the bar that encodes
 * the ratio, so the paint is heaviest exactly there and fades away from it.
 *
 * ## What this costs, stated plainly
 *
 * blue-400 and red-400 measure 2.54:1 and 2.77:1 against the white card, and
 * the pale ends measure 1.22:1. That is **under the 3:1 non-text floor** (WCAG
 * 1.4.11) that the mix ring's palette holds itself to — a deliberate trade for
 * the softer look, not an oversight.
 *
 * Two things carry the reading instead, and neither may be removed without
 * putting the colours back up:
 *
 *   1. **The percentages are printed above the bar.** They are the fact; the
 *      bar is the picture. This is what keeps the component compliant with
 *      1.4.1 (Use of Colour) regardless of the fill.
 *   2. **The join is drawn, not implied.** blue-400 against red-400 is 1.09:1 —
 *      in greyscale, or to a viewer with no colour vision, the two segments are
 *      the same tone. The white left border on the liability segment measures
 *      2.54:1 and 2.77:1 against the two sides it separates, so the boundary
 *      survives when the hues do not. It sits INSIDE the segment's box, so it
 *      marks the join without taking a pixel off either proportion.
 *
 * The track behind them carries a hairline ring for the same reason: with a
 * fill this pale, the bar's own extent needs an edge or it appears to start
 * partway in.
 *
 * Neither ramp borrows indigo, which globals.css reserves for the investment
 * mix ring as "the only family on this page with no job".
 */

/*
 * The two fills and the two legend chips, named once so a chip and the segment
 * it explains cannot drift into different blues.
 *
 * A chip takes the ramp's STRONG stop rather than the ramp itself: at ten
 * pixels square a gradient that begins at blue-100 is a pale smudge, and the
 * chip's whole job is to say which colour this row is about.
 *
 * `bg-linear-to-r` is Tailwind v4's name for what v3 called `bg-gradient-to-r`.
 * Written out in full rather than assembled, because Tailwind scans source text
 * — a constructed class would never be generated, and the failure mode is a
 * segment with no background at all.
 */
export const ASSET_FILL = 'bg-linear-to-r from-blue-100 to-blue-400'
export const ASSET_CHIP = 'bg-blue-400'
export const LIABILITY_FILL = 'bg-linear-to-r from-red-400 to-red-100'
export const LIABILITY_CHIP = 'bg-red-400'
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
      /* No card of its own: this sits INSIDE the net position card, between
         its label and its figure, so it takes the width it is given and adds
         no chrome. `min-w-0` because a flex child will not shrink below its
         content without it, and the two legend words are that content. */
      className="min-w-0 flex-1"
    >
      {/* Owned on the left, owed on the right — the same order as the two
          columns above, so the bar reads as a summary of them rather than as a
          new arrangement to work out. */}
      <div className="flex items-center justify-between gap-3 text-[11px] leading-none">
        <span className="flex min-w-0 items-center gap-1.5">
          <Swatch className={ASSET_CHIP} />
          <span className="truncate text-neutral-500">Assets</span>
          <span className="font-semibold tabular-nums text-neutral-900">{split.assets.text}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-semibold tabular-nums text-neutral-900">
            {split.liabilities.text}
          </span>
          <span className="truncate text-neutral-500">Liabilities</span>
          <Swatch className={LIABILITY_CHIP} />
        </span>
      </div>

      {/* `role="img"` with the figures spelled out, the same treatment the
          investment ring takes: the bar is a picture of numbers that are
          already on the page, and a screen reader should get the numbers. */}
      <div
        role="img"
        aria-label={label}
        className="mt-1.5 flex h-5 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-inset ring-neutral-200"
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
            className={`min-w-[6px] ${ASSET_FILL}`}
          />
        ) : null}
        {split.liabilities.width > 0 ? (
          <div
            data-slot="bar-liabilities"
            style={{ flexBasis: `${split.liabilities.width}%` }}
            className={`min-w-[6px] border-l-2 border-white ${LIABILITY_FILL}`}
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
