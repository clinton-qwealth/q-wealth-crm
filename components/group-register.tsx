'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDownIcon, SearchIcon } from '@/components/icons'
import { FIELD_INPUT } from '@/components/field-box'
import { Pill, SHEET } from '@/components/ui'
import {
  GROUP_SORTS,
  narrowGroups,
  sortGroups,
  statusesOf,
  type GroupSortId,
} from '@/lib/group-register'
import type { GroupListItem } from '@/lib/groups'

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  business_entity: 'Business entity',
}

/**
 * A register of client groups: the toolbar, the count, the sheet, the rows.
 *
 * ## A client component, narrowing rows the server already sent
 *
 * The same shape as the parking report and for the same reason: the rows come
 * from one server read, and a search keystroke or a sort change re-runs
 * NOTHING — `lib/group-register.ts` narrows in memory. The rules live there,
 * pure, where they can be tested without a renderer.
 *
 * ## The count tells the truth about narrowing
 *
 * "3 of 12 households" while a filter is on, "12 households" when none is —
 * a filtered list captioned with the filtered number alone reads as the whole
 * register, which is how somebody concludes a client is missing.
 *
 * ## Filtered-to-nothing is not empty
 *
 * The page's dashed empty state means "the register has nothing in it". A
 * search that matches nothing is a different fact, gets a quiet inline line,
 * and carries the one action that helps: clearing what was typed.
 */
export function GroupRegister({
  groups,
  noun,
}: {
  groups: GroupListItem[]
  noun: [singular: string, plural: string]
}) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<GroupSortId>('name_asc')

  const statuses = statusesOf(groups)
  const visible = sortGroups(narrowGroups(groups, { q, status }), sort)
  const narrowed = visible.length !== groups.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* The search takes the slack; the two selects keep their size. */}
        <label className="relative min-w-40 flex-1">
          <span className="sr-only">Search {noun[1]}</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or contact"
            className={`${FIELD_INPUT} w-full pl-8`}
          />
        </label>

        {/* Rendered even with one status in the data: a control that appears
            only once a prospect exists looks like a bug that grew a dropdown.
            Options are DERIVED — see statusesOf. */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD_INPUT}>
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as GroupSortId)}
            className={FIELD_INPUT}
          >
            {GROUP_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length > 0 ? (
        <>
          <p className="text-right text-xs text-neutral-500">
            {narrowed ? `${visible.length} of ${groups.length}` : groups.length}{' '}
            {(narrowed ? groups.length : visible.length) === 1 ? noun[0] : noun[1]}
          </p>

          <div className={SHEET}>
            <ul className="divide-y divide-neutral-200/80">
              {visible.map((g) => (
                <GroupRow key={g.group_id} group={g} />
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-6 py-8">
          <p className="text-center text-sm text-neutral-600">
            Nothing matches{q.trim() ? ` “${q.trim()}”` : ' these filters'}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQ('')
              setStatus('all')
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

/**
 * One group in the list.
 *
 * **The whole row is the link**, not just the name. A row that navigates should
 * be clickable across its width — a 120px name inside a 900px row is a target
 * people miss — and there is nothing else on the row to click, so nothing is
 * being swallowed by making it one.
 *
 * **The chevron points right.** The same glyph the file-note and History
 * disclosures use rotated to say "this goes somewhere" rather than "this
 * opens". Decorative: the link's accessible name is the group's name.
 */
function GroupRow({ group }: { group: GroupListItem }) {
  /* Marked only when it is NOT active, the same rule the accounts list follows.
     Most groups are active, so a pill on every row would say nothing; a pill on
     the prospect or the inactive one says something. */
  const marked = group.status !== 'active'
  const members = group.member_count ?? 0

  return (
    <li>
      <Link
        href={`/groups/${group.group_id}`}
        className="flex items-center gap-3 px-3.5 py-3 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900">{group.name}</span>
            {marked ? <Pill tone="neutral">{group.status}</Pill> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-neutral-500">
            {[
              TYPE_LABEL[group.group_type] ?? group.group_type,
              `${members} member${members === 1 ? '' : 's'}`,
              group.primary_contact,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>

        {/* The icon sets its own `aria-hidden`, so nothing is passed here — the
            link's accessible name is the group's name and nothing else. */}
        <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-neutral-300" />
      </Link>
    </li>
  )
}
