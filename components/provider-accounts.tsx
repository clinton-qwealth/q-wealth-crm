'use client'

import Link from 'next/link'
import { useState } from 'react'
import { SearchIcon } from '@/components/icons'
import { ACCOUNT_TYPE_LABEL } from '@/lib/account-mix'
import type { ProviderHolding } from '@/lib/groups'
import { AccountTypeTile, AccountValue, SHEET, TOOLBAR_CONTROL } from '@/components/ui'

type AccountSortId = 'name_asc' | 'name_desc' | 'value_desc'

/**
 * The provider's accounts, with the registers' toolbar over them — search,
 * Type, Sort, asked for 27 Sep "exactly the same as the group page". A client
 * component narrowing rows the server already sent, like every register here:
 * a keystroke re-runs nothing.
 *
 * The search covers the three names a person remembers an account BY — its
 * label, its owners, and the household that holds it — so typing "brown"
 * finds the Browns' wrap without knowing what the account is called. The Type
 * options are derived from the rows (the statusesOf rule): a provider that
 * only ever holds super does not offer an Investment filter with an empty
 * answer. "Highest value" sinks the unvalued to the bottom — an account with
 * no valuation is not the smallest, it is unknown, and unknown sorts last.
 */
export function ProviderAccounts({ rows }: { rows: ProviderHolding[] }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState<AccountSortId>('name_asc')

  const typesPresent = [...new Set(rows.map((r) => r.account_type).filter(Boolean))] as string[]

  const needle = q.trim().toLowerCase()
  const visible = rows
    .filter((r) => {
      if (type !== 'all' && r.account_type !== type) return false
      if (!needle) return true
      return [r.label, r.owners ?? '', r.group_name].some((s) => s.toLowerCase().includes(needle))
    })
    .sort((a, b) => {
      if (sort === 'name_asc') return a.label.localeCompare(b.label)
      if (sort === 'name_desc') return b.label.localeCompare(a.label)
      /* value_desc: valued rows by size, the unvalued last, ties by name. */
      const av = a.latest_value == null ? null : Number(a.latest_value)
      const bv = b.latest_value == null ? null : Number(b.latest_value)
      if (av == null && bv == null) return a.label.localeCompare(b.label)
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av || a.label.localeCompare(b.label)
    })

  if (rows.length === 0) return null

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h3 className="mr-1 truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Accounts
        </h3>

        <label className="relative w-44">
          <span className="sr-only">Search accounts</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className={`${TOOLBAR_CONTROL} w-full pl-7`}
          />
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={TOOLBAR_CONTROL}>
            <option value="all">Type</option>
            {typesPresent.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t] ?? t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as AccountSortId)}
            className={TOOLBAR_CONTROL}
          >
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
            <option value="value_desc">Highest value</option>
          </select>
        </label>
      </div>

      {visible.length > 0 ? (
        <div className={SHEET}>
          <ul className="divide-y divide-neutral-200/80">
            {visible.map((h) => (
              <li key={`${h.record_id}:${h.group_id}`}>
                <Link
                  href={`/groups/${h.group_id}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
                >
                  <AccountTypeTile type={h.account_type ?? ''} status={h.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-neutral-900">{h.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-neutral-500">
                      {[
                        h.account_type ? (ACCOUNT_TYPE_LABEL[h.account_type] ?? h.account_type) : null,
                        h.owners,
                        `held by ${h.group_name}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-neutral-900">
                    <AccountValue value={h.latest_value} changeAmount={h.change_amount} changePct={h.change_pct} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-6 py-8">
          <p className="text-center text-sm text-neutral-600">
            Nothing matches{needle ? ` “${q.trim()}”` : ' these filters'}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQ('')
              setType('all')
            }}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}
