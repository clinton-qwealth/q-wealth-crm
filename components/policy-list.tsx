'use client'

import { useEffect, useRef, useState } from 'react'
import { ActivityFeed } from './activity-feed'
import { DeleteRecordDialog } from './delete-record-dialog'
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from './drawer'
import { EditField, Field, FIELD_INPUT, FieldBox } from './field-box'
import { DataRow } from './data-section'
import { Tabs } from './tabs'
import {
  PANEL_GUTTER,
  POLICY_LIVE,
  POLICY_STATUS_LABEL,
  Pill,
  PolicyTile,
  accountMoney,
  coverMoney,
  coverSummary,
} from './ui'
import type { WorkflowPost } from '@/lib/workflow-board'
import { formatCalendarDate } from '@/lib/note-date'
import { deletePolicy, savePolicyDetails } from '@/app/(shell)/groups/actions'

/**
 * The insurance policies list, and the one drawer that reads any of them.
 *
 * ## What this shares with the account list, and what it refuses to
 *
 * Shared: `Drawer`, `DrawerHeader`, `FieldBox`, `DataRow`'s trigger, the
 * `selectedId` shape, the gutter and the width. That is the whole of the
 * duplication worth killing, and all of it already lives in a shared file.
 *
 * NOT shared: the body. A policy is not an account with different labels. It
 * has covers, each of which must print its amount WITH ITS BASIS, and two
 * totals that must never be added. Its people are parties with ROLES, commonly
 * the same person twice. It has a premium, a frequency and a structure, and a
 * link to the account it is paid from. It has no allocation, and never will.
 *
 * A single body switching on a `kind` flag would be these two disjoint
 * components behind a boolean, with every field carrying a null branch for the
 * other kind — and the first change to either would have to be read against
 * both. Refused deliberately; this paragraph is the record of it.
 *
 * ## Three tabs since 19 September
 *
 * The threshold the account drawer's own docblock named — "a panel that is a
 * stream" — arrived here too: an Activity feed of posts on the policy, the
 * same posts table with a third scope. So the one scrolling column became the
 * account drawer's three tabs, and the split is the read-only / editable line
 * the body already had: Overview is the two totals and the covers, Details is
 * the two forms, Activity is the stream. The body is still not shared with the
 * account drawer, for the paragraph above; only the SHAPE is.
 */

/** The cover types, and how they read. Moved here from the group page on
 *  16 September, because both the row and the drawer now print them. */
export const COVER_TYPE_LABEL: Record<string, string> = {
  life: 'Life',
  tpd: 'TPD',
  trauma: 'Trauma',
  income_protection: 'Income protection',
}

const PREMIUM_FREQUENCY_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
}

const PREMIUM_STRUCTURE_LABEL: Record<string, string> = {
  stepped: 'Stepped',
  level: 'Level',
  hybrid: 'Hybrid',
}

export type PolicyCover = {
  cover_type: string
  benefit_amount: string | number
  benefit_basis: string
  benefit_period: string | null
  waiting_period: string | null
  indexed: boolean
}

export type PolicyRow = {
  policy_id: string
  label: string
  policy_number: string
  status: string
  commenced_on: string | null
  cancelled_on: string | null
  insurer: string | null
  owners: string | null
  lives_insured: string | null
  cover_types: string | null
  cover_count: number | null
  total_lump_sum_cover: string | number | null
  total_monthly_benefit: string | number | null
  premium: string | number | null
  premium_frequency: string | null
  premium_structure: string | null
  held_in_account_id: string | null
  held_in_account: string | null
  /** One array carrying the role, not two arrays split by it — a person is
   *  routinely both owner and life insured, and two id lists would lose which
   *  of them a name came from. */
  parties: { party_id: string; name: string; role: string }[] | null
  covers: PolicyCover[] | null
}

/**
 * An amount that says what kind of amount it is.
 *
 * The schema's own rule, in one function: "Never interpret without the basis."
 * $6,500 read as a lump sum where a monthly benefit was meant understates the
 * cover twelvefold, so the basis travels with the figure everywhere it is
 * printed — including in the `aria` text a screen reader gets.
 */
export function coverAmount(amount: string | number, basis: string) {
  const money = coverMoney.format(Number(amount))
  if (basis === 'monthly') return `${money} a month`
  if (basis === 'annual') return `${money} a year`
  return money
}

type Staff = { id: string; name: string }
type Viewer = { id: string; name: string; canRemoveAnyImage: boolean }

export function PolicyList({
  policies,
  members,
  groupName,
  posts,
  staff,
  viewer,
}: {
  policies: PolicyRow[]
  members: { id: string; name: string }[]
  groupName: string
  /** Every post on this group's policies; the drawer shows one policy's. */
  posts: WorkflowPost[]
  staff: Staff[]
  viewer: Viewer
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const policy = policies.find((p) => p.policy_id === selectedId) ?? null

  /* The last deletion, by name — `AccountList`'s notice, for the reasons
     written there: the drawer closes explicitly so the revalidated page does
     not reach "Policy moved", and focus lands here because the row's trigger
     no longer exists. */
  const [deleted, setDeleted] = useState<string | null>(null)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (deleted) status.current?.focus()
  }, [deleted])

  return (
    <>
      {deleted ? (
        <p
          ref={status}
          role="status"
          tabIndex={-1}
          data-slot="deleted-status"
          className="mb-3 text-sm text-neutral-600 outline-none"
        >
          {deleted} was deleted.
        </p>
      ) : null}

      {policies.map((p) => (
        <DataRow
          key={p.policy_id}
          leading={<PolicyTile status={p.status} />}
          primary={p.label}
          secondary={[
            p.cover_types
              ?.split(', ')
              .map((c) => COVER_TYPE_LABEL[c] ?? c)
              .join(', '),
            p.lives_insured,
          ]
            .filter(Boolean)
            .join(' · ')}
          meta={coverSummary(p.total_lump_sum_cover, p.total_monthly_benefit) ?? undefined}
          trigger={{
            label: `Open ${p.label}`,
            onClick: () => {
              setDeleted(null)
              setSelectedId(p.policy_id)
            },
          }}
        />
      ))}

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        labelledBy="policy-drawer-title"
      >
        {policy ? (
          <PolicyPanel
            policy={policy}
            members={members}
            groupName={groupName}
            posts={posts}
            staff={staff}
            viewer={viewer}
            onClose={() => setSelectedId(null)}
            onDeleted={(label) => {
              setSelectedId(null)
              setDeleted(label)
            }}
          />
        ) : (
          /* A policy belongs to the group of ANYONE with a role on it, so an
             edit that removes this group's last party moves it away. Same
             deliberate behaviour as an account, same sentence rather than a
             drawer that disappears while being read. */
          <>
            <DrawerHeader
              id="policy-drawer-title"
              title="Policy moved"
              onClose={() => setSelectedId(null)}
            />
            <DrawerBody>
              <p className="text-sm leading-relaxed text-neutral-600">
                Nobody in {groupName} is an owner or a life insured on this policy any more, so it
                is no longer on this group&rsquo;s list. It still exists, under the group its
                people belong to.
              </p>
            </DrawerBody>
          </>
        )}
      </Drawer>
    </>
  )
}

function PolicyPanel({
  policy: p,
  members,
  groupName,
  posts,
  staff,
  viewer,
  onClose,
  onDeleted,
}: {
  policy: PolicyRow
  members: { id: string; name: string }[]
  groupName: string
  posts: WorkflowPost[]
  staff: Staff[]
  viewer: Viewer
  onClose: () => void
  /** The policy was deleted. The owner closes the drawer and says so. */
  onDeleted: (label: string) => void
}) {
  const live = p.status === POLICY_LIVE
  const parties = p.parties ?? []
  const owners = parties.filter((x) => x.role === 'owner')
  const lives = parties.filter((x) => x.role === 'life_insured')
  const covers = p.covers ?? []
  const lumpSum = p.total_lump_sum_cover == null ? null : Number(p.total_lump_sum_cover)
  const monthly = p.total_monthly_benefit == null ? null : Number(p.total_monthly_benefit)
  const identity = <input type="hidden" name="policy_id" value={p.policy_id} />

  /* The delete button and its confirm — the account drawer's, without the fed
     rule: no feed maintains a policy, so there is nothing to disable it for. */
  const [confirming, setConfirming] = useState(false)
  const postCount = posts.filter((x) => x.policy_id === p.policy_id).length

  return (
    <>
      <DrawerHeader
        id="policy-drawer-title"
        eyebrow={[groupName, p.insurer].filter(Boolean).join(' · ')}
        title={p.label}
        pills={<Pill on={live}>{POLICY_STATUS_LABEL[p.status] ?? p.status}</Pill>}
        onClose={onClose}
      />

      {/* The account drawer's configuration, flag for flag — see there for
          why each is set. `fill` so the strip stays put and the panel scrolls
          beneath it. */}
      <Tabs
        fill
        gutter={8}
        flushTop={false}
        bleed={false}
        alignFirst
        label={`${p.label} policy`}
        items={[
          {
            id: 'overview',
            label: 'Overview',
            panel: (
              <div className={`${PANEL_GUTTER} space-y-5 pb-8`}>
                {/* THE TWO TOTALS, SIDE BY SIDE AND NEVER ADDED. $750,000 of life cover
                    plus $6,500 a month is not $756,500, which is why the database keeps
                    them in two columns rather than leaving each reader to remember. The
                    layout says it and the line beneath says it in words. */}
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  {lumpSum ? (
                    <div>
                      <p className="text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">
                        {coverMoney.format(lumpSum)}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">Total lump sum cover</p>
                    </div>
                  ) : null}
                  {monthly ? (
                    <div>
                      <p className="text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">
                        {coverMoney.format(monthly)}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">Total monthly benefit</p>
                    </div>
                  ) : null}
                  {!lumpSum && !monthly ? (
                    <p className="text-sm text-neutral-400">No cover amounts recorded</p>
                  ) : null}
                </div>
                {lumpSum && monthly ? (
                  <p className="-mt-2 text-xs leading-relaxed text-neutral-500">
                    A lump sum and a monthly benefit are different quantities. They are shown separately
                    and are never added together.
                  </p>
                ) : null}

                <FieldBox
                  title="Cover"
                  view={
                    covers.length ? (
                      <ul className="flex flex-col gap-2.5">
                        {covers.map((c) => {
                          /* The terms that decide what the amount is actually worth:
                             how long it pays for, how long before it starts, and
                             whether it keeps pace. Only stated when recorded. */
                          const terms = [
                            c.benefit_period ? `Benefit period ${c.benefit_period}` : null,
                            c.waiting_period ? `Waiting period ${c.waiting_period}` : null,
                            c.indexed ? 'Indexed' : null,
                          ].filter(Boolean)
                          return (
                            <li
                              key={c.cover_type}
                              data-slot="cover"
                              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                            >
                              <span className="text-sm text-neutral-900">
                                {COVER_TYPE_LABEL[c.cover_type] ?? c.cover_type}
                              </span>
                              <span className="text-sm font-semibold tabular-nums text-neutral-900">
                                {coverAmount(c.benefit_amount, c.benefit_basis)}
                              </span>
                              {terms.length ? (
                                <span className="w-full text-xs text-neutral-500">
                                  {terms.join(' \u00b7 ')}
                                </span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-neutral-400">No covers recorded</p>
                    )
                  }
                />

              </div>
            ),
          },
          {
            id: 'activity',
            label: 'Activity',
            panel: (
              /* The reading column the account drawer's feed takes, capped and
                 centred, for the reason written there. */
              <div className={`${PANEL_GUTTER} pb-8`}>
                <div className="mx-auto w-full max-w-xl">
                  <ActivityFeed
                    scope={{ kind: 'policy', policyId: p.policy_id }}
                    posts={posts}
                    staff={staff}
                    viewer={viewer}
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'details',
            label: 'Details',
            panel: (
              <div className={`${PANEL_GUTTER} space-y-5 pb-8`}>
                <FieldBox
                  title="Details"
                  action={savePolicyDetails}
                  identity={identity}
                  view={
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <Field label="Policy number" value={p.policy_number} />
                      <Field label="Insurer" value={p.insurer} />
                      <Field
                        label="Premium"
                        value={
                          p.premium == null
                            ? null
                            : [
                                accountMoney.format(Number(p.premium)),
                                p.premium_frequency
                                  ? (
                                      PREMIUM_FREQUENCY_LABEL[p.premium_frequency] ?? p.premium_frequency
                                    ).toLowerCase()
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(', ')
                        }
                      />
                      <Field
                        label="Structure"
                        value={
                          p.premium_structure
                            ? (PREMIUM_STRUCTURE_LABEL[p.premium_structure] ?? p.premium_structure)
                            : null
                        }
                      />
                      {/* Which account pays it. Plain text rather than a link: the
                          account drawer belongs to the section above and has no URL of
                          its own, which is the deep-linking question this change
                          deliberately left open. */}
                      <Field label="Held in" value={p.held_in_account} />
                      <Field label="Status" value={POLICY_STATUS_LABEL[p.status] ?? p.status} />
                      <Field
                        label="Commenced"
                        value={p.commenced_on ? formatCalendarDate(p.commenced_on) : null}
                      />
                      {p.cancelled_on ? (
                        <Field label="Cancelled" value={formatCalendarDate(p.cancelled_on)} />
                      ) : null}
                    </dl>
                  }
                  edit={
                    <div className="flex flex-col gap-3">
                      <EditField label="Name">
                        <input name="label" defaultValue={p.label} required className={FIELD_INPUT} />
                      </EditField>
                    </div>
                  }
                />

                {/* ROLE-AWARE, not a flat checkbox list. The same person is commonly
                    both the owner and the life insured — two rows for one party, which
                    the table's own comment calls the common case — so a single list
                    could not say which role a tick meant. One form and one RPC, because
                    the database checks the FINAL state of both roles together: moving a
                    person from life insured to owner in one save is a single legitimate
                    change, and two separate saves would refuse it halfway. */}
                <FieldBox
                  title="People"
                  action={savePolicyDetails}
                  identity={identity}
                  view={
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <Field
                        label="Owners"
                        value={owners.length ? owners.map((o) => o.name).join(', ') : null}
                      />
                      <Field
                        label="Lives insured"
                        value={lives.length ? lives.map((l) => l.name).join(', ') : null}
                      />
                    </dl>
                  }
                  edit={
                    <div className="flex flex-col gap-4">
                      <PartyPicker
                        legend="Owners"
                        field="owner_party_ids"
                        sentinel="owners_present"
                        members={members}
                        chosen={owners}
                      />
                      <PartyPicker
                        legend="Lives insured"
                        field="life_insured_party_ids"
                        sentinel="lives_present"
                        members={members}
                        chosen={lives}
                      />
                      {parties.some((x) => !members.some((m) => m.id === x.party_id)) ? (
                        <p className="text-xs text-neutral-500">
                          Someone outside {groupName} also has a role on this policy. Saving here replaces
                          both lists with the people ticked above.
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </div>
            ),
          },
        ]}
      />

      <DrawerFooter>
        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            Delete policy
          </button>
        </div>
      </DrawerFooter>

      {confirming ? (
        <DeleteRecordDialog
          record="policy"
          label={p.label}
          onDelete={() => deletePolicy(p.policy_id)}
          onCancel={() => setConfirming(false)}
          onDeleted={onDeleted}
        >
          This removes <strong className="font-semibold text-neutral-900">{p.label}</strong>
          {p.policy_number ? ` (${p.policy_number})` : ''}
          {parties.length
            ? `, with ${Array.from(new Set(parties.map((x) => x.name))).join(' and ')} as its people`
            : ''}
          . Its {covers.length === 1 ? 'cover' : `${covers.length} covers`}
          {postCount > 0
            ? ` and ${postCount} activity ${postCount === 1 ? 'post go' : 'posts go'} with it`
            : covers.length === 1
              ? ' goes with it'
              : ' go with it'}
          . The account it is held in is not touched. This cannot be undone.
        </DeleteRecordDialog>
      ) : null}
    </>
  )
}

/** One role's checkbox list, with the sentinel that gives an emptied list a
 *  meaning distinct from a control that was never shown. */
function PartyPicker({
  legend,
  field,
  sentinel,
  members,
  chosen,
}: {
  legend: string
  field: string
  sentinel: string
  members: { id: string; name: string }[]
  chosen: { party_id: string }[]
}) {
  return (
    <fieldset>
      <input type="hidden" name={sentinel} value="1" />
      <legend className="mb-1 text-xs text-neutral-500">{legend}</legend>
      {members.length === 0 ? (
        <p className="text-xs text-neutral-500">This group has no members to name.</p>
      ) : (
        <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-white"
            >
              <input
                type="checkbox"
                name={field}
                value={m.id}
                defaultChecked={chosen.some((c) => c.party_id === m.id)}
                className="h-3.5 w-3.5 accent-[var(--brand-500)]"
              />
              {m.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
