'use client'

import { useState } from 'react'
import { AllocationBars } from './allocation-bars'
import { Drawer, DrawerBody, DrawerHeader } from './drawer'
import { EditField, Field, FIELD_INPUT, FieldBox, ReadonlyField } from './field-box'
import { DataRow } from './data-section'
import {
  ACCOUNT_LIVE,
  ACCOUNT_STATUS_LABEL,
  AccountTypeTile,
  AccountValue,
  Pill,
  accountMoney,
} from './ui'
import { ACCOUNT_TYPE_LABEL } from '@/lib/account-mix'
import { formatCalendarDate, formatNoteDate } from '@/lib/note-date'
import { saveAccountDetails } from '@/app/(shell)/groups/actions'

/**
 * The investment accounts list, and the one drawer that reads any of them.
 *
 * ## Why the rows moved into a client component
 *
 * The group page is a Server Component and cannot hand a row an `onClick`. The
 * rows are already plain JSON, so the section moves across whole and takes its
 * rows as DATA — exactly what `account-donut.tsx` does with the same array.
 * The member panel's children-as-trigger shape is the wrong one here: its
 * trigger is per-row MARKUP, and this one is per-row data.
 *
 * ## The drawer fetches nothing
 *
 * Every field below already arrived in the page's first wave, because
 * `group_financial_accounts` carries them. That is the design's one binding
 * constraint and `groups-page-round-trips.test.tsx` is the proof of it: the
 * page issues two waves and six named views, and a drawer that fetched its own
 * detail would look perfectly correct on screen while quietly adding a round
 * trip behind every click.
 *
 * ## One dialog, not one per row
 *
 * `selectedId` names the open record and `Drawer` renders nothing while closed,
 * so twenty accounts put ONE record in the document rather than twenty. It also
 * means the panel below reads its account out of the same array the rows do —
 * so a rename reaches the open heading after revalidation, instead of the
 * drawer holding a copy taken when it opened, which is the defect
 * `workflow-tasks.tsx` carries a comment about.
 */

export type AccountRow = {
  account_id: string
  account_type: string
  label: string
  account_number: string | null
  status: string
  opened_on: string | null
  closed_on: string | null
  provider: string | null
  owners: string | null
  owner_count: number | null
  latest_value: string | number | null
  valued_on: string | null
  change_amount: string | number | null
  change_pct: string | number | null
  baseline_value: string | number | null
  baseline_points: number | null
  available_cash: string | number | null
  snapshot_as_at: string | null
  snapshot_source_system: string | null
  /** A fee-schedule identifier. Printed against a "Product" label, NEVER as a
   *  heading — eleven of the first twenty HUB24 accounts share one string. */
  product_display_name: string | null
  valuation_source: string | null
  valuation_source_system: string | null
  owner_parties: { party_id: string; name: string }[] | null
  allocation: { asset_class: string; weight: string | number }[] | null
  allocation_as_at: string | null
}

export function AccountList({
  accounts,
  members,
  groupName,
}: {
  accounts: AccountRow[]
  /** The group's current members, the only people an account can be given to
   *  from here. */
  members: { id: string; name: string }[]
  groupName: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const account = accounts.find((a) => a.account_id === selectedId) ?? null

  return (
    <>
      {accounts.map((a) => (
        <DataRow
          key={a.account_id}
          leading={<AccountTypeTile type={a.account_type} status={a.status} />}
          primary={a.label}
          secondary={[ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type, a.owners]
            .filter(Boolean)
            .join(' · ')}
          meta={
            <AccountValue
              value={a.latest_value}
              changeAmount={a.change_amount}
              changePct={a.change_pct}
              baselineValue={a.baseline_value}
              baselinePoints={a.baseline_points}
            />
          }
          trigger={{ label: `Open ${a.label}`, onClick: () => setSelectedId(a.account_id) }}
        />
      ))}

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        labelledBy="account-drawer-title"
      >
        {account ? (
          <AccountPanel
            account={account}
            members={members}
            groupName={groupName}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          /*
           * The account was open and is now gone from the list.
           *
           * Changing owners can move an account OUT of the group it was opened
           * from, and the patch RPC permits that deliberately: this is the only
           * ownership-editing UI in the product, so refusing it would mean an
           * account could never be transferred out of a household. What is left
           * is to say so, because the alternative — a drawer that vanishes mid
           * read — looks like a fault.
           */
          <>
            <DrawerHeader
              id="account-drawer-title"
              title="Account moved"
              onClose={() => setSelectedId(null)}
            />
            <DrawerBody>
              <p className="text-sm leading-relaxed text-neutral-600">
                Nobody in {groupName} owns this account any more, so it is no longer on this
                group&rsquo;s list. It still exists, and it now appears under the group its new
                owners belong to.
              </p>
            </DrawerBody>
          </>
        )}
      </Drawer>
    </>
  )
}

/**
 * One account, read at length: one scrolling column, no tabs.
 *
 * ## The promotion threshold, written down so the next person decides
 *
 * Tabs exist in the member panel because a person is five distinct questions,
 * and in the task panel because two of its panels are streams. This is two
 * blocks of fields and one picture, which a reader takes in by scrolling. WHEN
 * A THIRD PANEL ARRIVES THAT IS A STREAM — a valuation history, or documents —
 * promote this to `<Tabs fill gutter={8} flushTop={false} bleed={false}
 * alignFirst>`, the configuration both other drawers already use. Until then a
 * tab strip over two tabs is chrome around content that fits.
 *
 * ## Three dates, and why each is labelled where it sits
 *
 * `valued_on` dates the figure, `snapshot_as_at` dates the cash, and
 * `allocation_as_at` dates the picture. They legitimately disagree: the feed
 * refreshes cash on every run but skips the allocation when the weights fail
 * its checks, leaving the previous rows standing. So there is no "as at" for
 * the account as a whole to print at the top, and each figure carries its own.
 */
function AccountPanel({
  account: a,
  members,
  groupName,
  onClose,
}: {
  account: AccountRow
  members: { id: string; name: string }[]
  groupName: string
  onClose: () => void
}) {
  const live = a.status === ACCOUNT_LIVE
  const typeLabel = ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type
  const owners = a.owner_parties ?? []
  const identity = <input type="hidden" name="account_id" value={a.account_id} />

  return (
    <>
      <DrawerHeader
        id="account-drawer-title"
        /* The drawer covers the page, so the one context worth repeating is the
           context you can no longer see. Provider included because it is what
           tells two similarly named wraps apart. */
        eyebrow={[groupName, a.provider].filter(Boolean).join(' · ')}
        title={a.label}
        pills={
          <>
            <Pill on={live}>{ACCOUNT_STATUS_LABEL[a.status] ?? a.status}</Pill>
            <Pill>{typeLabel}</Pill>
          </>
        }
        onClose={onClose}
      />

      <DrawerBody>
        {/* The figure, at the top, because it is what the row was clicked on.
            Deliberately NOT a `size` prop on AccountValue: one caller, one
            option, and `data-section.tsx` already records in writing what an
            option with a single caller costs. */}
        <div>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">
            <AccountValue
              value={a.latest_value}
              changeAmount={a.change_amount}
              changePct={a.change_pct}
              baselineValue={a.baseline_value}
              baselinePoints={a.baseline_points}
            />
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {a.valued_on ? `As at ${formatCalendarDate(a.valued_on)}` : 'No valuation recorded'}
            {a.valuation_source ? ` · ${a.valuation_source}` : ''}
          </p>
        </div>

        <FieldBox
          title="Details"
          action={saveAccountDetails}
          identity={identity}
          view={
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Type" value={typeLabel} />
              <Field label="Status" value={ACCOUNT_STATUS_LABEL[a.status] ?? a.status} />
              <Field label="Account number" value={a.account_number} />
              <Field label="Provider" value={a.provider} />
              {/* A fee-schedule identifier, printed where it cannot be mistaken
                  for the account's name. Shown only when a feed has sent one. */}
              {a.product_display_name ? (
                <Field label="Product" value={a.product_display_name} span />
              ) : null}
              <Field
                label="Opened"
                value={a.opened_on ? formatCalendarDate(a.opened_on) : null}
              />
              {a.closed_on ? (
                <Field label="Closed" value={formatCalendarDate(a.closed_on)} />
              ) : null}
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              <EditField label="Name">
                <input name="label" defaultValue={a.label} required className={FIELD_INPUT} />
              </EditField>
              <EditField label="Type">
                <select name="account_type" defaultValue={a.account_type} className={FIELD_INPUT}>
                  {Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </EditField>
              {/* Shown in the edit state and not editable, which is what
                  ReadonlyField exists to say. The number and the provider come
                  from the account's own records, and the status is a
                  status-and-date pair rather than a text field — its own
                  control, deferred rather than half-built here. */}
              <div className="grid grid-cols-2 gap-3">
                <ReadonlyField label="Account number" value={a.account_number} />
                <ReadonlyField label="Provider" value={a.provider} />
                <ReadonlyField label="Status" value={ACCOUNT_STATUS_LABEL[a.status] ?? a.status} />
                {a.product_display_name ? (
                  <ReadonlyField label="Product" value={a.product_display_name} />
                ) : null}
              </div>
            </div>
          }
        />

        {/* Its own box and its own form, because it is a different table and a
            different set of rows — not a fourth field on the one above. */}
        <FieldBox
          title="Owners"
          action={saveAccountDetails}
          identity={identity}
          view={
            owners.length ? (
              <ul className="flex flex-col gap-1.5">
                {owners.map((o) => (
                  <li key={o.party_id} className="truncate text-sm text-neutral-900">
                    {o.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-400">No owners recorded</p>
            )
          }
          edit={
            <fieldset>
              {/* LOAD-BEARING. `getAll('owner_party_ids')` returns [] both when
                  this control was never on the form and when every box was
                  unticked — two opposite meanings under patch semantics. The
                  sentinel is what makes an emptied list a refusal instead of a
                  silent no-op. */}
              <input type="hidden" name="owners_present" value="1" />
              <legend className="sr-only">Owners</legend>
              {members.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  This group has no members to own an account.
                </p>
              ) : (
                <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                  {members.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        name="owner_party_ids"
                        value={m.id}
                        defaultChecked={owners.some((o) => o.party_id === m.id)}
                        className="h-3.5 w-3.5 accent-[var(--brand-500)]"
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
              {/* An owner who is not a member of this group cannot be shown as a
                  checkbox, and must not be silently dropped by a save that only
                  submits the boxes. Saying so is the honest half of a control
                  that cannot represent them. */}
              {owners.some((o) => !members.some((m) => m.id === o.party_id)) ? (
                <p className="mt-2 text-xs text-neutral-500">
                  This account is also owned by someone outside {groupName}. Saving here replaces
                  the owners with the people ticked above.
                </p>
              ) : null}
            </fieldset>
          }
        />

        {/* NO `edit` PROP, EVER. `financial_account_allocations` has a select
            policy and no insert, update or delete policy for staff at all, by
            design — the next feed run would overwrite a hand edit anyway. A
            pencil here would be a promise the database will not keep. */}
        <FieldBox
          title="Asset allocation"
          view={
            <AllocationBars
              rows={a.allocation}
              asAt={a.allocation_as_at ? formatNoteDate(a.allocation_as_at) : null}
              hasProvider={Boolean(a.provider)}
            />
          }
        />

        <FieldBox
          title="Cash"
          view={
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field
                label="Available cash"
                value={
                  a.available_cash == null
                    ? null
                    : accountMoney.format(Number(a.available_cash))
                }
              />
              <Field
                label="Reported"
                value={a.snapshot_as_at ? formatNoteDate(a.snapshot_as_at) : null}
              />
              {/* The one sentence that stops a reader adding two figures that
                  are not addable. Cash is a PART of the value above, not a
                  balance beside it. */}
              {a.available_cash == null ? null : (
                <p className="col-span-full text-xs leading-relaxed text-neutral-500">
                  Cash available to trade. It is already counted inside the account value above,
                  so the two are not added together.
                </p>
              )}
            </dl>
          }
        />
      </DrawerBody>
    </>
  )
}
