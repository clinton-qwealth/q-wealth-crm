'use client'

import { useRef, useState, useTransition } from 'react'
import {
  addUsersToUserGroup,
  approveStaffRegistration,
  declineStaffRegistration,
  saveStaffDetails,
  setStaffAvatar,
} from '@/app/(shell)/admin/actions'
import type { AccessProfileChoice, StaffRow } from '@/lib/admin'
import type { UserGroupChoice } from '@/lib/user-groups'
import {
  isStaffAvatarType,
  STAFF_AVATAR_BUCKET,
  STAFF_AVATAR_MIME_TYPES,
  STAFF_AVATAR_SIZE_LIMIT,
  staffAvatarPath,
} from '@/lib/avatar'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Avatar } from './avatar'
import { CheckboxSet } from './checkbox-set'
import { DataRow } from './data-section'
import { Drawer, DrawerBody, DrawerHeader } from './drawer'
import { EditField, Field, FIELD_INPUT, FieldBox, ReadonlyField } from './field-box'
import { Pill, SHEET } from './ui'
import { fullName } from '@/lib/staff-name'
import { formatBirthDate, formatNoteDateTime } from '@/lib/note-date'

/**
 * The staff, and the one drawer that edits any of them.
 *
 * The account list's shape: rows as data, one `Drawer`, `selectedId` naming
 * the open record so a rename reaches the open heading after revalidation.
 * Three `FieldBox`es carry the edits — Photo, Details, Access, in that order
 * since 20 Sep 2026 — each a form of its own, because each is a different fact
 * about the person.
 *
 * ## Two things the screen says plainly
 *
 * **Status is the kill switch.** Inactive removes access at once, everywhere —
 * the web app and any connected Claude session — because every rule in the
 * database requires an active row. It is reversible. On the viewer's OWN row
 * the status control is not on the form at all: a control that is not there
 * is a key absent from the patch, which is the right meaning, and the
 * database refuses the attempt anyway.
 *
 * **Email is not the sign-in email.** It is where the CRM contacts the person;
 * changing it here changes nothing about how they sign in.
 *
 * ## The photo
 *
 * Uploaded from the browser with the person's own session to a path under the
 * staff member's id — the bucket's own limits and policies are the rule, the
 * checks here the courtesy that says so before a round trip — then the row is
 * pointed at it, and only then are the old bytes removed. No pencil on the box:
 * it is two buttons, not a form.
 */
type Viewer = { id: string }

/**
 * A green light beside the name of somebody holding a session.
 *
 * A light rather than a pill, because it is not the same KIND of fact as the
 * profile and status pills it used to sit among: those are properties of the
 * record, this is something happening now. It moved out of the row's right-hand
 * meta column on 20 September for the same reason — a state that belongs to the
 * person reads next to the person, not in the column of record attributes.
 *
 * The colour is not the message. A green dot alone says nothing to a screen
 * reader and nothing to anyone who cannot separate it from the background, so
 * the words ride along in an `sr-only` span and the dot itself is hidden from
 * the accessibility tree. `title` gives the same words to a pointer.
 */
function SignedIn() {
  return (
    /* No `title`: it would only repeat the words on hover. */
    <span data-slot="signed-in" className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="qw-live" />
      {/* The words, in the `success` pill's own green, so the dot and the label
          read as one mark rather than two greens. NOT `sr-only` as well — a
          screen reader would say it twice.

          On the row as well as the record since 20 Sep 2026. The row's name is
          `min-w-0 truncate` and this sits in a `shrink-0` slot, so a long name
          gives way rather than squeezing the mark — the contract `DataRow`'s
          `indicator` slot exists to keep, and the one the removed `badge` prop
          could not. */}
      <span className="whitespace-nowrap text-xs font-medium text-emerald-700">Signed in</span>
    </span>
  )
}

/**
 * Put everybody ticked into one user group, from the list.
 *
 * The errand this exists for is the first one: carving a hundred people into
 * territories. Doing that a group at a time, a person at a time, is the part
 * that actually takes an afternoon.
 *
 * **Additive, never subtractive.** The database function only ever adds, so
 * pressing this cannot undo work another administrator is doing in the same
 * group — which is exactly what a set-replacing Save would do. It reports how
 * many rows it really wrote, so somebody already in the group is not counted.
 *
 * Only ACTIVE people can be ticked, and only active groups are offered: the
 * database refuses the other cases, and a control that offers a refusal is
 * worse than no control.
 */
function BulkAssign({
  staffIds,
  userGroups,
  onDone,
}: {
  staffIds: string[]
  userGroups: UserGroupChoice[]
  onDone: () => void
}) {
  const [groupId, setGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const options = userGroups.filter((g) => g.status === 'active')

  function assign() {
    setError(null)
    setDone(null)
    start(async () => {
      const result = await addUsersToUserGroup(groupId, staffIds)
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      const added = result && 'added' in result ? result.added : 0
      /* The number the DATABASE wrote, not the number ticked — the difference is
         everybody who was already a member, and saying "Added 15" when it wrote
         12 is the kind of small lie that costs trust in the whole screen. */
      setDone(
        added === 0
          ? 'Everybody chosen was already a member.'
          : `Added ${added} ${added === 1 ? 'user' : 'users'}.`,
      )
      /* The selection is deliberately KEPT. Clearing it here unmounts this bar,
         which takes the sentence above with it — press Add, see nothing. Holding
         it also makes the common next move cheap: the same batch into a second
         territory. `Clear` is right there when the batch is finished. */
    })
  }

  return (
    <div
      data-slot="bulk-assign"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2"
    >
      <span className="text-sm font-medium text-neutral-800">
        {staffIds.length} {staffIds.length === 1 ? 'user' : 'users'} selected
      </span>
      <select
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        disabled={busy || options.length === 0}
        aria-label="User group to add them to"
        className={FIELD_INPUT + ' w-auto'}
      >
        <option value="">{options.length === 0 ? 'No active user groups' : 'Choose a user group…'}</option>
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={assign}
        disabled={busy || groupId === ''}
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {busy ? 'Adding…' : 'Add to user group'}
      </button>
      <button
        type="button"
        onClick={onDone}
        disabled={busy}
        className="rounded-md px-2 py-1 text-sm font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        Clear
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="w-full text-xs text-neutral-600">
          {done}
        </p>
      ) : null}
    </div>
  )
}

export function StaffList({
  staff,
  profiles,
  userGroups,
  viewer,
}: {
  staff: StaffRow[]
  profiles: AccessProfileChoice[]
  /** Every user group, with its status; the picker offers the active ones. */
  userGroups: UserGroupChoice[]
  viewer: Viewer
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /* Who is ticked for a bulk action. Kept here rather than on the rows so the
     bar above the list and the rows cannot disagree about it. */
  const [chosen, setChosen] = useState<string[]>([])
  /* The queue and the list are the same rows in two states. A pending person
     is not yet on the staff, so they are not in the list they would be edited
     from; they are in the queue, where the only two things to do are the two
     things that can be done. */
  const waiting = staff.filter((s) => s.status === 'pending')
  const members = staff.filter((s) => s.status !== 'pending')
  const person = members.find((s) => s.id === selectedId) ?? null
  /* Only an ACTIVE person can join a user group — the database says so, and a
     checkbox on somebody it would refuse is a control that lies. */
  const selectable = members.filter((s) => s.status === 'active')
  const picked = chosen.filter((id) => selectable.some((s) => s.id === id))

  return (
    <>
      {waiting.length > 0 ? <AwaitingApproval requests={waiting} profiles={profiles} /> : null}

      {picked.length > 0 ? (
        <BulkAssign
          staffIds={picked}
          userGroups={userGroups}
          onDone={() => setChosen([])}
        />
      ) : null}

      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {members.map((s) => (
            <DataRow
              key={s.id}
              select={
                s.status === 'active' ? (
                  <input
                    type="checkbox"
                    checked={picked.includes(s.id)}
                    onChange={(e) =>
                      setChosen((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                    }
                    aria-label={`Select ${fullName(s)}`}
                    className="h-3.5 w-3.5 accent-brand"
                  />
                ) : null
              }
              leading={<Avatar staffId={s.id} firstName={s.first_name} lastName={s.last_name} avatarPath={s.avatar_path} />}
              primary={fullName(s)}
              indicator={s.signed_in ? <SignedIn /> : null}
              secondary={s.email}
              meta={
                <span className="flex items-center gap-1.5">
                  <Pill tone="brand">{s.profile?.name ?? 'No profile'}</Pill>
                  <Pill on={s.status === 'active'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Pill>
                </span>
              }
              trigger={{ label: `Open ${fullName(s)}`, onClick: () => setSelectedId(s.id) }}
            />
          ))}
        </ul>
      </div>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} labelledBy="staff-drawer-title">
        {person ? (
          <StaffPanel
            person={person}
            profiles={profiles}
            userGroups={userGroups}
            viewer={viewer}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <>
            <DrawerHeader id="staff-drawer-title" title="Staff member" onClose={() => setSelectedId(null)} />
            <DrawerBody>
              <p className="text-sm leading-relaxed text-neutral-600">This person is no longer on the list.</p>
            </DrawerBody>
          </>
        )}
      </Drawer>
    </>
  )
}

function StaffPanel({
  person: p,
  profiles,
  userGroups,
  viewer,
  onClose,
}: {
  person: StaffRow
  profiles: AccessProfileChoice[]
  userGroups: UserGroupChoice[]
  viewer: Viewer
  onClose: () => void
}) {
  const self = p.id === viewer.id
  const active = p.status === 'active'
  const identity = <input type="hidden" name="staff_id" value={p.id} />
  const current = profiles.find((x) => x.id === p.profile?.id)
  /* What the picker offers: every ACTIVE group, plus any archived group this
     person already holds, named as such. Without the second half an unrelated
     save of the Access box would silently drop that membership — the set is
     replaced with exactly what is ticked. */
  const groupOptions = [
    ...userGroups.filter((g) => g.status === 'active').map((g) => ({ id: g.id, name: g.name })),
    ...p.user_groups.filter((g) => g.status !== 'active').map((g) => ({ id: g.id, name: `${g.name} (archived)` })),
  ]

  return (
    <>
      <DrawerHeader
        id="staff-drawer-title"
        eyebrow="User"
        title={fullName(p)}
        indicator={p.signed_in ? <SignedIn /> : null}
        pills={
          <>
            <Pill tone="brand">{p.profile?.name ?? 'No profile'}</Pill>
            <Pill on={active}>{active ? 'Active' : 'Inactive'}</Pill>
            {/* Their territories, in the drawer only. The row's right-hand
                column is the one that always beat the truncating name. */}
            {p.user_groups.map((g) => (
              <Pill key={g.id} tone="neutral">
                {g.name}
              </Pill>
            ))}
          </>
        }
        onClose={onClose}
      />

      <DrawerBody>
        {/* The face first, since 20 Sep 2026: it is how a person is recognised
            in a list, and the box an administrator most often opens the drawer
            for. The two forms follow. */}
        <PhotoBox person={p} />

        <FieldBox
          title="Details"
          action={saveStaffDetails}
          identity={identity}
          view={
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Title" value={p.title} />
              <Field label="First name" value={p.first_name} />
              <Field label="Last name" value={p.last_name} />
              <Field label="Date of birth" value={formatBirthDate(p.date_of_birth)} />
              <Field label="Email" value={p.email} />
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              {/* Optional, so not `required`; and a blank submits as a present
                  key, which the action turns into null — that is how a title or
                  a birthday is removed. */}
              <EditField label="Title">
                <input name="title" defaultValue={p.title ?? ''} maxLength={30} placeholder="Mr, Ms, Dr" className={FIELD_INPUT} />
              </EditField>
              <EditField label="First name">
                <input name="first_name" defaultValue={p.first_name} required className={FIELD_INPUT} />
              </EditField>
              <EditField label="Last name">
                <input name="last_name" defaultValue={p.last_name} required className={FIELD_INPUT} />
              </EditField>
              <EditField label="Date of birth">
                <input name="date_of_birth" type="date" defaultValue={p.date_of_birth ?? ''} className={FIELD_INPUT} />
              </EditField>
              <EditField label="Email">
                <input name="email" type="email" defaultValue={p.email} required className={FIELD_INPUT} />
              </EditField>
              <p data-slot="email-note" className="text-xs leading-relaxed text-neutral-500">
                This is the address the CRM contacts and notifies this person at. It is not their sign-in
                email — changing it here does not change how they sign in.
              </p>
            </div>
          }
        />

        <FieldBox
          title="Access"
          action={saveStaffDetails}
          identity={identity}
          view={
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Access profile" value={p.profile?.name ?? null} />
              <Field label="Status" value={active ? 'Active' : 'Inactive'} />
              <Field label="Verify identity" value={p.verify_identity ? 'Yes' : 'No'} />
              <Field label="Limit to user groups" value={p.limited_to_user_groups ? 'Yes' : 'No'} />
              <Field
                label="User groups"
                span
                value={p.user_groups.length ? p.user_groups.map((g) => g.name).join(', ') : null}
              />
              {/* An instant, so it renders in the reader's own timezone — unlike
                  the date of birth above, which is a calendar date and must not
                  go near a Date. `muted` carries the never case as a word. */}
              <Field
                label="Last seen"
                value={p.last_seen_at ? formatNoteDateTime(p.last_seen_at) : 'Never signed in'}
                muted={!p.last_seen_at}
              />
              {current?.description ? (
                <div className="col-span-2 text-xs leading-relaxed text-neutral-500">{current.description}</div>
              ) : null}
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              <EditField label="Access profile">
                <select name="profile_id" defaultValue={p.profile?.id ?? ''} required className={FIELD_INPUT}>
                  {!p.profile ? <option value="">Choose a profile</option> : null}
                  {profiles.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.description ? ` — ${x.description}` : ''}
                    </option>
                  ))}
                </select>
              </EditField>
              {self ? (
                /* Not on the form at all: a control that is absent is a key
                   absent from the patch. The database refuses the attempt
                   regardless; this is the sentence in front of that. */
                <ReadonlyField label="Status" value="Active — you cannot deactivate your own account" />
              ) : (
                <EditField label="Status">
                  <select name="status" defaultValue={p.status} className={FIELD_INPUT}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </EditField>
              )}
              <p data-slot="status-note" className="text-xs leading-relaxed text-neutral-500">
                Inactive removes access immediately, everywhere — the web app and any connected Claude
                session — and can be reversed. The last active administrator cannot be removed or
                demoted.
              </p>
              {/* Per person since 20 Sep 2026, not per profile. A checkbox that is
                  off submits nothing, which under key-presence would mean "leave it
                  alone" and make opting OUT impossible — so a hidden `false` travels
                  ahead of the checkbox's `true`, and the action reads whether `true`
                  arrived. See saveStaffDetails. */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Verify identity</span>
                <label className="flex items-start gap-2 text-sm text-neutral-900">
                  <input type="hidden" name="verify_identity" value="false" />
                  <input
                    type="checkbox"
                    name="verify_identity"
                    value="true"
                    defaultChecked={p.verify_identity}
                    className="mt-0.5 accent-brand"
                  />
                  <span>May send a client an identity-verification code and record the outcome</span>
                </label>
                <p data-slot="verify-note" className="text-xs leading-relaxed text-neutral-500">
                  Applies to this person only, whatever their profile. Sending a code also requires
                  their second factor, and only reaches clients they can already see.
                </p>
              </div>
              {/* The territory toggle, 20 Sep 2026, in the same shape. Membership
                  grants; this restricts — the rule is written under the box. */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Limit to user groups</span>
                <label className="flex items-start gap-2 text-sm text-neutral-900">
                  <input type="hidden" name="limited_to_user_groups" value="false" />
                  <input
                    type="checkbox"
                    name="limited_to_user_groups"
                    value="true"
                    defaultChecked={p.limited_to_user_groups}
                    className="mt-0.5 accent-brand"
                  />
                  <span>Sees only households in their user groups</span>
                </label>
                <p data-slot="limit-note" className="text-xs leading-relaxed text-neutral-500">
                  Applies to this person only, whatever their profile. Households with no user group stay
                  visible. Membership grants; this restricts.
                </p>
              </div>
              <CheckboxSet
                legend="User groups"
                field="user_group_ids"
                sentinel="user_groups_present"
                options={groupOptions}
                chosen={p.user_groups.map((g) => g.id)}
                emptyText="No active user groups yet — create one on the User groups tab."
              />
            </div>
          }
        />

      </DrawerBody>
    </>
  )
}

/**
 * Two buttons and a picture, not a form. Upload happens in the browser with
 * the administrator's own session, under the staff member's own prefix; the
 * bucket refuses a wrong type or an oversized body before any policy runs.
 */
function PhotoBox({ person: p }: { person: StaffRow }) {
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  function upload(file: File) {
    setError(null)
    if (!isStaffAvatarType(file.type)) {
      setError('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > STAFF_AVATAR_SIZE_LIMIT) {
      setError('That image is larger than 2 MB.')
      return
    }
    const path = staffAvatarPath(p.id, file.type)
    start(async () => {
      const supabase = createSupabaseBrowserClient()
      const { error: uploadError } = await supabase.storage
        .from(STAFF_AVATAR_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) {
        setError(uploadError.message)
        return
      }
      const result = await setStaffAvatar(p.id, path)
      if (result && 'error' in result) {
        /* The row was not updated, so the bytes are an orphan. Best effort. */
        await supabase.storage.from(STAFF_AVATAR_BUCKET).remove([path])
        setError(result.error)
      }
    })
  }

  function remove() {
    setError(null)
    start(async () => {
      const result = await setStaffAvatar(p.id, null)
      if (result && 'error' in result) setError(result.error)
    })
  }

  return (
    <FieldBox
      title="Photo"
      view={
        <div className="flex items-center gap-4">
          <Avatar staffId={p.id} firstName={p.first_name} lastName={p.last_name} avatarPath={p.avatar_path} size="lg" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30">
                {busy ? 'Saving…' : p.avatar_path ? 'Replace photo' : 'Upload photo'}
                <input
                  ref={input}
                  type="file"
                  accept={STAFF_AVATAR_MIME_TYPES.join(',')}
                  disabled={busy}
                  className="sr-only"
                  aria-label={p.avatar_path ? 'Replace photo' : 'Upload photo'}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) upload(file)
                    e.target.value = ''
                  }}
                />
              </label>
              {p.avatar_path ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 outline-none transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500/30"
                >
                  Remove photo
                </button>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">
              PNG, JPEG or WebP, up to 2 MB. Shown beside their name across the CRM.
            </p>
            {error ? (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      }
    />
  )
}

/**
 * People who have asked to join, since 19 September.
 *
 * Each request is a row with the two decisions beside it. Approve needs a
 * profile chosen first — no default, because "which access" is the whole
 * decision and a preselected Adviser would be made by whoever pressed fastest.
 * Decline is behind one confirm, not a typed word: it is reversible in the
 * sense that matters (the row stays, an administrator can reactivate it from
 * the list below), so the account-delete ceremony would be theatre here.
 */
function AwaitingApproval({ requests, profiles }: { requests: StaffRow[]; profiles: AccessProfileChoice[] }) {
  return (
    <section data-slot="awaiting-approval" aria-labelledby="awaiting-heading" className="mb-6">
      <h3 id="awaiting-heading" className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Awaiting approval
      </h3>
      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {requests.map((r) => (
            <RequestRow key={r.id} request={r} profiles={profiles} />
          ))}
        </ul>
      </div>
    </section>
  )
}

function RequestRow({ request: r, profiles }: { request: StaffRow; profiles: AccessProfileChoice[] }) {
  const [profileId, setProfileId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  function approve() {
    setError(null)
    start(async () => {
      const result = await approveStaffRegistration(r.id, profileId)
      if (result && 'error' in result) setError(result.error)
    })
  }
  function decline() {
    setError(null)
    start(async () => {
      const result = await declineStaffRegistration(r.id)
      if (result && 'error' in result) setError(result.error)
      setConfirming(false)
    })
  }

  return (
    <li data-slot="access-request" className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar staffId={r.id} firstName={r.first_name} lastName={r.last_name} avatarPath={null} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-neutral-900">{fullName(r)}</div>
          <div className="truncate text-xs text-neutral-500">
            {r.email} · asked {formatNoteDateTime(r.created_at)}
          </div>
          {error ? (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      {confirming ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-700">Decline {fullName(r)}?</span>
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            {busy ? 'Declining…' : 'Yes, decline'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Keep
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            aria-label={`Access profile for ${fullName(r)}`}
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
          >
            <option value="">Choose a profile</option>
            {profiles.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={approve}
            disabled={busy || profileId === ''}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {busy ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 outline-none transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-500/30"
          >
            Decline
          </button>
        </div>
      )}
    </li>
  )
}
