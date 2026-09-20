'use client'

import { useState, useTransition } from 'react'
import { setGroupUserGroup } from '@/app/(shell)/groups/actions'
import type { UserGroupChoice } from '@/lib/user-groups'
import { FIELD_INPUT } from './field-box'
import { PencilIcon } from './icons'
import { Pill } from './ui'

/**
 * The household's user group (territory), on the Group profile card.
 *
 * A pill, like the primary adviser above it: the territory is a reference to
 * another record, not a value of this one. The pencil appears only for someone
 * with `manage_groups`, which is what `scoped_update_client_groups` requires —
 * the database remains the rule, this is the courtesy in front of it.
 *
 * Editing is one `<select>` and it saves on change, the member panel's shape.
 * "None" is first and means "take it out". A CURRENT group that has since been
 * archived is kept as an option even though it cannot be newly chosen, so that
 * merely opening the editor never changes the value.
 *
 * The note under the control is load-bearing: a limited member of territory A
 * who moves a household to B loses sight of it, by design.
 */
export function UserGroupField({
  groupId,
  current,
  options,
  canEdit,
}: {
  groupId: string
  current: UserGroupChoice | null
  /** Active user groups, by name. */
  options: UserGroupChoice[]
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  const choices = current && !options.some((o) => o.id === current.id) ? [...options, current] : options

  function choose(value: string) {
    setError(null)
    start(async () => {
      const result = await setGroupUserGroup(groupId, value || null)
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {current ? <Pill tone="neutral">{current.name}</Pill> : <span className="text-sm text-neutral-400">—</span>}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit user group"
            title="Edit user group"
            className="rounded-md p-1 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="User group"
        defaultValue={current?.id ?? ''}
        disabled={busy}
        onChange={(e) => choose(e.target.value)}
        className={FIELD_INPUT}
      >
        <option value="">None</option>
        {choices.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.status !== 'active' ? ' (archived)' : ''}
          </option>
        ))}
      </select>
      <p data-slot="user-group-note" className="text-xs leading-relaxed text-neutral-500">
        Everyone in the group sees this household. Moving it out of your own group may hide it from you.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={busy}
        className="self-start rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        Cancel
      </button>
    </div>
  )
}
