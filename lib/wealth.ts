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

/** The subset of an account row the summary needs. */
export type ValuedRow = { latest_value: string | number | null }

export type SummaryFigure = {
  label: string
  value: string
  /** What the figure leaves out. A total that quietly excludes things is worse
   *  than no total at all — the same rule the accounts footer follows. */
  note?: string
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

  const join = (...parts: (string | null)[]) => {
    const kept = parts.filter((p): p is string => Boolean(p))
    return kept.length ? kept.join(' · ') : undefined
  }

  return {
    wealth: {
      label: 'Total wealth',
      value: headlineMoney.format(wealth),
      note: join('No liabilities recorded yet', unvaluedNote),
    },
    investments: {
      label: 'Total investments',
      value: headlineMoney.format(investments),
      note: join(unvaluedNote),
    },
    assets: {
      label: 'Total assets',
      value: headlineMoney.format(assets),
      note: join('No other assets recorded yet', unvaluedNote),
    },
  }
}
