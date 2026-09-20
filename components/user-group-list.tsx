'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  createUserGroup,
  saveUserGroupDetails,
  saveUserGroupMembers,
  type UserGroupState,
} from '@/app/(shell)/admin/actions'
import type { UserGroupRow } from '@/lib/admin'
import { USER_GROUP_STATUS_LABEL } from '@/lib/user-groups'
import { CheckboxSet } from './checkbox-set'
import { DataRow, DataSection } from './data-section'
import { Drawer, DrawerBody, DrawerHeader } from './drawer'
import { EditField, Field, FIELD_INPUT, FieldBox } from './field-box'
import { PlusIcon } from './icons'
import { Pill, QUIET_ACTION } from './ui'

/**
 * User groups — territories — and the one drawer that edits any of them.
 *
 * The staff list's shape: rows as data, one `Drawer`, `selectedId` naming the
 * open record so a rename reaches the open heading after revalidation. Two
 * `FieldBox`es carry the edits — Details (name, status) and Members — each a
 * form of its own.
 *
 * ## Words the screen uses, and why
 *
 * "User groups", never "groups": a group is already a client household on
 * every other screen in this app. "Archived", never "deleted": there is no
 * delete — the database has no policy for one — because an archived group
 * keeps its members and its households until somebody changes them, and can
 * be brought back. The rule the whole feature rests on is written once, in the
 * empty state: membership grants, the toggle on a person restricts.
 */
export function UserGroupList({
  groups,
  staff,
}: {
  groups: UserGroupRow[]
  /** Active staff, for the members picker. Derived by the page from rows it already has. */
  staff: { id: string; name: string }[]
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const group = groups.find((g) => g.id === selectedId) ?? null
  const count = groups.length

  return (
    <>
      <DataSection
        title="User groups"
        countLabel={count ? `${count} user group${count === 1 ? '' : 's'}` : undefined}
        addLabel="New user group"
        action={<NewUserGroupForm triggerVariant="quiet" />}
        emptyAction={<NewUserGroupForm />}
        empty={{
          title: 'No user groups yet',
          description:
            'Territories that decide which households a limited user can see. Create one, then add its members.',
        }}
      >
        {groups.length
          ? groups.map((g) => (
              <DataRow
                key={g.id}
                primary={g.name}
                secondary={countsLine(g)}
                meta={<Pill on={g.status === 'active'}>{USER_GROUP_STATUS_LABEL[g.status] ?? g.status}</Pill>}
                trigger={{ label: `Open ${g.name}`, onClick: () => setSelectedId(g.id) }}
              />
            ))
          : undefined}
      </DataSection>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} labelledBy="user-group-drawer-title">
        {group ? (
          <UserGroupPanel group={group} staff={staff} onClose={() => setSelectedId(null)} />
        ) : (
          <>
            <DrawerHeader id="user-group-drawer-title" title="User group" onClose={() => setSelectedId(null)} />
            <DrawerBody>
              <p className="text-sm leading-relaxed text-neutral-600">This user group is no longer on the list.</p>
            </DrawerBody>
          </>
        )}
      </Drawer>
    </>
  )
}

/** "2 members · 5 households", singular-aware. */
function countsLine(g: UserGroupRow): string {
  const m = g.members.length
  const h = g.household_count
  return `${m} member${m === 1 ? '' : 's'} · ${h} household${h === 1 ? '' : 's'}`
}

function UserGroupPanel({
  group: g,
  staff,
  onClose,
}: {
  group: UserGroupRow
  staff: { id: string; name: string }[]
  onClose: () => void
}) {
  const active = g.status === 'active'
  const identity = <input type="hidden" name="user_group_id" value={g.id} />

  return (
    <>
      <DrawerHeader
        id="user-group-drawer-title"
        eyebrow="User group"
        title={g.name}
        pills={
          <>
            <Pill on={active}>{USER_GROUP_STATUS_LABEL[g.status] ?? g.status}</Pill>
            <Pill tone="neutral">
              {g.household_count} household{g.household_count === 1 ? '' : 's'}
            </Pill>
          </>
        }
        onClose={onClose}
      />

      <DrawerBody>
        <FieldBox
          title="Details"
          action={saveUserGroupDetails}
          identity={identity}
          view={
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Name" value={g.name} />
              <Field label="Status" value={USER_GROUP_STATUS_LABEL[g.status] ?? g.status} />
              <Field
                label="Households"
                value={g.household_count ? String(g.household_count) : 'None yet'}
                muted={g.household_count === 0}
              />
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              <EditField label="Name">
                <input name="name" defaultValue={g.name} required maxLength={60} className={FIELD_INPUT} />
              </EditField>
              <EditField label="Status">
                <select name="status" defaultValue={g.status} className={FIELD_INPUT}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </EditField>
              <p data-slot="archive-note" className="text-xs leading-relaxed text-neutral-500">
                An archived group can&rsquo;t be chosen for a household or a user. Members and households
                that already have it keep it until changed; reactivating puts it back in the lists.
              </p>
            </div>
          }
        />

        <FieldBox
          title="Members"
          action={saveUserGroupMembers}
          identity={identity}
          view={
            g.members.length ? (
              <ul className="flex flex-col gap-1 text-sm text-neutral-900">
                {g.members.map((m) => (
                  <li key={m.id}>{m.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-400">No members yet</p>
            )
          }
          edit={
            <CheckboxSet
              legend="Members"
              field="staff_ids"
              sentinel="members_present"
              options={staff}
              chosen={g.members.map((m) => m.id)}
              emptyText="Nobody active on the staff to add."
            />
          }
        />
      </DrawerBody>
    </>
  )
}

/**
 * The one-field dialog that creates a user group. A native `<dialog>` for the
 * reasons `AddBalanceItemModal` gives: focus held, Escape handled, background
 * inert, top layer — all free, all easy to get subtly wrong by hand.
 */
function NewUserGroupForm({ triggerVariant = 'primary' }: { triggerVariant?: 'primary' | 'quiet' }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<UserGroupState, FormData>(createUserGroup, null)

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  function hide() {
    setOpen(false)
    dialogRef.current?.close()
  }

  useEffect(() => {
    if (state && 'ok' in state && open) {
      formRef.current?.reset()
      hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => setOpen(false)
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  const trigger =
    triggerVariant === 'primary' ? (
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <PlusIcon className="h-4 w-4" />
        New user group
      </button>
    ) : (
      <button type="button" onClick={show} className={QUIET_ACTION}>
        <PlusIcon className="h-3.5 w-3.5" />
        New user group
      </button>
    )

  return (
    <>
      {trigger}
      <dialog
        ref={dialogRef}
        aria-labelledby="new-user-group-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 id="new-user-group-title" className="text-base font-semibold tracking-tight text-neutral-900">
              New user group
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              A territory. Add its members from the list, then put households in it from their own pages.
            </p>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-neutral-600">Name</span>
              <input name="name" required maxLength={60} placeholder="e.g. Sydney" className={FIELD_INPUT} />
            </label>
            {state && 'error' in state ? (
              <p role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
            <button
              type="button"
              onClick={hide}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {pending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
