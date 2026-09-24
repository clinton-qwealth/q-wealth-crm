'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { deployWorkflowTemplate } from '@/app/(shell)/groups/actions'
import { Pill } from '@/components/ui'
import { WorkflowIcon } from '@/components/icons'
import { formatCalendarDate } from '@/lib/note-date'
import { previewSchedule, todayInSydney, type DeployableTemplate } from '@/lib/templates'

type State = { ok: true } | { error: string } | null

/**
 * What replaces the dashed "Workflow template name" placeholder that has sat on
 * this panel since 6 September.
 *
 * Three states, and the third matters: with no template PUBLISHED yet the
 * placeholder stays but says so, because the house rule is that a placeholder
 * names what it stands in for — and "Workflow template name" stops being true
 * the day templates exist.
 */
export function WorkflowTemplateChip({
  templates,
  deployed,
  workflowId,
  staff,
}: {
  templates: DeployableTemplate[]
  /** The name of a template already deployed here, if any. */
  deployed: string | null
  workflowId: string
  staff: { id: string; name: string }[]
}) {
  if (deployed) {
    return (
      /* Brand, because ui.tsx reserves brand for "something that is ours — an
         identity or a label, not a state", and a template's name is exactly
         that. A status tone would read as though the plan were a condition. */
      <Pill tone="brand" title="Deployed from a workflow template">
        {deployed}
      </Pill>
    )
  }

  if (templates.length === 0) {
    return (
      <span
        data-slot="placeholder"
        className="inline-flex items-center rounded-md border border-dashed border-neutral-300 px-2 py-1 text-sm text-neutral-400"
      >
        No templates published yet
      </span>
    )
  }

  return <DeployTemplateDialog templates={templates} workflowId={workflowId} staff={staff} />
}

export function DeployTemplateDialog({
  templates,
  workflowId,
  staff,
}: {
  templates: DeployableTemplate[]
  workflowId: string
  staff: { id: string; name: string }[]
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [startDate, setStartDate] = useState(todayInSydney())
  const [roleStaff, setRoleStaff] = useState<Record<string, string>>({})
  const [state, formAction, pending] = useActionState<State, FormData>(deployWorkflowTemplate, null)

  const template = templates.find((t) => t.id === templateId) ?? null
  const rows = useMemo(
    () => (template ? previewSchedule(template, startDate) : []),
    [template, startDate],
  )
  /* Deploy stays off until every role has somebody. No "Unassigned" option and
     no prefill: dropping the workflow's owner into every role is the obvious
     convenience and it quietly lands fifteen tasks on one person. */
  const unmapped = template ? template.roles.filter((r) => !roleStaff[r.id]) : []

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  function hide() {
    setOpen(false)
    setRoleStaff({})
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

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      >
        <WorkflowIcon className="h-4 w-4" />
        Use a template
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="deploy-template-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <h2 id="deploy-template-title" className="text-base font-semibold text-neutral-900">Use a workflow template</h2>
          <input type="hidden" name="workflow_id" value={workflowId} />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Template</span>
            <select
              name="template_id"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value)
                setRoleStaff({})
              }}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {template ? (
              <span className="text-xs text-neutral-500">
                {template.tasks.length} {template.tasks.length === 1 ? 'task' : 'tasks'}
                {template.description ? ` · ${template.description}` : ''}
              </span>
            ) : null}
          </label>

          {template && template.roles.length > 0 ? (
            <fieldset data-slot="deploy-roles" className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-neutral-700">Who fills each role</legend>
              {template.roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <span className="w-32 shrink-0 truncate text-neutral-600">{role.name}</span>
                  <select
                    name={`role:${role.id}`}
                    value={roleStaff[role.id] ?? ''}
                    onChange={(e) => setRoleStaff((m) => ({ ...m, [role.id]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  >
                    <option value="" disabled>
                      Choose somebody
                    </option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">The plan starts on</span>
            <input
              name="start_date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <span className="text-xs text-neutral-500">
              Tasks with nothing to wait for are due a set number of days after this. Everything else
              gets its due date when the task before it is done.
            </span>
          </label>

          {rows.length > 0 ? <DeployPreview rows={rows} /> : null}

          {state && 'error' in state ? (
            <p role="alert" className="text-xs text-red-600">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            {unmapped.length > 0 ? (
              <span className="mr-auto text-xs text-neutral-500">
                {unmapped.length} {unmapped.length === 1 ? 'role needs' : 'roles need'} somebody
              </span>
            ) : null}
            <button
              type="button"
              onClick={hide}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !template || unmapped.length > 0}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Adding the tasks…' : `Add ${template?.tasks.length ?? 0} tasks`}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

/**
 * What deploying will actually produce.
 *
 * THE BLANKS ARE THE POINT. A task that waits for something has no due date
 * until that something is done, so those rows say what they are waiting for
 * instead of a date. Printing a confident waterfall of dates from the start
 * date is what this looks like it should do, it is not what the database will
 * write, and the deployer would open the workflow, find a column of blanks and
 * report it as a bug.
 */
export function DeployPreview({ rows }: { rows: ReturnType<typeof previewSchedule> }) {
  return (
    <div data-slot="deploy-preview" className="max-h-56 overflow-y-auto rounded-md border border-neutral-200">
      <ul className="divide-y divide-neutral-100 text-xs">
        {rows.map((row, i) => (
          <li key={i} className="flex items-baseline gap-2 px-2.5 py-1.5">
            <span className="w-5 shrink-0 text-right tabular-nums text-neutral-400">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0 flex-1 truncate text-neutral-800">{row.subject}</span>
            <span className="shrink-0 text-neutral-500">{row.roleName}</span>
            <span className="w-40 shrink-0 text-right text-neutral-500">
              {row.dueOn ? (
                `due ${formatCalendarDate(row.dueOn)}`
              ) : (
                <span className="text-neutral-400">
                  {row.offsetDays === 0
                    ? `after “${row.after}”`
                    : `${row.offsetDays}d after “${row.after}”`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
