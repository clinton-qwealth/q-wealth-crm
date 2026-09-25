'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  addUserGroupMember,
  createUserGroup,
  removeUserGroupMember,
  saveUserGroupDetails,
  type UserGroupState,
} from '@/app/(shell)/admin/actions'
import type { UserGroupRow } from '@/lib/admin'
import { USER_GROUP_STATUS_LABEL } from '@/lib/user-groups'
import { AddAction } from './add-action'
import { DataRow, DataSection } from './data-section'
import { Drawer, DrawerBody, DrawerHeader } from './drawer'
import { EditField, Field, FIELD_INPUT, FieldBox } from './field-box'
import { Pill } from './ui'

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

/**
 * Who is in this user group, and the two controls that change it.
 *
 * **Search to add, list to remove — and every action is its own write.** The
 * first version of this box was a checkbox per staff member with one Save, which
 * Clinton rightly questioned on 20 Sep 2026: "if i have 100-200 users, what
 * would ideally be the best way?" Three things break at that size, and only one
 * of them is the scrolling:
 *
 *  - **A Save replaces the whole membership**, so two administrators editing the
 *    same group minutes apart silently revert each other.
 *  - **The trail loses the intent.** "Added Jo Smith to Northern" is the event
 *    worth recording; a set-replace leaves only whichever rows differed.
 *  - **You cannot see who is in** without reading two hundred boxes.
 *
 * So: the members are a short list with a remove beside each, and adding is a
 * search. The search is entirely in the browser over the staff the page has
 * already loaded for the Users tab — two hundred names is nothing to filter, and
 * it costs no round trip and no wave.
 *
 * Nothing is listed until something is typed. A picker that dumps every
 * colleague on opening is the control this one replaced.
 */
function MemberManager({ group: g, staff }: { group: UserGroupRow; staff: { id: string; name: string }[] }) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  const memberIds = useMemo(() => new Set(g.members.map((m) => m.id)), [g.members])
  const needle = query.trim().toLowerCase()
  /* Capped, because a two-letter query matches half the firm and a list that
     long is the problem this box exists to avoid. */
  const matches = useMemo(
    () => (needle ? staff.filter((s) => !memberIds.has(s.id) && s.name.toLowerCase().includes(needle)) : []),
    [needle, staff, memberIds],
  )
  const shown = matches.slice(0, 8)

  function run(action: () => Promise<{ error: string } | { ok: true } | null>) {
    setError(null)
    start(async () => {
      const result = await action()
      if (result && 'error' in result) setError(result.error)
      else setQuery('')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          aria-label={`Search staff to add to ${g.name}`}
          placeholder="Search staff to add…"
          className={FIELD_INPUT}
        />
        {needle ? (
          shown.length ? (
            <ul data-slot="member-matches" className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              {shown.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm text-neutral-800">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <button
                    type="button"
                    onClick={() => run(() => addUserGroupMember(g.id, s.id))}
                    disabled={busy}
                    aria-label={`Add ${s.name}`}
                    className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    Add
                  </button>
                </li>
              ))}
              {matches.length > shown.length ? (
                <li className="px-1.5 pt-1 text-xs text-neutral-500">
                  {matches.length - shown.length} more — keep typing to narrow it.
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-xs text-neutral-500">
              Nobody left to add by that name. Everybody matching is already a member.
            </p>
          )
        ) : null}
      </div>

      {g.members.length ? (
        <ul data-slot="member-list" className="flex flex-col gap-1">
          {g.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm text-neutral-900">
              <span className="min-w-0 truncate">{m.name}</span>
              <button
                type="button"
                onClick={() => run(() => removeUserGroupMember(g.id, m.id))}
                disabled={busy}
                aria-label={`Remove ${m.name}`}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500/30"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-400">No members yet</p>
      )}

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
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

        {/* No pencil, no Save — like the Photo box, and for the same reason:
            this is not a form, it is a set of immediate actions. See
            `MemberManager` for why that matters at 200 users. */}
        <FieldBox title="Members" view={<MemberManager group={g} staff={staff} />} />
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

  const trigger = <AddAction label="New user group" variant={triggerVariant} onClick={show} />

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
