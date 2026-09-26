'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDownIcon, GroupIcon, SearchIcon, StructureIcon } from '@/components/icons'
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
 * The toolbar's own control style — `FIELD_INPUT` a size down and a shade
 * quieter. Asked 26 Sep: the full form-field height "clashed with the
 * records", which is right — a toolbar is chrome over the list, not a form
 * beside it, so it takes 12px text, tighter padding, the ground's grey and a
 * hairline, and keeps only the focus treatment at full strength.
 */
const TOOLBAR_CONTROL =
  'rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700 outline-none transition-colors placeholder:text-neutral-400 hover:border-neutral-300 focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand/15'

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
      {/* Left-aligned, not justified — asked 26 Sep: the controls hold their
          own width and the slack stays free on the right, so the row reads as
          three tools rather than a stretched form. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-52">
          <span className="sr-only">Search {noun[1]}</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
          {/* The placeholder is one word because the box is one third its old
              width, and "Search by name or contact" clips mid-word at 208px.
              What it searches is still said — by the sr-only label above, and
              by the row simply answering keystrokes. */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className={`${TOOLBAR_CONTROL} w-full pl-7`}
          />
        </label>

        {/* Rendered even with one status in the data: a control that appears
            only once a prospect exists looks like a bug that grew a dropdown.
            Options are DERIVED — see statusesOf. */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={TOOLBAR_CONTROL}>
            {/* "Status", not "All statuses": at rest the closed control shows
                this option, so the word doubles as the control's visible name —
                the same trick the task dialog's "Choose a role" plays. */}
            <option value="all">Status</option>
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
            className={TOOLBAR_CONTROL}
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
/**
 * The row's anchor tile — the treatment every other list here already has,
 * given to the registers on 26 Sep. A SQUARE on the neutral tone, the
 * `GroupTile` idiom: a client group is a thing, and it takes no colour because
 * the coloured tiles all encode a kind of HOLDING. People for a household, the
 * org chart for anything that is a structure.
 */
function KindTile({ type }: { type: string }) {
  const Icon = type === 'household' ? GroupIcon : StructureIcon
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"
      aria-hidden="true"
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  )
}

function GroupRow({ group }: { group: GroupListItem }) {
  /* Marked only when it is NOT active, the same rule the accounts list follows.
     Most groups are active, so a pill on every row would say nothing; a pill on
     the prospect or the inactive one says something. */
  const marked = group.status !== 'active'
  const members = group.member_count ?? 0
  /* The register the row sits in already says "household", so a household row
     does not repeat it. A structure names its kind, because the entities
     register is deliberately a catch-all — Business entity, a future trust —
     and the word is what tells them apart. */
  const second = [group.group_type === 'household' ? null : (TYPE_LABEL[group.group_type] ?? group.group_type), group.primary_contact]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      <Link
        href={`/groups/${group.group_id}`}
        className="flex items-center gap-3 px-3.5 py-3 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
      >
        <KindTile type={group.group_type} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900">{group.name}</span>
            {marked ? <Pill tone="neutral">{group.status}</Pill> : null}
          </span>
          {second ? (
            <span className="mt-0.5 block truncate text-xs text-neutral-500">{second}</span>
          ) : null}
        </span>

        {/* The figure the list is scanned for, in the figure slot — the
            template list's deployments treatment. It left the second line so
            the number can be read DOWN the register rather than hunted for
            mid-sentence. */}
        <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-neutral-900">
          {members}
          <span className="block text-[11px] font-normal leading-tight text-neutral-400">
            {members === 1 ? 'member' : 'members'}
          </span>
        </span>

        {/* The icon sets its own `aria-hidden`, so nothing is passed here — the
            link's accessible name is the group's name and nothing else. */}
        <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-neutral-300" />
      </Link>
    </li>
  )
}
