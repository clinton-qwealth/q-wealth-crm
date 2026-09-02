'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  createMember,
  linkMember,
  searchPeople,
  updateMember,
  type MemberState,
  type PersonMatch,
} from '@/app/(shell)/groups/actions'
import type { PersonDetail } from '@/lib/person'
import { CopyIcon, PlusIcon, TickIcon } from './icons'
import { Tabs } from './tabs'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-left text-xs font-medium text-neutral-600'

const MEMBER_ROLES = [
  ['primary', 'Primary'],
  ['spouse_partner', 'Spouse or partner'],
  ['dependant', 'Dependant'],
  ['other_person', 'Other person'],
  ['director', 'Director'],
  ['shareholder', 'Shareholder'],
  ['key_person', 'Key person'],
] as const

const ROLE_LABEL: Record<string, string> = Object.fromEntries(MEMBER_ROLES)

/** 'view' shows the record; 'edit' and 'create' are forms; 'search' finds someone existing. */
type Mode = 'view' | 'edit' | 'create' | 'search'

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  required,
  placeholder,
  className = '',
}: {
  label: string
  name: string
  defaultValue?: string | null
  type?: string
  required?: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className={LABEL}>{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ''}
        className={FIELD}
      />
    </label>
  )
}

/**
 * A date as DD-MM-YYYY.
 *
 * Reformatted from the ISO string by splitting it, NOT by going through `Date`.
 * `new Date('1985-04-12')` is parsed as UTC midnight, so anywhere west of
 * Greenwich `toLocaleDateString` renders the day before — a date of birth off by
 * one, which is exactly the kind of error nobody notices until it matters.
 */
function formatDate(iso?: string | null) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso
}

/**
 * A value with a copy-to-clipboard control.
 *
 * Copies exactly what is on screen rather than the underlying ISO string: the
 * point is to paste what you just read. The button is only rendered when there
 * is something to copy, so an empty field shows no affordance.
 */
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard access can be refused outright — a denied permission, or a
      // non-secure context. Staying silent is better than a scary message for
      // something the user can still select by hand.
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{value}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? 'Copied' : `Copy ${label}`}
        className="rounded p-0.5 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {copied ? (
          <TickIcon className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <CopyIcon className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  )
}

/** One label/value line in view mode. Absent values are shown as an em dash
 *  rather than hidden, so a gap in the record reads as a gap. */
function Row({
  label,
  value,
  span = 'half',
}: {
  label: string
  value?: React.ReactNode
  /** `full` crosses both columns. Long values — an address, a list of groups —
   *  wrap badly in half the width, so they take the whole row instead. */
  span?: 'half' | 'full'
}) {
  return (
    <div className={span === 'full' ? 'sm:col-span-2' : undefined}>
      {/*
        Label above value, not beside it.
        Side by side with the value right-aligned, every field opened a gap of a
        different width — "Full name" nearly filled its column while "Gender"
        left a void — so the eye travelled a different distance for each one.
        Stacking removes the contention: labels line up, values line up, and a
        long value has the whole column instead of whatever the label left over.
      */}
      <dt className="text-xs leading-snug text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm leading-snug text-neutral-900">
        {value === null || value === undefined || value === '' ? (
          <span className="text-neutral-400">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function Section({
  title,
  children,
  boxed = false,
}: {
  title: string
  children: React.ReactNode
  /** Draws a rounded border around the section's content. */
  boxed?: boolean
}) {
  // Boxed sections carry their title INSIDE the border, as a titled card.
  // With the title outside, its text sat on the panel's gutter while the fields
  // sat one padding-width further in — the heading not lining up with the thing
  // it heads. Inside, the card's edge aligns with the tabs and the name above,
  // and the title aligns with its own fields.
  if (boxed) {
    return (
      <section className="rounded-lg border border-neutral-200 px-4 py-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
        <div className="mt-3.5">{children}</div>
      </section>
    )
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>
      {/* Unboxed sections use spacing alone. Per-row rules were tried and
          removed: in a two-column grid the columns rarely hold the same number
          of rows, so the last line in the longer column stopped half way across
          and read as a mistake. */}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * The individual's record, as a drawer sliding in from the right.
 *
 * Built on the native dialog element, like the other overlays here: the brief is
 * that the rest of the UI is inactive until this is saved or closed, which is
 * exactly what a modal dialog gives — top layer, inert background, focus held
 * inside, Escape handled by the browser. A hand-rolled overlay would mean
 * hand-rolling a focus trap.
 *
 * Opens read-only. Client records are audited on every change, so brushing a
 * field while reading someone's file must not be able to alter it.
 */
export function MemberPanel({
  groupId,
  members,
  children,
  variant = 'row',
  initialMode = 'view',
  initialPartyId,
}: {
  groupId: string
  members: PersonDetail[]
  /**
   * The trigger's contents. Deliberately children rather than a render prop:
   * this is a Client Component, and a Server Component cannot pass a function
   * across that boundary — only serialisable values and elements.
   */
  children: React.ReactNode
  /** `row` sits in the members list; `link` is the quiet add affordance. */
  variant?: 'row' | 'link'
  initialMode?: Mode
  initialPartyId?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [partyId, setPartyId] = useState<string | undefined>(initialPartyId)

  const person = members.find((m) => m.party_id === partyId)

  const [createState, createAction, creating] = useActionState<MemberState, FormData>(createMember, null)
  const [updateState, updateAction, updating] = useActionState<MemberState, FormData>(updateMember, null)
  const [linkState, linkAction, linking] = useActionState<MemberState, FormData>(linkMember, null)

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<PersonMatch[]>([])
  const [searching, startSearch] = useTransition()

  const open = () => {
    setMode(initialMode)
    setPartyId(initialPartyId)
    dialogRef.current?.showModal()
  }
  const close = () => dialogRef.current?.close()

  // A successful save closes the panel. Each action has its own state, so all
  // three are watched rather than one combined flag.
  useEffect(() => {
    for (const s of [createState, updateState, linkState]) {
      if (s && 'ok' in s) {
        close()
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createState, updateState, linkState])

  // Escape closes the dialog without telling React, so state is reset on close
  // rather than on open — otherwise a reopened panel shows the previous mode.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => {
      setQuery('')
      setMatches([])
    }
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  const runSearch = (value: string) => {
    setQuery(value)
    startSearch(async () => setMatches(await searchPeople(groupId, value)))
  }

  const busy = creating || updating || linking
  const error = [createState, updateState, linkState].find((s) => s && 'error' in s) as
    | { error: string }
    | undefined

  const heading =
    mode === 'create' ? 'Add an individual'
    : mode === 'search' ? 'Add an existing person'
    : mode === 'edit' ? `Edit ${person?.display_name ?? 'individual'}`
    : (person?.display_name ?? 'Individual')

  const triggerClass =
    variant === 'row'
      ? 'flex w-full items-baseline justify-between gap-3 rounded-md border border-neutral-200/70 bg-white px-2.5 py-1.5 text-left outline-none transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:ring-2 focus-visible:ring-brand/30'
      : 'mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-white hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30'

  return (
    <>
      <button type="button" onClick={open} className={triggerClass}>
        {children}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="member-panel-title"
        onClick={(e) => {
          // Clicking the backdrop lands on the dialog itself; clicks inside the
          // panel land on the panel.
          if (e.target === dialogRef.current) close()
        }}
        className="qw-drawer w-full border-l border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/20 sm:w-[34rem] lg:w-[45%] lg:max-w-[46rem]"
      >
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
            <div className="min-w-0">
              <h2
                id="member-panel-title"
                className="truncate text-2xl font-semibold tracking-tight text-neutral-900"
              >
                {heading}
              </h2>
              {mode === 'view' && person ? (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {ROLE_LABEL[person.member_role ?? ''] ?? person.member_role}
                  {person.is_primary_group ? ' · primary group' : ''}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close panel"
              className="-mr-1 shrink-0 rounded-md p-1.5 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </header>

          {mode === 'view' && person ? (
            <>
              {/* Tabs rather than one long scroll: at this width the record is
                  three distinct kinds of information, and an adviser opening the
                  panel usually wants one of them. `fill` keeps the strip in place
                  and lets the active panel scroll beneath it. */}
              {/* Five tabs, so each is one question an adviser is actually
                  asking. `alignFirst` lines the first label up with the name
                  above and the values below. */}
              <Tabs
                fill
                gutter={5}
                flushTop={false}
                bleed={false}
                alignFirst
                label={`${person.display_name} record`}
                items={[
                  {
                    id: 'personal',
                    label: 'Personal',
                    panel: (
                      <div className="flex flex-col gap-7 px-5 pb-6">
                        <Section title="Identity" boxed>
                          {/* Two real columns, each stacking its own fields, so
                              the order down a column is what was asked for. A
                              single grid with auto-flow would fill left, right,
                              left instead, which reads as a different order. */}
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-4">
                              <Row span="full" label="Full name" value={[person.title, person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ')} />
                              <Row span="full" label="Gender" value={person.gender} />
                              <Row span="full" label="Marital status" value={person.marital_status} />
                            </div>
                            <div className="flex flex-col gap-4">
                              <Row span="full" label="Known as" value={person.preferred_name} />
                              <Row
                                span="full"
                                label="Date of birth"
                                value={
                                  person.date_of_birth ? (
                                    <CopyValue
                                      value={formatDate(person.date_of_birth)!}
                                      label="date of birth"
                                    />
                                  ) : null
                                }
                              />
                            </div>
                          </dl>
                        </Section>
                      </div>
                    ),
                  },
                  {
                    id: 'contact',
                    label: 'Contact',
                    panel: (
                      <div className="flex flex-col gap-7 px-5 pb-6">
                        <Section title="Reachable on">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <Row label="Email" value={person.email} />
                            <Row label="Mobile" value={person.mobile} />
                            <Row label="Other phone" value={person.phone_other} />
                          </dl>
                        </Section>
                        <Section title="Residential address">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <Row span="full" label="Street" value={[person.address.line1, person.address.line2].filter(Boolean).join(', ')} />
                            <Row span="full" label="Suburb" value={person.address.suburb} />
                            <Row label="State" value={person.address.state} />
                            <Row label="Postcode" value={person.address.postcode} />
                          </dl>
                        </Section>
                      </div>
                    ),
                  },
                  {
                    id: 'compliance',
                    label: 'Compliance',
                    panel: (
                      <div className="flex flex-col gap-7 px-5 pb-6">
                        <Section title="Standing with the firm">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <Row label="Roles" value={person.roles.map((r) => r.role.replace(/_/g, ' ')).join(', ')} />
                            <Row label="Client since" value={person.roles.find((r) => r.role === 'client')?.start_date} />
                            <Row label="Record status" value={person.status} />
                          </dl>
                        </Section>
                        <Section title="Identifiers">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4">
                            <Row
                              span="full"
                              label="Tax file number"
                              value={
                                person.tfn_status === 'provided' ? 'On file — reveal in the CRM only'
                                : person.tfn_status === 'exempt' ? 'Exempt'
                                : 'Not provided'
                              }
                            />
                          </dl>
                          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                            Revealing a tax file number requires a verified second factor and is
                            recorded against your name. Passport, licence and Medicare are held the
                            same way but have no screen yet.
                          </p>
                        </Section>
                      </div>
                    ),
                  },
                  {
                    id: 'estate',
                    label: 'Estate',
                    panel: (
                      <div className="flex flex-col gap-7 px-5 pb-6">
                        <Section title="Estate">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <Row label="Date of death" value={person.date_of_death} />
                          </dl>
                        </Section>
                        {/* Honest empty state. The database holds no will, power
                            of attorney or beneficiary tables yet, so this tab has
                            one real field. Saying so is better than an empty
                            panel that looks broken. */}
                        <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-6">
                          <p className="text-sm font-medium text-neutral-700">
                            Estate detail is not modelled yet
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                            Wills, enduring powers of attorney, appointed executors and
                            beneficiary nominations have no tables in the database. Date of death
                            is the only estate field that exists today.
                          </p>
                        </div>
                      </div>
                    ),
                  },
                  {
                    id: 'other',
                    label: 'Other',
                    panel: (
                      <div className="flex flex-col gap-7 px-5 pb-6">
                        <Section title="Group membership">
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <Row label="Role in this group" value={ROLE_LABEL[person.member_role ?? ''] ?? person.member_role} />
                            <Row label="Primary group" value={person.is_primary_group ? 'Yes' : 'No'} />
                            <Row
                              span="full"
                              label="Other groups"
                              value={person.other_groups
                                .map((g) => `${g.name} (${g.member_role.replace(/_/g, ' ')})`)
                                .join(', ')}
                            />
                          </dl>
                        </Section>
                        <Section title="Notes">
                          {person.notes ? (
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
                              {person.notes}
                            </p>
                          ) : (
                            <p className="text-sm text-neutral-400">Nothing recorded.</p>
                          )}
                        </Section>
                      </div>
                    ),
                  },
                ]}
              />

              <footer className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Edit
                </button>
              </footer>
            </>
          ) : null}

          {mode === 'search' ? (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL}>Search people already on file</span>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => runSearch(e.target.value)}
                    placeholder="Start typing a name"
                    className={FIELD}
                  />
                </label>

                <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                  If they are already a client of the firm, add the existing record rather than
                  creating a second one.
                </p>

                <div className="mt-4 flex flex-col gap-1.5">
                  {searching ? (
                    <p className="py-6 text-center text-xs text-neutral-400">Searching…</p>
                  ) : query.trim().length < 2 ? null : matches.length === 0 ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      Nobody on file matches that.
                    </p>
                  ) : (
                    matches.map((m) => (
                      <form key={m.party_id} action={linkAction}>
                        <input type="hidden" name="group_id" value={groupId} />
                        <input type="hidden" name="party_id" value={m.party_id} />
                        <input type="hidden" name="member_role" value="other_person" />
                        <button
                          type="submit"
                          disabled={busy}
                          className="flex w-full items-baseline justify-between gap-3 rounded-md border border-neutral-200/70 bg-white px-3 py-2 text-left outline-none transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-neutral-800">
                              {m.display_name}
                            </span>
                            <span className="block truncate text-xs text-neutral-400">
                              {m.detail}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-medium text-brand">Add</span>
                        </button>
                      </form>
                    ))
                  )}
                </div>

                {error ? (
                  <p role="alert" className="mt-3 text-sm text-red-600">
                    {error.error}
                  </p>
                ) : null}
              </div>

              <footer className="flex items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-brand outline-none transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <PlusIcon className="h-4 w-4" />
                  Create someone new
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  Cancel
                </button>
              </footer>
            </>
          ) : null}

          {mode === 'create' || mode === 'edit' ? (
            <form
              action={mode === 'create' ? createAction : updateAction}
              className="flex min-h-0 flex-1 flex-col"
            >
              <input type="hidden" name="group_id" value={groupId} />
              {mode === 'edit' && person ? (
                <input type="hidden" name="party_id" value={person.party_id} />
              ) : null}

              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="flex flex-col gap-6">
                  <Section title="Identity">
                    <div className="grid grid-cols-6 gap-3">
                      <Field label="Title" name="title" defaultValue={person?.title} className="col-span-2" placeholder="Mr" />
                      <Field label="First name" name="first_name" defaultValue={person?.first_name} required className="col-span-4" />
                      <Field label="Middle name" name="middle_name" defaultValue={person?.middle_name} className="col-span-3" />
                      <Field label="Last name" name="last_name" defaultValue={person?.last_name} required className="col-span-3" />
                      <Field label="Known as" name="preferred_name" defaultValue={person?.preferred_name} className="col-span-3" placeholder="Optional" />
                      <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={person?.date_of_birth} className="col-span-3" />
                      <Field label="Gender" name="gender" defaultValue={person?.gender} className="col-span-3" placeholder="Optional" />
                      <Field label="Marital status" name="marital_status" defaultValue={person?.marital_status} className="col-span-3" placeholder="Optional" />
                    </div>
                  </Section>

                  <Section title="Role in this group">
                    <label className="flex flex-col gap-1.5">
                      <span className={LABEL}>Member role</span>
                      <select
                        name="member_role"
                        defaultValue={person?.member_role ?? 'other_person'}
                        className={FIELD}
                      >
                        {MEMBER_ROLES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </Section>

                  <Section title="Contact">
                    <div className="grid grid-cols-6 gap-3">
                      <Field label="Email" name="email" type="email" defaultValue={person?.email} className="col-span-6" />
                      <Field label="Mobile" name="mobile" defaultValue={person?.mobile} className="col-span-3" />
                      <Field label="Other phone" name="phone_other" defaultValue={person?.phone_other} className="col-span-3" />
                      <Field label="Address" name="addr_line1" defaultValue={person?.address.line1} className="col-span-6" placeholder="Street address" />
                      <Field label="Line 2" name="addr_line2" defaultValue={person?.address.line2} className="col-span-6" placeholder="Optional" />
                      <Field label="Suburb" name="addr_suburb" defaultValue={person?.address.suburb} className="col-span-3" />
                      <Field label="State" name="addr_state" defaultValue={person?.address.state} className="col-span-1" />
                      <Field label="Postcode" name="addr_postcode" defaultValue={person?.address.postcode} className="col-span-2" />
                    </div>
                  </Section>

                  <Section title="Notes">
                    <textarea
                      name="notes"
                      rows={3}
                      defaultValue={person?.notes ?? ''}
                      placeholder="Anything worth knowing about this person"
                      className={`${FIELD} resize-y`}
                    />
                  </Section>

                  {error ? (
                    <p role="alert" className="text-sm text-red-600">
                      {error.error}
                    </p>
                  ) : null}
                </div>
              </div>

              <footer className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
                <button
                  type="button"
                  onClick={() => (mode === 'edit' && person ? setMode('view') : close())}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {busy ? 'Saving…' : mode === 'create' ? 'Add individual' : 'Save changes'}
                </button>
              </footer>
            </form>
          ) : null}
        </div>
      </dialog>
    </>
  )
}
