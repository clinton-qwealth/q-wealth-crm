/**
 * A group's balance sheet: what it owns and what it owes.
 *
 * Pure arithmetic and labels, with no renderer and no Supabase client, so the
 * rules can be tested without mounting anything — the shape `lib/account-mix.ts`
 * and `lib/wealth.ts` already follow.
 */

/**
 * Every type, in the order it is offered and listed, with the words a person
 * reads.
 *
 * The database holds these as an enum, which has neither an order nor a
 * readable name; this has both. The two are kept in step by hand and a test
 * compares them in both directions — adding a type to the enum and forgetting
 * this list leaves a type nobody can ever record, which looks exactly like a
 * type that does not exist.
 */
export const ASSET_TYPES: [value: string, label: string][] = [
  ['principal_residence', 'Principal residence'],
  ['investment_property', 'Investment property'],
  ['holiday_home_or_land', 'Holiday home / vacant land'],
  ['commercial_property', 'Commercial property'],
  ['cash_at_bank', 'Cash at bank'],
  ['term_deposit', 'Term deposit'],
  ['motor_vehicle', 'Motor vehicle'],
  ['boat_or_caravan', 'Boat / caravan'],
  ['home_contents', 'Home contents'],
  ['collectibles_and_art', 'Collectibles and art'],
  ['business_interest', 'Business interest'],
  ['other_asset', 'Other asset'],
]

export const LIABILITY_TYPES: [value: string, label: string][] = [
  ['home_loan', 'Home loan'],
  ['investment_property_loan', 'Investment property loan'],
  ['line_of_credit', 'Line of credit / overdraft'],
  ['margin_loan', 'Margin loan'],
  ['personal_loan', 'Personal loan'],
  ['car_loan', 'Car loan'],
  ['credit_card', 'Credit card'],
  ['hecs_help', 'HECS-HELP'],
  ['business_loan', 'Business loan'],
  ['other_liability', 'Other liability'],
]

export const ITEM_TYPE_LABEL: Record<string, string> = Object.fromEntries([
  ...ASSET_TYPES,
  ...LIABILITY_TYPES,
])

/** The live state. Anything else is sold, repaid or otherwise finished. */
export const ITEM_LIVE = 'active'

/** One owner's stake, as the view sends it. */
export type OwnerShare = {
  party_id: string
  name: string
  share_percent: string | number
}

/** The subset of a row this module needs. The view sends more. */
export type BalanceRow = {
  item_id: string
  side: string
  value: string | number | null
  status: string
  owner_shares?: OwnerShare[] | null
}

export type BalanceTotals = {
  assets: number
  liabilities: number
  /** Assets less liabilities. Negative is a real answer, not an error. */
  net: number
  /** How many rows were left out for being closed, so a total can say so. */
  closed: number
}

const amount = (v: string | number | null | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * What the group owns, owes, and the difference.
 *
 * **A closed row counts for nothing.** A sold house and a repaid loan are
 * history: including either would overstate one side of a figure somebody reads
 * out to a client. The count of what was excluded comes back with the totals,
 * because a total that quietly drops rows is worse than no total at all — the
 * rule the accounts footer already follows.
 *
 * Liabilities are stored positive and subtracted here. That is the only place
 * the sign is decided, which is the point: a signed column would put the
 * decision in every caller that ever sums a mixed list.
 */
export function balanceTotals(rows: BalanceRow[]): BalanceTotals {
  const live = rows.filter((r) => r.status === ITEM_LIVE)

  const side = (s: string) =>
    live.filter((r) => r.side === s).reduce((sum, r) => sum + amount(r.value), 0)

  const assets = side('asset')
  const liabilities = side('liability')

  return {
    assets,
    liabilities,
    net: assets - liabilities,
    closed: rows.length - live.length,
  }
}

/** One side of the split bar: how wide it is drawn, and what it is called. */
export type SideShare = { width: number; text: string }

export type BalanceSplit = { assets: SideShare; liabilities: SideShare }

/**
 * How the balance sheet divides between what is owned and what is owed, as two
 * percentages of the two sides added together.
 *
 * **The denominator is assets PLUS liabilities, not assets alone.** A group
 * with $1.2m of property and $540k of debt reads 70 / 30, which is the shape of
 * the balance sheet; dividing the debt by the assets would give 45% and there
 * would be no second number to draw beside it. This is a composition, not a
 * ratio of one figure to another.
 *
 * `null` when there is nothing to divide — a bar of one colour, or of none,
 * says less than no bar at all.
 *
 * ## The widths are exact and the labels are not
 *
 * `width` is unrounded and the two always total exactly 100, because the second
 * is the first's complement: a bar whose segments came to 99.4% would show a
 * sliver of its own ground at one end.
 *
 * The LABELS are whole percentages, and the liability's is the complement of
 * the asset's ROUNDED value rather than its own rounding. Rounding the two
 * independently produces "70% / 31%" whenever the split falls near a half
 * (69.5 and 30.5 both round up), and a pair that does not add to 100 reads as
 * an arithmetic error even though each number is correct on its own.
 *
 * Two guards stop a rounding from denying something the bar is drawing: a side
 * that exists but rounds to nothing reads "<1%", and one that rounds to
 * everything while the other still exists reads ">99%".
 */
export function balanceSplit(totals: BalanceTotals): BalanceSplit | null {
  const base = totals.assets + totals.liabilities
  if (!(base > 0)) return null

  const assetWidth = (totals.assets / base) * 100
  const liabilityWidth = 100 - assetWidth

  const rounded = Math.round(assetWidth)
  const text = (width: number, show: number) => {
    if (width > 0 && show === 0) return '<1%'
    if (width < 100 && show === 100) return '>99%'
    return `${show}%`
  }

  return {
    assets: { width: assetWidth, text: text(assetWidth, rounded) },
    liabilities: { width: liabilityWidth, text: text(liabilityWidth, 100 - rounded) },
  }
}

/**
 * One member's share of the balance sheet.
 *
 * This is what the shares are FOR. A house owned 60/40 contributes 60% of its
 * value to one member and 40% to the other, and no amount of "who owns it"
 * could tell you that — which is why this table records a share where
 * `financial_account_owners` deliberately does not.
 *
 * A row whose shares are missing contributes nothing rather than everything: a
 * silent 100% would be a figure nobody entered.
 */
export function shareFor(rows: BalanceRow[], partyId: string): BalanceTotals {
  const live = rows.filter((r) => r.status === ITEM_LIVE)

  const side = (s: string) =>
    live
      .filter((r) => r.side === s)
      .reduce((sum, r) => {
        const stake = (r.owner_shares ?? []).find((o) => o.party_id === partyId)
        if (!stake) return sum
        return sum + (amount(r.value) * amount(stake.share_percent)) / 100
      }, 0)

  const assets = side('asset')
  const liabilities = side('liability')

  return { assets, liabilities, net: assets - liabilities, closed: rows.length - live.length }
}
