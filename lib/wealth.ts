/**
 * Headline money: whole dollars.
 *
 * The accounts footer shows cents because it reconciles against the rows above
 * it. A headline figure is read, not reconciled — and at 1280px wide the three
 * summary tiles are 160px each, where "$1,284,300.00" at 20px overflowed its
 * tile while "$1,284,300" fits with room. Measured, not guessed.
 */
const headlineMoney = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

/**
 * A percentage, signed, to one decimal.
 *
 * One decimal rather than none because the figures here move slowly: the real
 * group's 30-day change is +0.2%, which whole numbers would print as "0%" and
 * colour as flat. Two decimals is a reconciliation, and this is a headline.
 */
const changePercent = new Intl.NumberFormat('en-AU', {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** The subset of an account row the summary needs. */
export type ValuedRow = {
  latest_value: string | number | null
  /**
   * The average of this account's valuations in the 30 days BEFORE its latest
   * one — `financial_accounts_summary.baseline_value`, the same number the
   * account row's up/down arrow is drawn from.
   *
   * Optional, and null for an account that has no such window: one valuation
   * and nothing before it, or none at all. Such an account can be in the total
   * and still have nothing to compare against, which is the whole reason
   * `change` below counts what it covers.
   */
  baseline_value?: string | number | null
}

/**
 * How a figure has moved over the thirty days before it.
 *
 * `covered` and `valued` are not decoration. The two sides of the comparison
 * have to be the SAME accounts or the percentage is meaningless — so accounts
 * without a baseline are dropped from both sides, and the result then describes
 * less than the headline it sits under. The real group is exactly this case:
 * three valued accounts, one of them holding $100,000 with a single valuation
 * and no history, so the change speaks for $397,251 of a $497,251 total. When
 * these differ the figure's `note` says so.
 */
export type SummaryChange = {
  /** Signed percent — 1.79 means +1.79%. Rounded to the printed precision, so
   *  the colour a caller picks from it always agrees with the text. */
  pct: number
  /** Formatted and signed, e.g. "+0.2%". */
  text: string
  /** Accounts the comparison covers, of the accounts in the total. */
  covered: number
  valued: number
}

export type SummaryFigure = {
  label: string
  value: string
  /** What the figure leaves out. A total that quietly excludes things is worse
   *  than no total at all — the same rule the accounts footer follows. */
  note?: string
  /** Absent when nothing can be compared — see `SummaryChange`. */
  change?: SummaryChange
}

/**
 * The three headline figures for a group: total wealth, total investments,
 * total assets.
 *
 * Honesty about the data behind them matters more than the arithmetic. As of
 * 6 Sep 2026 the schema holds financial accounts and nothing else that counts
 * as an asset or a liability — the Assets + Liabilities tab is a placeholder.
 * So today:
 *
 *   investments = the accounts with a recorded value
 *   assets      = investments + other assets      → other assets: none recorded
 *   wealth      = assets − liabilities             → liabilities: none recorded
 *
 * All three are therefore the SAME NUMBER, and rather than hide that behind
 * three confident figures, each card says what it is missing. When property,
 * debts and the rest exist, the arithmetic here is where they join, and the
 * notes go away on their own.
 *
 * Unvalued accounts contribute nothing and are counted in the note, exactly as
 * the accounts footer does — two of the five real accounts have never had a
 * value written, and a wealth figure that silently omitted them is the kind
 * of number that gets repeated in a client conversation.
 */
export function wealthSummary(accounts: ValuedRow[]): {
  wealth: SummaryFigure
  investments: SummaryFigure
  assets: SummaryFigure
} {
  const valued = accounts.filter((a) => a.latest_value != null)
  const unvalued = accounts.length - valued.length
  const investments = valued.reduce((sum, a) => sum + Number(a.latest_value), 0)

  /*
   * The thirty-day change, over the accounts that can actually be compared.
   *
   * Both sides are summed from the SAME rows. Summing every latest value
   * against every baseline that happens to exist would divide a three-account
   * total by a two-account history and call the difference growth — on the real
   * group that reads as +25% when the true movement is +0.2%.
   *
   * Each account's window is anchored to its own latest valuation rather than
   * to today, so "the last 30 days" is the union of those windows, not one
   * calendar month. That is the same number the row arrows use, which is the
   * point: the headline and the rows under it must not disagree.
   */
  const comparable = valued.filter((a) => a.baseline_value != null)
  const now = comparable.reduce((sum, a) => sum + Number(a.latest_value), 0)
  const before = comparable.reduce((sum, a) => sum + Number(a.baseline_value), 0)

  // Rounded to the printed precision BEFORE the sign is read, so a +0.04% move
  // prints "0.0%" and reads as flat rather than printing "+0.0%" in green.
  const rawPct = comparable.length === 0 || before === 0 ? null : ((now - before) / before) * 100
  const pct = rawPct === null ? null : Math.round(rawPct * 10) / 10

  const change: SummaryChange | undefined =
    pct === null
      ? undefined
      : {
          pct,
          text: changePercent.format(pct / 100),
          covered: comparable.length,
          valued: valued.length,
        }

  // Nothing else exists to add or subtract yet. Named so the intent is visible
  // at the call site the day it changes.
  const otherAssets = 0
  const liabilities = 0

  const assets = investments + otherAssets
  const wealth = assets - liabilities

  // Short, because these sit under a headline in a 160px tile. Each clause is
  // a complete fact on its own; a middle dot joins them.
  const unvaluedNote =
    unvalued === 0 ? null : `${unvalued} unvalued account${unvalued === 1 ? '' : 's'} excluded`

  /* Said only when the change speaks for less than the total it sits under.
     Silence when it covers everything, rather than a reassuring clause nobody
     needs to read. */
  const changeNote =
    change && change.covered < change.valued
      ? `30-day change covers ${change.covered} of ${change.valued} valued accounts`
      : null

  const join = (...parts: (string | null)[]) => {
    const kept = parts.filter((p): p is string => Boolean(p))
    return kept.length ? kept.join(' · ') : undefined
  }

  /*
   * One change on all three, because all three ARE the accounts total today —
   * other assets and liabilities are both zero, so the same money moved by the
   * same amount. The day either exists, each figure needs its own baseline and
   * the arithmetic above is where they join, exactly as the values do.
   */
  return {
    wealth: {
      label: 'Total wealth',
      value: headlineMoney.format(wealth),
      note: join('No liabilities recorded yet', unvaluedNote, changeNote),
      change,
    },
    investments: {
      label: 'Total investments',
      value: headlineMoney.format(investments),
      note: join(unvaluedNote, changeNote),
      change,
    },
    assets: {
      label: 'Total assets',
      value: headlineMoney.format(assets),
      note: join('No other assets recorded yet', unvaluedNote, changeNote),
      change,
    },
  }
}
