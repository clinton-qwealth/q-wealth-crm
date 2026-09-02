'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  createMember,
  linkMember,
  patchMember,
  revealSensitiveField,
  searchPeople,
  type MemberState,
  type PersonMatch,
} from '@/app/(shell)/groups/actions'
import type { PersonDetail } from '@/lib/person'
import { CopyIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, TickIcon } from './icons'
import { Tabs } from './tabs'
import { Pill } from './ui'
import { COUNTRIES, countryName, EMPLOYMENT_STATUS, employmentLabel } from '@/lib/countries'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-left text-xs font-medium text-neutral-600'

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }))

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

/** 'view' shows the record and edits it section by section; 'create' is the new-person
 *  form; 'search' finds someone who already exists. */
type Mode = 'view' | 'create' | 'search'

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
 * Smoker status has three states, not two.
 *
 * A plain on/off toggle can only say yes or no, and defaulting to "non-smoker"
 * asserts something nobody has established — while materially changing an
 * insurance premium. So null is a real, visible value here.
 */
function smokerLabel(smoker: boolean | null) {
  if (smoker === null || smoker === undefined) return null
  return smoker ? 'Smoker' : 'Non-smoker'
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

/**
 * An encrypted identifier: masked by default, revealed on request.
 *
 * The masked form is the stored hint — dots plus the last few characters, which
 * is enough to check you are looking at the right record without exposing it.
 * Pressing the eye calls reveal_sensitive_field, which decrypts, checks the
 * caller holds `view_sensitive`, and writes a row to sensitive_access_log naming
 * them. So a reveal is a recorded act, not a free look.
 *
 * The value hides itself again after half a minute. A tax file number left on a
 * screen in an open-plan office is the ordinary way these leak, and nobody
 * remembers to click twice.
 */
function Encrypted({
  partyId,
  kind,
  hint,
  status,
}: {
  partyId: string
  kind: string
  hint?: string
  status?: string
}) {
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (value === null) return
    const t = window.setTimeout(() => setValue(null), 30_000)
    return () => window.clearTimeout(t)
  }, [value])

  if (!hint) {
    if (status === 'exempt') return <span className="text-neutral-500">Exempt</span>
    return <span className="text-neutral-400">Not provided</span>
  }

  const toggle = async () => {
    if (value !== null) {
      setValue(null)
      return
    }
    setBusy(true)
    setError(null)
    const result = await revealSensitiveField(partyId, kind)
    setBusy(false)
    if ('error' in result) setError(result.error)
    else setValue(result.value)
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[13px] tracking-tight">
          {value ?? hint}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-label={value === null ? 'Reveal, which is recorded against your name' : 'Hide'}
          title={value === null ? 'Reveal — recorded against your name' : 'Hide'}
          className="rounded p-0.5 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          {value === null ? (
            <EyeIcon className="h-3.5 w-3.5" />
          ) : (
            <EyeOffIcon className="h-3.5 w-3.5 text-brand" />
          )}
        </button>
        {value !== null ? <CopyValue value={value} label={kind} /> : null}
      </span>
      {error ? (
        <span role="alert" className="text-[11px] text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  )
}

function Select({
  label,
  name,
  defaultValue,
  options,
  placeholder = 'Not recorded',
  className = '',
}: {
  label: string
  name: string
  defaultValue?: string | null
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className={LABEL}>{label}</span>
      <select name={name} defaultValue={defaultValue ?? ''} className={FIELD}>
        {/* An explicit empty option, so "we have not asked" is selectable
            rather than being whatever happens to sort first. */}
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
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

/**
 * A section that can be edited on its own.
 *
 * The pencil replaces the panel-wide Edit button. Correcting one phone number
 * should not turn the whole record into a form — and a form covering twenty
 * fields is twenty chances to change something by accident, on a record where
 * every change is audited.
 *
 * Each section owns its own form, so the submitted fields ARE the patch:
 * update_person_patch leaves every column the form does not mention untouched.
 * That is the whole reason this is safe to do per section.
 */
function EditableSection({
  title,
  partyId,
  groupId,
  view,
  edit,
  boxed = false,
}: {
  title: string
  partyId: string
  groupId: string
  view: React.ReactNode
  /** The inputs. Their `name` attributes become the patch keys. */
  edit: React.ReactNode
  boxed?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState<MemberState, FormData>(patchMember, null)

  // A save closes the section back to its read-only form — the revalidate on the
  // server has already refreshed the values behind it. Adjusted during render
  // rather than in an effect, so the edit form never paints once more after a
  // successful save; `handled` is the action state already acted on, since
  // useActionState hands back a new object on every submission.
  const [handled, setHandled] = useState<MemberState>(null)
  if (state !== handled) {
    setHandled(state)
    if (state && 'ok' in state) setEditing(false)
  }

  const error = state && 'error' in state ? state.error : null

  const header = (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${title.toLowerCase()}`}
          title={`Edit ${title.toLowerCase()}`}
          className="rounded-md p-1 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  const body = (
    <>
      {header}
      <div className="mt-3.5">{editing ? edit : view}</div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </>
  )

  // The whole section is the form, so the header's Save button submits it
  // without needing to reach across the tree.
  return (
    <form
      action={action}
      className={boxed ? 'rounded-lg border border-neutral-200 px-4 py-4' : undefined}
    >
      {/* Only while editing. A section being read renders nothing submittable,
          which keeps "reading a record cannot change it" true of the DOM and
          not merely of intent. */}
      {editing ? (
        <>
          <input type="hidden" name="party_id" value={partyId} />
          <input type="hidden" name="group_id" value={groupId} />
        </>
      ) : null}
      {body}
    </form>
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

  // A successful save closes the panel. Each action has its own state, so both
  // are watched rather than one combined flag.
  useEffect(() => {
    for (const s of [createState, linkState]) {
      if (s && 'ok' in s) {
        close()
        break
      }
    }
  }, [createState, linkState])

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

  const busy = creating || linking
  const error = [createState, linkState].find((s) => s && 'error' in s) as
    | { error: string }
    | undefined

  const heading =
    mode === 'create' ? 'Add an individual'
    : mode === 'search' ? 'Add an existing person'
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
        className="qw-drawer w-full border-l border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/20 sm:w-[34rem] lg:w-[45%] lg:min-w-[34rem] lg:max-w-[46rem]"
      >
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2
                  id="member-panel-title"
                  className="truncate text-2xl font-semibold tracking-tight text-neutral-900"
                >
                  {heading}
                </h2>
                {/* A date of death changes what almost every other field on this
                    record means, so it is marked where the name is rather than
                    left three tabs away for someone to notice. */}
                {person?.date_of_death ? <Pill tone="danger">Deceased</Pill> : null}
              </div>
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
                      <div className="flex flex-col gap-4 px-5 pb-6">
                        <EditableSection
                          title="Identity"
                          partyId={person.party_id}
                          groupId={groupId}
                          boxed
                          view={
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                              <div className="flex flex-col gap-4">
                                <Row span="full" label="Full name" value={[person.title, person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ')} />
                                <Row span="full" label="Gender" value={person.gender} />
                                <Row span="full" label="Marital status" value={person.marital_status} />
                                <Row span="full" label="Place of birth" value={person.place_of_birth} />
                              </div>
                              <div className="flex flex-col gap-4">
                                <Row span="full" label="Known as" value={person.preferred_name} />
                                <Row
                                  span="full"
                                  label="Date of birth"
                                  value={
                                    person.date_of_birth ? (
                                      <CopyValue value={formatDate(person.date_of_birth)!} label="date of birth" />
                                    ) : null
                                  }
                                />
                                <Row span="full" label="Smoker status" value={smokerLabel(person.smoker)} />
                                <Row span="full" label="Date of death" value={formatDate(person.date_of_death)} />
                              </div>
                            </dl>
                          }
                          edit={
                            /* Twelve columns. The given names share the first row
                               2/5/5, and the surname takes half of the second —
                               at four across, a long surname clipped inside its
                               box, and a surname is the field least tolerable to
                               have to scroll while checking it. Two columns below
                               `sm`, because three inputs across a phone-width
                               drawer is unusable. */
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                              <Field label="Title" name="title" defaultValue={person.title} className="sm:col-span-2" />
                              <Field label="First name" name="first_name" defaultValue={person.first_name} required className="sm:col-span-5" />
                              <Field label="Middle name" name="middle_name" defaultValue={person.middle_name} className="sm:col-span-5" />
                              <Field label="Last name" name="last_name" defaultValue={person.last_name} required className="sm:col-span-6" />
                              <Field label="Known as" name="preferred_name" defaultValue={person.preferred_name} className="sm:col-span-6" />
                              <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={person.date_of_birth} className="sm:col-span-6" />
                              <Field label="Gender" name="gender" defaultValue={person.gender} className="sm:col-span-6" />
                              <Field label="Marital status" name="marital_status" defaultValue={person.marital_status} className="sm:col-span-6" />
                              <Field label="Place of birth" name="place_of_birth" defaultValue={person.place_of_birth} className="sm:col-span-6" />
                              <Select
                                label="Smoker status"
                                name="smoker"
                                defaultValue={person.smoker === null ? '' : String(person.smoker)}
                                placeholder="Not asked"
                                options={[
                                  { value: 'false', label: 'Non-smoker' },
                                  { value: 'true', label: 'Smoker' },
                                ]}
                                className="sm:col-span-6"
                              />
                              <Field label="Date of death" name="date_of_death" type="date" defaultValue={person.date_of_death} className="sm:col-span-6" />
                            </div>
                          }
                        />

                        <EditableSection
                          title="Citizenship and tax residency"
                          partyId={person.party_id}
                          groupId={groupId}
                          boxed
                          view={
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                              <div className="flex flex-col gap-4">
                                <Row span="full" label="Primary citizenship" value={countryName(person.primary_citizenship)} />
                                <Row span="full" label="Secondary citizenship" value={countryName(person.secondary_citizenship)} />
                              </div>
                              <div className="flex flex-col gap-4">
                                <Row span="full" label="Tax residency" value={countryName(person.tax_residency)} />
                              </div>
                            </dl>
                          }
                          edit={
                            <div className="grid grid-cols-6 gap-3">
                              <Select label="Primary citizenship" name="primary_citizenship" defaultValue={person.primary_citizenship} options={COUNTRY_OPTIONS} className="col-span-3" />
                              <Select label="Secondary citizenship" name="secondary_citizenship" defaultValue={person.secondary_citizenship} options={COUNTRY_OPTIONS} className="col-span-3" />
                              <Select label="Tax residency" name="tax_residency" defaultValue={person.tax_residency} options={COUNTRY_OPTIONS} className="col-span-3" />
                            </div>
                          }
                        />

                        <EditableSection
                          title="Employment"
                          partyId={person.party_id}
                          groupId={groupId}
                          boxed
                          view={
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                              <div className="flex flex-col gap-4">
                                <Row span="full" label="Employment status" value={employmentLabel(person.employment_status)} />
                                <Row span="full" label="Occupation" value={person.occupation} />
                              </div>
                              <div className="flex flex-col gap-4">
                                <Row span="full" label="Company name" value={person.company_name} />
                              </div>
                            </dl>
                          }
                          edit={
                            <div className="grid grid-cols-6 gap-3">
                              <Select label="Employment status" name="employment_status" defaultValue={person.employment_status} options={EMPLOYMENT_STATUS} className="col-span-3" />
                              <Field label="Occupation" name="occupation" defaultValue={person.occupation} className="col-span-3" />
                              <Field label="Company name" name="company_name" defaultValue={person.company_name} className="col-span-6" />
                            </div>
                          }
                        />

                        <EditableSection
                          title="Identifiers"
                          partyId={person.party_id}
                          groupId={groupId}
                          boxed
                          edit={
                            <div className="grid grid-cols-6 gap-3">
                              <Field label="Holder identification number (HIN)" name="hin" defaultValue={person.hin} className="col-span-3" />
                              <Field label="CHESS sponsor ID (PID)" name="chess_pid" defaultValue={person.chess_pid} className="col-span-3" />
                              {/* The four encrypted identifiers are absent from
                                  this form on purpose: writing one goes through
                                  set_sensitive_field, which enforces the
                                  permission and the second factor and logs the
                                  write. Including them here would bypass all of
                                  that silently. */}
                              <p className="col-span-6 text-xs leading-relaxed text-neutral-500">
                                Only the HIN and CHESS PID are edited here. The encrypted
                                identifiers are changed through their own flow, which records who
                                changed them.
                              </p>
                            </div>
                          }
                          view={
                            <>
                          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-4">
                              <Row span="full" label="Tax file number" value={<Encrypted partyId={person.party_id} kind="tfn" hint={person.hints.tfn} status={person.tfn_status} />} />
                              <Row span="full" label="Tax identification number" value={<Encrypted partyId={person.party_id} kind="tin" hint={person.hints.tin} />} />
                              <Row span="full" label="Centrelink reference number" value={<Encrypted partyId={person.party_id} kind="centrelink_crn" hint={person.hints.centrelink_crn} />} />
                            </div>
                            <div className="flex flex-col gap-4">
                              <Row span="full" label="Holder identification number (HIN)" value={person.hin ? <CopyValue value={person.hin} label="HIN" /> : null} />
                              <Row span="full" label="CHESS sponsor ID (PID)" value={person.chess_pid} />
                              <Row span="full" label="Director identification number" value={<Encrypted partyId={person.party_id} kind="director_id" hint={person.hints.director_id} />} />
                            </div>
                          </dl>
                          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
                            Masked by default. These four are stored encrypted, and pressing the
                            eye decrypts one — which is <span className="font-medium">recorded
                            against your name</span> in the access log, and hides itself again
                            after thirty seconds. The HIN and CHESS PID are plain text: a HIN
                            appears on every holding statement, and a PID identifies the broker
                            rather than the client. None of the four are ever visible to Claude.
                              </p>
                            </>
                          }
                        />

                        <EditableSection
                          title="Preferences"
                          partyId={person.party_id}
                          groupId={groupId}
                          boxed
                          view={
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-4">
                              <Row span="full" label="Coffee preference" value={person.coffee_preference} />
                            </dl>
                          }
                          edit={<Field label="Coffee preference" name="coffee_preference" defaultValue={person.coffee_preference} placeholder="Flat white, no sugar" />}
                        />
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
                        <EditableSection
                          title="Residential address"
                          partyId={person.party_id}
                          groupId={groupId}
                          boxed
                          view={
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                              <Row span="full" label="Street" value={[person.address.line1, person.address.line2].filter(Boolean).join(', ')} />
                              <Row span="full" label="Suburb" value={person.address.suburb} />
                              <Row label="State" value={person.address.state} />
                              <Row label="Postcode" value={person.address.postcode} />
                            </dl>
                          }
                          edit={
                            /* All five address inputs together, always. The address is one
                               row with several columns, so update_person_patch takes them as
                               a unit — a form submitting only some would blank the rest. */
                            <div className="grid grid-cols-6 gap-3">
                              <Field label="Street" name="addr_line1" defaultValue={person.address.line1} className="col-span-6" />
                              <Field label="Line 2" name="addr_line2" defaultValue={person.address.line2} className="col-span-6" />
                              <Field label="Suburb" name="addr_suburb" defaultValue={person.address.suburb} className="col-span-3" />
                              <Field label="State" name="addr_state" defaultValue={person.address.state} className="col-span-1" />
                              <Field label="Postcode" name="addr_postcode" defaultValue={person.address.postcode} className="col-span-2" />
                            </div>
                          }
                        />
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
                          {/* Identifiers moved to Personal when the other four were
                              added — the tax file number was showing in both places,
                              read-only here and revealable there. One field, one home. */}
                          <Section title="Documents on file">
                            <p className="text-sm leading-relaxed text-neutral-500">
                              Passport, driver&rsquo;s licence and Medicare are held encrypted the
                              same way as the identifiers on the Personal tab, but have no screen
                              yet. Identity verification records have no tables in the database.
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

          {mode === 'create' ? (
            <form
              action={createAction}
              className="flex min-h-0 flex-1 flex-col"
            >
              <input type="hidden" name="group_id" value={groupId} />

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

                  <Section title="Citizenship, tax and employment">
                    <div className="grid grid-cols-6 gap-3">
                      <Field label="Place of birth" name="place_of_birth" defaultValue={person?.place_of_birth} className="col-span-6" placeholder="Town and country" />
                      <Select
                        label="Smoker status"
                        name="smoker"
                        defaultValue={person?.smoker === null || person?.smoker === undefined ? '' : String(person.smoker)}
                        placeholder="Not asked"
                        options={[
                          { value: 'false', label: 'Non-smoker' },
                          { value: 'true', label: 'Smoker' },
                        ]}
                        className="col-span-3"
                      />
                      <Field label="Date of death" name="date_of_death" type="date" defaultValue={person?.date_of_death} className="col-span-3" />
                      <Select label="Primary citizenship" name="primary_citizenship" defaultValue={person?.primary_citizenship} options={COUNTRY_OPTIONS} className="col-span-3" />
                      <Select label="Secondary citizenship" name="secondary_citizenship" defaultValue={person?.secondary_citizenship} options={COUNTRY_OPTIONS} className="col-span-3" />
                      <Select label="Tax residency" name="tax_residency" defaultValue={person?.tax_residency} options={COUNTRY_OPTIONS} className="col-span-3" />
                      <Select label="Employment status" name="employment_status" defaultValue={person?.employment_status} options={EMPLOYMENT_STATUS} className="col-span-3" />
                      <Field label="Occupation" name="occupation" defaultValue={person?.occupation} className="col-span-3" />
                      <Field label="Company name" name="company_name" defaultValue={person?.company_name} className="col-span-3" />
                    </div>
                  </Section>

                  <Section title="Identifiers">
                    <div className="grid grid-cols-6 gap-3">
                      <Field label="Holder identification number (HIN)" name="hin" defaultValue={person?.hin} className="col-span-3" />
                      <Field label="CHESS sponsor ID (PID)" name="chess_pid" defaultValue={person?.chess_pid} className="col-span-3" />
                    </div>
                    {/* The encrypted identifiers are absent from this form on
                        purpose. Writing one goes through set_sensitive_field,
                        which enforces view_sensitive and a verified second
                        factor and logs the write; routing them through this save
                        would have bypassed both silently. */}
                    <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                      Tax file number, tax identification number, Centrelink reference and
                      director ID are not edited here. They are encrypted, and changing one
                      requires a verified second factor and is recorded against your name.
                    </p>
                  </Section>

                  <Section title="Preferences">
                    <Field label="Coffee preference" name="coffee_preference" defaultValue={person?.coffee_preference} placeholder="Flat white, no sugar" />
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
                  onClick={close}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {busy ? 'Adding…' : 'Add individual'}
                </button>
              </footer>
            </form>
          ) : null}
        </div>
      </dialog>
    </>
  )
}
