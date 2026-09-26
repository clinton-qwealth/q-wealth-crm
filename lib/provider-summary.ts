import type { ProviderHolding } from './groups'

/**
 * The provider page's headline figures: Total FUM, and its split into
 * investment and super. Pure, for the same reason `lib/group-register.ts` is —
 * the arithmetic has rules worth testing without a renderer, and two of them
 * are the kind that pass silently when broken:
 *
 * **A joint account counts ONCE.** `provider_holdings` serves one row per
 * (holding, group) pair — an account whose owners span two households appears
 * twice, correctly, because each household's page lists it. Summing rows
 * without deduplicating by `record_id` double-counts exactly the firm's
 * largest, most-shared accounts.
 *
 * **Only LIVE accounts are money.** A closed account's last valuation is a
 * historical fact, not funds under management. 'active' is `ACCOUNT_LIVE`'s
 * value — written literally here because lib does not import from components.
 *
 * **An unvalued account is EXCLUDED AND COUNTED.** Nothing writes a valuation
 * after the opening one on some accounts (see `AccountValue`'s own note), and
 * a total that silently leaves rows out is worse than no total — DataSection's
 * rule. The caller renders `unvalued` into the figure's note.
 *
 * Policies never enter: cover is not FUM, and premiums are not the firm's
 * money under management either.
 */
export function providerSummary(holdings: ProviderHolding[]): {
  fum: number
  investment: number
  superannuation: number
  /** Live accounts with no valuation — excluded from every figure above. */
  unvalued: number
} {
  const seen = new Map<string, ProviderHolding>()
  for (const h of holdings) {
    if (h.kind !== 'account' || h.status !== 'active') continue
    if (!seen.has(h.record_id)) seen.set(h.record_id, h)
  }

  let fum = 0
  let investment = 0
  let superannuation = 0
  let unvalued = 0
  for (const a of seen.values()) {
    if (a.latest_value == null) {
      unvalued += 1
      continue
    }
    const value = Number(a.latest_value)
    fum += value
    if (a.account_type === 'investment') investment += value
    if (a.account_type === 'superannuation') superannuation += value
  }
  return { fum, investment, superannuation, unvalued }
}
