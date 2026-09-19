'use client'

import { useRef, useState, useTransition } from 'react'
import { approveStaffRegistration, declineStaffRegistration, saveStaffDetails, setStaffAvatar } from '@/app/(shell)/admin/actions'
import type { AccessProfileChoice, StaffRow } from '@/lib/admin'
import {
  isStaffAvatarType,
  STAFF_AVATAR_BUCKET,
  STAFF_AVATAR_MIME_TYPES,
  STAFF_AVATAR_SIZE_LIMIT,
  staffAvatarPath,
} from '@/lib/avatar'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Avatar } from './avatar'
import { DataRow } from './data-section'
import { Drawer, DrawerBody, DrawerHeader } from './drawer'
import { EditField, Field, FIELD_INPUT, FieldBox, ReadonlyField } from './field-box'
import { Pill, SHEET } from './ui'
import { fullName } from '@/lib/staff-name'
import { formatNoteDateTime } from '@/lib/note-date'

/**
 * The staff, and the one drawer that edits any of them.
 *
 * The account list's shape: rows as data, one `Drawer`, `selectedId` naming
 * the open record so a rename reaches the open heading after revalidation.
 * Three `FieldBox`es carry the edits — Details, Access, Photo — each a form of
 * its own, because each is a different fact about the person.
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

export function StaffList({
  staff,
  profiles,
  viewer,
}: {
  staff: StaffRow[]
  profiles: AccessProfileChoice[]
  viewer: Viewer
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /* The queue and the list are the same rows in two states. A pending person
     is not yet on the staff, so they are not in the list they would be edited
     from; they are in the queue, where the only two things to do are the two
     things that can be done. */
  const waiting = staff.filter((s) => s.status === 'pending')
  const members = staff.filter((s) => s.status !== 'pending')
  const person = members.find((s) => s.id === selectedId) ?? null

  return (
    <>
      {waiting.length > 0 ? <AwaitingApproval requests={waiting} profiles={profiles} /> : null}

      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {members.map((s) => (
            <DataRow
              key={s.id}
              leading={<Avatar staffId={s.id} firstName={s.first_name} lastName={s.last_name} avatarPath={s.avatar_path} />}
              primary={fullName(s)}
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
          <StaffPanel person={person} profiles={profiles} viewer={viewer} onClose={() => setSelectedId(null)} />
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
  viewer,
  onClose,
}: {
  person: StaffRow
  profiles: AccessProfileChoice[]
  viewer: Viewer
  onClose: () => void
}) {
  const self = p.id === viewer.id
  const active = p.status === 'active'
  const identity = <input type="hidden" name="staff_id" value={p.id} />
  const current = profiles.find((x) => x.id === p.profile?.id)

  return (
    <>
      <DrawerHeader
        id="staff-drawer-title"
        eyebrow="Staff"
        title={fullName(p)}
        pills={
          <>
            <Pill tone="brand">{p.profile?.name ?? 'No profile'}</Pill>
            <Pill on={active}>{active ? 'Active' : 'Inactive'}</Pill>
          </>
        }
        onClose={onClose}
      />

      <DrawerBody>
        <FieldBox
          title="Details"
          action={saveStaffDetails}
          identity={identity}
          view={
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="First name" value={p.first_name} />
              <Field label="Last name" value={p.last_name} />
              <Field label="Email" value={p.email} />
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              <EditField label="First name">
                <input name="first_name" defaultValue={p.first_name} required className={FIELD_INPUT} />
              </EditField>
              <EditField label="Last name">
                <input name="last_name" defaultValue={p.last_name} required className={FIELD_INPUT} />
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
            </div>
          }
        />

        <PhotoBox person={p} />
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
