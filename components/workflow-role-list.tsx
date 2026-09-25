'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  createWorkflowRole,
  renameWorkflowRole,
  setWorkflowRoleStatus,
} from '@/app/(shell)/admin/actions'
import { AddAction } from '@/components/add-action'
import { DataRow, DataSection } from '@/components/data-section'
import { FIELD_INPUT } from '@/components/field-box'
import { Pill } from '@/components/ui'
import type { WorkflowRole } from '@/lib/templates'

/**
 * The firm's workflow roles — one list, curated here, picked from everywhere.
 *
 * ## Why this list exists
 *
 * Until 24 September a role was typed into the template being written, so every
 * template invented its own. Three templates wanting the same person produced
 * three rows called "Adviser", "adviser" and "Advisor", nothing could say they
 * meant the same thing, and correcting a name meant finding every template that
 * had it. The names moved to `workflow_roles`; a template now says WHICH of
 * these it uses, and a rename here reaches all of them at once.
 *
 * ## Archived, not deleted
 *
 * A role is on published templates and on workflows that are still running, so
 * removing it would take live work with it. Archiving takes it out of the
 * pickers and leaves every existing reference exactly where it is —
 * `ensure_workflow_template_role` refuses to hand an archived role to a NEW
 * task but never disturbs an old one. The count on each row is what makes that
 * decision an informed one, so it is shown before the button is pressed.
 *
 * ## Renaming is inline, not a dialog
 *
 * One field, no confirmation, and the thing being changed stays in place in the
 * list where its template count is visible. A modal for a single text input
 * would put a lightbox over the one piece of context that matters.
 */
export function WorkflowRoleList({ roles }: { roles: WorkflowRole[] }) {
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const active = roles.filter((r) => r.status === 'active')

  function run(action: () => Promise<{ ok: true } | { error: string } | null>, after?: () => void) {
    setError(null)
    start(async () => {
      const result = await action()
      if (result && 'error' in result) setError(result.error)
      else after?.()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <DataSection
        title="Roles"
        countLabel={`${active.length} in use${
          roles.length > active.length ? `, ${roles.length - active.length} archived` : ''
        }`}
        addLabel="New role"
        action={<NewWorkflowRoleForm triggerVariant="quiet" />}
        emptyAction={<NewWorkflowRoleForm />}
        empty={{
          title: 'No roles yet',
          description:
            'A role is who does a task — Adviser, Operations, Paraplanner. Name them here once and every template picks from the same list.',
        }}
      >
        {roles.map((role) =>
          editingId === role.id ? (
            <li key={role.id} className="px-3.5 py-3">
              <RenameRow
                role={role}
                pending={pending}
                onCancel={() => setEditingId(null)}
                onSave={(name) => run(() => renameWorkflowRole(role.id, name), () => setEditingId(null))}
              />
            </li>
          ) : (
            <DataRow
              key={role.id}
              primary={role.name}
              secondary={usageLine(role)}
              indicator={role.status === 'archived' ? <Pill>Archived</Pill> : undefined}
              meta={
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setError(null)
                      setEditingId(role.id)
                    }}
                    className={ROW_ACTION}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        setWorkflowRoleStatus(role.id, role.status === 'archived' ? 'active' : 'archived'),
                      )
                    }
                    /* Named, because "Archive" alone on a row of six reads as
                       "archive the list". */
                    aria-label={`${role.status === 'archived' ? 'Restore' : 'Archive'} ${role.name}`}
                    className={ROW_ACTION}
                  >
                    {role.status === 'archived' ? 'Restore' : 'Archive'}
                  </button>
                </span>
              }
            />
          ),
        )}
      </DataSection>

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const ROW_ACTION =
  'rounded px-1.5 py-0.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent'

/** What the row says under the name. Said in templates, because that is the
 *  number that decides whether archiving it is safe. */
function usageLine(role: WorkflowRole): string {
  if (role.template_count === 0) return 'Not on any template yet'
  return `On ${role.template_count} ${role.template_count === 1 ? 'template' : 'templates'}`
}

function RenameRow({
  role,
  pending,
  onSave,
  onCancel,
}: {
  role: WorkflowRole
  pending: boolean
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(role.name)

  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          /* Enter saves and Escape abandons, because this is one field in a
             list row rather than a form — there is no Save button to reach for
             by keyboard first, and Escape here must not close anything else. */
          if (e.key === 'Enter' && name.trim()) onSave(name)
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        aria-label={`Rename ${role.name}`}
        className={FIELD_INPUT}
      />
      <button
        type="button"
        disabled={pending || !name.trim() || name.trim() === role.name}
        onClick={() => onSave(name)}
        className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className={ROW_ACTION}>
        Cancel
      </button>
    </div>
  )
}

/**
 * Naming a role.
 *
 * The same dialog shape as every other creation modal here — `qw-modal m-auto`,
 * an `aria-labelledby` pointing at its own heading, and a backdrop click that
 * closes. The `m-auto` is load-bearing: Tailwind's preflight zeroes `margin`,
 * which kills the user-agent stylesheet's `margin: auto` centring for
 * `<dialog>` and drops the modal into the top-left corner.
 */
export function NewWorkflowRoleForm({
  triggerVariant = 'primary',
}: {
  triggerVariant?: 'primary' | 'quiet'
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<
    { ok: true } | { error: string } | null,
    FormData
  >(createWorkflowRole, null)

  useEffect(() => {
    if (state && 'ok' in state) {
      formRef.current?.reset()
      /* Close the element and let its own `close` event clear `open` below.
         Setting the flag here too would be a setState synchronously inside an
         effect, which is a cascading render and which the lint rule refuses —
         and this way there is one path out of the dialog however it is shut. */
      dialogRef.current?.close()
    }
  }, [state])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => setOpen(false)
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  function hide() {
    dialogRef.current?.close()
  }

  return (
    <>
      <AddAction label="New role" variant={triggerVariant} onClick={show} />

      <dialog
        ref={dialogRef}
        aria-labelledby="new-workflow-role-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <h2 id="new-workflow-role-title" className="text-base font-semibold text-neutral-900">
            New role
          </h2>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">What they are called</span>
            <input name="name" required autoFocus placeholder="Adviser" className={FIELD_INPUT} />
            <span className="text-xs text-neutral-500">
              A job, not a person. Whoever deploys a template picks the person.
            </span>
          </label>

          {state && 'error' in state ? (
            <p role="alert" className="text-xs text-red-600">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={hide}
              className="rounded-md px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !open}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {pending ? 'Adding…' : 'Add role'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
