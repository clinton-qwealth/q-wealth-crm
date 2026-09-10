import { accountMoney, SHEET } from './ui'

/**
 * How a group's investment value is split across its accounts.
 *
 * **A trial, asked for on 10 September**, in the right half of the Accounts
 * tab — the space the two-column split reserved. The rows on the left answer
 * "what is each account worth"; this answers "which account is most of the
 * money", which a column of figures makes you compute in your head.
 *
 * ## Hand-written, not a charting dependency
 *
 * One ring of arcs needs no library. `recharts` and `chart.js` are both larger
 * than this whole application's runtime dependency list, and this site has
 * written its own drag-and-drop and its own TOTP generator rather than import
 * them — the one single-feature dependency it has taken, TipTap, was taken
 * because a rich-text editor over `contenteditable` is a decade of edge cases.
 * A donut is `stroke-dasharray` on a circle.
 *
 * `stroke-dasharray` rather than arc paths on purpose: no trigonometry, and the
 * degenerate cases fall out for free — one account is a whole ring rather than
 * a path with a zero-length sweep, which is where hand-rolled arc maths breaks.
 *
 * ## What it refuses to do
 *
 * **It cannot show an account with no recorded value, and it says so.** Nothing
 * writes a valuation after an account's opening one, so at the time of writing
 * two of the five real accounts have never had one. A donut of "the group's
 * accounts" that silently dropped them would be the same defect the wealth
 * summary was designed around: a figure that looks complete, gets repeated in a
 * client conversation, and is wrong. So the count of what is missing sits under
 * the chart whenever any account is missing, and if NOTHING has a value there
 * is no chart at all — a sentence instead.
 *
 * **The centre holds the account count, not the total.** The total was
 * deliberately taken off this tab on 10 September, and Total investments is
 * already in the page header — a third instance of the same number, in the one
 * place the eye lands hardest, is not an improvement.
 *
 * **The legend shows shares, not amounts.** Every amount is already in the row
 * immediately to the left. Repeating them would make a 200px column carry two
 * columns of currency and say nothing new; the share is the thing this view
 * adds.
 */
export type DonutAccount = {
  account_id: string
  label: string
  latest_value: string | number | null
}

/**
 * Violet, most-valuable first, and monotonically lighter.
 *
 * Asked for as "innovator purple". Deliberately a **sequential ramp of one
 * hue** rather than six different colours: these segments are the same kind of
 * thing in different amounts, and a rainbow would imply categories. It also
 * keeps the chart clear of every colour that already means something here —
 * green is a live state, amber needs attention, red is the wrong direction,
 * gold is an investment tile and blue is insurance. Violet is the only family
 * on the page with no job yet.
 *
 * Tailwind's own violet scale rather than a new token: this is a trial, and
 * `--gold-*` exists because amber was semantically taken, which is not the case
 * here. **If it ships, promote it to named tokens in `globals.css`** so the
 * ramp is one decision rather than six literals.
 *
 * Steps 900 → 300 rather than 800 → 300: the two largest segments are the ones
 * a reader compares, so they get the widest separation.
 */
const RAMP = [
  'text-violet-900',
  'text-violet-700',
  'text-violet-500',
  'text-violet-400',
  'text-violet-300',
  'text-violet-200',
] as const

/** How many accounts get their own segment before the tail is grouped. */
const SLICES = RAMP.length

const R = 40
const STROKE = 16
const C = 2 * Math.PI * R
/** Separator between segments, in the same units as the circumference. */
const GAP = 2

type Slice = {
  key: string
  label: string
  value: number
  share: number
  tone: string
  /** Dash length drawn, and where the arc starts, both in circumference units. */
  dash: number
  start: number
}

export function AccountDonut({ accounts }: { accounts: DonutAccount[] }) {
  const valued = accounts
    .filter((a) => a.latest_value != null)
    .map((a) => ({ key: a.account_id, label: a.label, value: Number(a.latest_value) }))
    .filter((a) => Number.isFinite(a.value) && a.value > 0)
    .sort((a, b) => b.value - a.value)

  const missing = accounts.length - valued.length
  const total = valued.reduce((sum, a) => sum + a.value, 0)

  /* No chart rather than an empty ring. `total > 0` is the real guard: every
     share is a division by it, and an account recorded at exactly zero is a
     valued account that cannot be drawn. */
  if (!valued.length || total <= 0) {
    return (
      <Frame>
        <p className="px-3.5 py-4 text-xs leading-relaxed text-neutral-500">
          {accounts.length === 0
            ? 'Once this group holds investment accounts, their mix by value shows here.'
            : `No value has been recorded against ${
                accounts.length === 1 ? 'this account' : 'any of these accounts'
              } yet, so there is no mix to show.`}
        </p>
      </Frame>
    )
  }

  /* More accounts than the ramp has steps: the tail becomes one segment rather
     than two accounts sharing a colour, which would make the legend a lie. */
  const head = valued.slice(0, valued.length > SLICES ? SLICES - 1 : SLICES)
  const tail = valued.slice(head.length)
  const grouped = tail.length
    ? [...head, { key: 'other', label: `${tail.length} smaller accounts`, value: tail.reduce((s, a) => s + a.value, 0) }]
    : head

  /*
   * Geometry is computed here, not while rendering.
   *
   * The first version accumulated the offset with `offset += len` inside the
   * JSX `map`, which the React compiler's lint refuses — and rightly: mutating
   * a variable during render is exactly the thing that breaks when a component
   * is re-run or re-ordered. A running total belongs in a fold before the
   * markup, where it is a value rather than a side effect.
   */
  const slices: Slice[] = grouped.reduce<Slice[]>((acc, a, i) => {
    const share = a.value / total
    const len = share * C
    /* Only inset a gap where the segment can afford one, so a sliver stays
       visible instead of being eaten by its own separator. A lone segment is a
       closed ring and takes no gap at all. */
    const inset = grouped.length > 1 && len > GAP * 2 ? GAP : 0
    acc.push({
      ...a,
      share,
      tone: RAMP[i] ?? RAMP[RAMP.length - 1],
      dash: Math.max(len - inset, 0.4),
      start: acc.reduce((sum, s) => sum + s.share * C, 0),
    })
    return acc
  }, [])
  return (
    <Frame>
      <div className="flex flex-col items-center gap-3 px-3.5 py-4">
        <svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel(slices, total)} className="h-32 w-32">
          {/* -90° so the largest segment starts at twelve o'clock, where a
              reader looks first, and the ring fills clockwise. */}
          <g transform="rotate(-90 50 50)" fill="none" strokeWidth={STROKE}>
            {slices.map((s) => (
              <circle
                key={s.key}
                cx="50"
                cy="50"
                r={R}
                className={`stroke-current ${s.tone}`}
                strokeDasharray={`${s.dash} ${C - s.dash}`}
                strokeDashoffset={-s.start}
              >
                <title>{`${s.label} — ${accountMoney.format(s.value)}, ${pct(s.share)}`}</title>
              </circle>
            ))}
          </g>
          {/* The count, not the money — see the note at the top. */}
          <text
            x="50"
            y="50"
            textAnchor="middle"
            className="fill-neutral-900 text-[15px] font-semibold"
            style={{ fontSize: 15 }}
            dy="1"
          >
            {valued.length}
          </text>
          <text
            x="50"
            y="50"
            textAnchor="middle"
            className="fill-neutral-500"
            style={{ fontSize: 7 }}
            dy="11"
          >
            {valued.length === 1 ? 'account' : 'accounts'}
          </text>
        </svg>

        <ul className="flex w-full flex-col gap-1.5">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-sm bg-current ${s.tone}`}
              />
              <span className="min-w-0 flex-1 truncate text-neutral-700">{s.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-neutral-900">{pct(s.share)}</span>
            </li>
          ))}
        </ul>

        {missing > 0 ? (
          /* The same rule the removed footer total carried: a chart that leaves
             rows out says how many, every time. */
          <p className="w-full text-[11px] leading-snug text-neutral-400">
            {missing === 1
              ? '1 account with no recorded value is not shown.'
              : `${missing} accounts with no recorded value are not shown.`}
          </p>
        ) : null}
      </div>
    </Frame>
  )
}

/** The heading and sheet, so the chart reads as one more object in the ledger. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {/* Same treatment as the section headings beside it. */}
      <h3 className="mb-2.5 truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Mix by value
      </h3>
      <div className={SHEET}>{children}</div>
    </div>
  )
}

/** Whole percents, and never a bare "0%" for a segment that is really there. */
function pct(share: number) {
  const whole = Math.round(share * 100)
  return whole === 0 ? '<1%' : `${whole}%`
}

/**
 * The chart's text equivalent. Colour carries the mapping on screen, so the
 * whole ring needs saying in words — the per-segment `<title>` is a hover
 * affordance, not a substitute.
 */
function ariaLabel(slices: Slice[], total: number) {
  const parts = slices.map((s) => `${s.label} ${pct(s.share)}`).join(', ')
  return `Investment mix by value, ${accountMoney.format(total)} in total: ${parts}`
}
