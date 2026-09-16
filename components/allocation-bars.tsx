import { allocation, allocationNote, type AllocationInput, type AssetFamily } from '@/lib/allocation'

/**
 * How an account is invested, as a weighted bar list.
 *
 * ## Why not the donut
 *
 * `AccountDonut` exists and cannot be reused, on four counts, any one of which
 * would be enough:
 *
 * 1. it caps at `MAX_SLICES = 4` with a four-colour ramp, and there are eight
 *    asset classes;
 * 2. it is per-GROUP — one arc per account, sized by value — not an asset mix;
 * 3. it drops null and zero values by design;
 * 4. **a pie cannot draw a negative slice at all**, and a live HUB24 account
 *    carries `other = −0.0228`.
 *
 * A single stacked 100% bar fails on the fourth count too: a negative segment
 * either vanishes or is drawn overlapping its neighbours, which is a picture of
 * something that is not true.
 *
 * So: one row per class, a bar on a shared track, and the percentage printed
 * beside it. `balance-bar.tsx` is the precedent for the mechanics — inline
 * percentage widths, printed figures, one `role="img"` over the lot — and for
 * why they can be checked in jsdom, which has no layout engine to measure with.
 *
 * ## What the picture must not do
 *
 * Normalise. The weights are drawn as reported, and a set totalling 97.7% says
 * so underneath rather than being stretched to fill the track. The migration
 * that allowed negative weights settled this: "a negative slice is its problem
 * to draw honestly, not this table's to hide."
 */

/**
 * Four inks over eight classes, by family.
 *
 * The page's `--mix-1..--mix-4` ramp is SEQUENTIAL — it means more and less —
 * so stretching it across eight kinds would both run out and imply an order
 * that is not there. Grouping by family reuses it honestly: the colour says
 * growth or defensive, which is the question actually asked of an allocation,
 * and the label always names the class so nothing depends on the colour alone.
 */
const FAMILY_INK: Record<AssetFamily, string> = {
  shares: 'var(--mix-1)',
  fixed_interest: 'var(--mix-2)',
  property: 'var(--mix-3)',
  cash: 'var(--mix-4)',
}

export function AllocationBars({
  rows,
  asAt,
  hasProvider,
}: {
  rows: AllocationInput[] | null | undefined
  /** `allocation_as_at`, NOT `snapshot_as_at` — see the note below. */
  asAt?: string | null
  /** Whether a provider is recorded at all, which decides what the empty state
   *  can honestly say. */
  hasProvider: boolean
}) {
  const a = allocation(rows)
  const note = allocationNote(a)

  if (a.rows.length === 0) {
    /*
     * Built and empty — so SOLID GREY, per the three-way rule `account-donut`
     * writes down: dashed means not built, pulsing means arriving, solid means
     * built with nothing in it. The page is server-rendered, so there is no
     * pending fetch a skeleton could be promising.
     *
     * Deliberately no dashed container, which also keeps the house-empty-state
     * census in `inherited-alignment.test.ts` at six.
     */
    return (
      <div data-slot="alloc-ghost">
        <div aria-hidden="true" className="space-y-2">
          {[70, 45, 25].map((w) => (
            <div key={w} className="h-2.5 rounded bg-neutral-100" style={{ width: `${w}%` }} />
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          {hasProvider
            ? 'No allocation has been reported for this account yet.'
            : 'This account is recorded by hand, so no provider reports its allocation.'}
        </p>
      </div>
    )
  }

  /* One text equivalent for the whole picture, minus signs included — the
     treatment the balance bar and the donut both take. Colour and length are
     the screen-only encoding; this is the rest of it. */
  const label = `Asset allocation: ${a.rows.map((r) => `${r.label} ${r.text}`).join(', ')}`

  return (
    <div>
      <ul role="img" aria-label={label} className="space-y-2">
        {a.rows.map((r) => (
          <li
            key={r.key}
            data-slot="alloc-row"
            data-class={r.key}
            /* Two lines below `sm`, three columns above it. The drawer is
               full-screen on a phone, which leaves about 72px for a track once
               the label and the figure have taken their share — and 72px is not
               a bar. Stacking gives the track the full width instead. */
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,1fr)_3.25rem]"
          >
            <span className="truncate text-xs text-neutral-700 sm:order-1">{r.label}</span>
            <span className="text-right text-xs font-semibold tabular-nums text-neutral-900 sm:order-3">
              {r.text}
            </span>
            <span className="relative col-span-2 h-2.5 rounded bg-neutral-100 ring-1 ring-inset ring-neutral-200 sm:order-2 sm:col-span-1">
              {a.zeroPct > 0 ? (
                /* Drawn only when something is actually negative. With every
                   weight positive there is no below-zero to mark, and a rule at
                   the left edge would be a line with no meaning. */
                <span
                  aria-hidden="true"
                  data-slot="alloc-zero"
                  /* neutral-500, not neutral-400. A hairline at 2.3:1 on this
                     track is a rule you have to look for, and it is the thing
                     that says which side of zero a bar is on. */
                  className="absolute -inset-y-[2px] w-px bg-neutral-500"
                  style={{ left: `${a.zeroPct}%` }}
                />
              ) : null}
              <span
                data-slot="alloc-bar"
                data-side={r.negative ? 'negative' : 'positive'}
                /* `min-w` so a holding of 0.03% is still visible rather than
                   rounded out of existence. Under half a per cent of distortion
                   at this width, against a holding that otherwise does not
                   appear at all — the same trade the balance bar makes. */
                className={`absolute inset-y-0 min-w-[3px] rounded-[2px] ${
                  r.negative ? 'bg-neutral-600' : ''
                }`}
                style={{
                  left: `${r.startPct}%`,
                  width: `${r.lengthPct}%`,
                  /* Negatives take the neutral tone, which is a difference
                     that survives greyscale — one of three carriers, beside
                     the side of the zero rule and the printed minus sign.

                     neutral-600, and the step matters twice. neutral-400
                     measures 2.3:1 against this track, under WCAG's 3:1 floor
                     for a graphic carrying meaning — the bar would be there
                     and hard to see. And the obvious deeper step, neutral-500,
                     is `--mix-4` exactly, so a negative `other` bar would be
                     the same grey as a positive `cash` one directly above it.
                     `mix-palette.test.ts` measures both, reading the step out
                     of this file. */
                  background: r.negative ? undefined : FAMILY_INK[r.family],
                }}
              />
            </span>
          </li>
        ))}
      </ul>

      {note ? (
        <p data-slot="alloc-note" className="mt-3 text-xs text-neutral-500">
          {note}
        </p>
      ) : null}

      {asAt ? (
        /*
         * `allocation_as_at`, and not the account's `snapshot_as_at`.
         *
         * `ingest.promote_hub24` refreshes cash and the snapshot date on every
         * run but SKIPS the allocation when the weights fail its sum tolerance
         * or its unmapped-class tripwire — leaving yesterday's rows standing.
         * So the snapshot date would date this picture wrongly on exactly the
         * accounts where the feed is misbehaving, which is the one case where
         * being wrong matters.
         */
        <p className="mt-1 text-xs text-neutral-400">As reported on {asAt}</p>
      ) : null}
    </div>
  )
}
