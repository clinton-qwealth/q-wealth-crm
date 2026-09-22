'use client'

import { useState, useTransition } from 'react'
import { setGroupUserGroups } from '@/app/(shell)/groups/actions'
import type { UserGroupChoice } from '@/lib/user-groups'
import { PencilIcon } from './icons'
import { Pill } from './ui'

/**
 * The user groups (territories) a household belongs to — its own section under
 * the Group profile card.
 *
 * **It was a field in the profile's two-column list until 22 Sep 2026**, and it
 * outgrew that twice over. A household may now be in any number of territories,
 * so the value is a list rather than a word; and a column of the profile grid
 * is about 123px wide, which is not where a list of pills belongs. Clinton
 * asked for it to move out and to take several.
 *
 * Read state is the pills, or an em dash. The pencil appears only for someone
 * with `manage_groups`, which is what `scoped_update_client_groups` requires —
 * the database remains the rule, this is the courtesy in front of it.
 *
 * **Checkboxes and one Save, not a control per territory.** A household sits in
 * a handful of territories out of a dozen, so the whole list fits on screen and
 * one press is one call — the same small-cardinality reasoning that keeps the
 * person's side a checkbox set, and the opposite of a territory's own Members
 * box, where the many-membered side needs incremental writes.
 *
 * A CURRENT territory that has since been archived is kept in the list, ticked
 * and labelled, so that merely opening the editor and saving cannot silently
 * drop it. Only a NEW link into an archived group is refused, by the database.
 *
 * The note is load-bearing: a limited member of territory A who takes a
 * household out of A loses sight of it. That is the feature working.
 */
export function UserGroupsBox({
  groupId,
  current,
  options,
  canEdit,
}: {
  groupId: string
  /** The territories this household is in, by name. */
  current: UserGroupChoice[]
  /** Active territories, by name — what may be newly chosen. */
  options: UserGroupChoice[]
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [chosen, setChosen] = useState<string[]>(() => current.map((g) => g.id))
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  /* Everything active, plus any archived one this household already holds. An
     archived group is not offered to a household that is not in it. */
  const choices = [
    ...options,
    ...current.filter((c) => !options.some((o) => o.id === c.id)),
  ]

  function open() {
    setChosen(current.map((g) => g.id))
    setError(null)
    setEditing(true)
  }

  function save() {
    setError(null)
    start(async () => {
      const result = await setGroupUserGroups(groupId, chosen)
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  return (
    <div data-slot="user-groups-box">
      <div className="mb-3 flex items-center justify-between pl-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">User groups</h2>
        {!editing && canEdit ? (
          <button
            type="button"
            onClick={open}
            aria-label="Edit user groups"
            title="Edit user groups"
            className="rounded-md p-1 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {!editing ? (
        <div className="pl-3">
          {current.length === 0 ? (
            <span className="text-sm text-neutral-400">—</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              {current.map((g) => (
                <Pill key={g.id} tone="neutral">
                  {g.name}
                  {g.status !== 'active' ? ' (archived)' : ''}
                </Pill>
              ))}
            </span>
          )}
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            {current.length === 0
              ? 'In no user group, so every colleague whose profile allows it can see this household.'
              : 'Everyone in these user groups sees this household.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 pl-3">
          {choices.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No user groups yet — an administrator creates them on the Administration page.
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              {choices.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-white"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(o.id)}
                    onChange={(e) =>
                      setChosen((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((id) => id !== o.id)))
                    }
                    className="h-3.5 w-3.5 accent-[var(--brand-500)]"
                  />
                  {o.name}
                  {o.status !== 'active' ? ' (archived)' : ''}
                </label>
              ))}
            </div>
          )}
          <p data-slot="user-group-note" className="text-xs leading-relaxed text-neutral-500">
            Everyone in a user group sees this household. Taking it out of your own may hide it from you.
          </p>
          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
