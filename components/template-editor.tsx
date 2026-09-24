'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  addTemplateRole,
  addTemplateTask,
  removeTemplateRole,
  removeTemplateTask,
  reorderTemplateTasks,
  saveTemplateTask,
  saveWorkflowTemplate,
  setWorkflowTemplateStatus,
} from '@/app/(shell)/admin/actions'
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@/components/drawer'
import { Field, FieldBox, FIELD_INPUT } from '@/components/field-box'
import { ArrowDownIcon, ArrowUpIcon } from '@/components/icons'
import { Card, Pill, SHEET_SURFACE } from '@/components/ui'
import { useServerState } from '@/components/use-server-state'
import {
  blockingNeighbour,
  legalPositions,
  reordered,
  taskDepths,
  TEMPLATE_STATUS_LABEL,
  templateIssues,
  type TemplateDetail,
  type TemplateTask,
  type WorkflowRole,
} from '@/lib/templates'

type Result = { ok: true } | { error: string } | null

/**
 * The template editor.
 *
 * Three columns matching /admin's own 3 / 6 / 3, so the two administration
 * screens do not rearrange themselves as you move between them — but the flanks
 * carry work here rather than being reserved space.
 */
/**
 * `firmRoles` is the FIRM's list, not this template's. Every picker below reads
 * from it, because a task now names one of the firm's roles rather than a name
 * invented for this template; `ensure_workflow_template_role` attaches whichever
 * one is picked, so choosing a role the template has not used yet just works.
 * `template.roles` remains what this template uses, which is what the deploy
 * dialog maps to people and what the Roles card reports on.
 */
export function TemplateEditor({
  template,
  firmRoles,
}: {
  template: TemplateDetail
  firmRoles: WorkflowRole[]
}) {
  /* Optimistic, via the house helper: a move has to show IMMEDIATELY. Without
     this the list only reorders when the server revalidates, so a click does
     nothing visible for a round trip — and, less obviously, the row never moves
     under the focused button, which is what makes restoring focus necessary at
     all. Re-seeded whenever the server sends a new list. */
  const [tasks, setTasks] = useServerState(template.tasks)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = tasks.find((t) => t.id === selectedId) ?? null
  const issues = templateIssues(template)

  return (
    <>
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3">
        <Card>
          <FieldBox
            title="Template"
            action={saveWorkflowTemplate}
            identity={<input type="hidden" name="template_id" value={template.id} />}
            view={
              <dl className="flex flex-col gap-3 text-sm">
                <Field label="Name" value={template.name} />
                <Field label="Description" value={template.description ?? undefined} />
              </dl>
            }
            edit={
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Name</span>
                  <input name="name" defaultValue={template.name} required className={FIELD_INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                    Description
                  </span>
                  <textarea name="description" rows={3} defaultValue={template.description ?? ''} className={FIELD_INPUT} />
                </label>
              </div>
            }
          />
          <TemplateLifecycle template={template} issues={issues.length} />
        </Card>

        <Card>
          <RoleManager template={template} firmRoles={firmRoles} />
        </Card>
      </div>

      <Card className="col-span-full lg:col-span-6" padding="roomy">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Tasks</h2>
            {/* Ordering is AUTHORING order, not execution order. Execution order
                comes out of the dependencies, and saying so here stops the two
                being read as the same thing. */}
            <p className="mt-0.5 text-xs text-neutral-500">
              In the order they are written. A task can only wait for one above it.
            </p>
          </div>
          <NewTemplateTaskForm template={template} firmRoles={firmRoles} />
        </div>

        {error ? (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <TaskList
          templateId={template.id}
          tasks={tasks}
          setTasks={setTasks}
          onOpen={setSelectedId}
          onError={setError}
        />
      </Card>

      <div className="col-span-full flex flex-col gap-4 lg:col-span-3">
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Before publishing</h2>
          {issues.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-500">
              Nothing outstanding. {template.status === 'published' ? 'This template is live.' : 'Ready to publish.'}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {issues.map((issue, i) => (
                <li key={i}>
                  {/* Every issue is a way IN. An itemised gate that cannot take
                      you to the problem is a scold. */}
                  <button
                    type="button"
                    onClick={() => issue.taskId && setSelectedId(issue.taskId)}
                    disabled={!issue.taskId}
                    className="text-left text-xs text-amber-800 underline decoration-amber-300 underline-offset-2 disabled:no-underline"
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Drawer open={selected !== null} onClose={() => setSelectedId(null)} labelledBy="template-task-title">
        {selected ? (
          <TemplateTaskPanel
            template={template}
            firmRoles={firmRoles}
            tasks={tasks}
            task={selected}
            onClose={() => setSelectedId(null)}
            onError={setError}
          />
        ) : null}
      </Drawer>
    </>
  )
}

/* -------------------------------------------------------------------------- */

function TaskList({
  templateId,
  tasks,
  setTasks,
  onOpen,
  onError,
}: {
  templateId: string
  tasks: TemplateTask[]
  setTasks: (next: TemplateTask[]) => void
  onOpen: (id: string) => void
  onError: (message: string | null) => void
}) {
  const [pending, start] = useTransition()
  const depths = taskDepths(tasks)
  /**
   * FOCUS AFTER A MOVE — and the interesting part is that nothing is needed.
   *
   * Every row is keyed by its TASK ID, so React reorders by moving the existing
   * DOM nodes rather than rebuilding them. A node that is never detached keeps
   * focus, so the button you pressed is still the button you pressed and a
   * second press moves the task again.
   *
   * This was written the other way first — a ref, an effect, and a comment
   * calling the restore "the single thing a plausible implementation omits".
   * Removing the restore changed nothing, which is how the belief was found to
   * be wrong. What it hangs on is the KEY: key these rows by index instead and
   * React updates the nodes in place, so focus stays on a button that now
   * belongs to a different task. The test pins that, not the effect.
   */
  const [announcement, setAnnouncement] = useState('')
  const buttons = useRef(new Map<string, HTMLButtonElement | null>())

  function move(task: TemplateTask, direction: 'up' | 'down') {
    const at = tasks.findIndex((t) => t.id === task.id)
    const to = direction === 'up' ? at - 1 : at + 1
    const order = reordered(tasks, task.id, to)
    const before = tasks
    const next = order.map((id, i) => ({ ...tasks.find((t) => t.id === id)!, ordinal: i }))

    onError(null)
    setAnnouncement(`“${task.subject}” moved to position ${order.indexOf(task.id) + 1} of ${order.length}`)
    setTasks(next)
    start(async () => {
      const result = await reorderTemplateTasks(templateId, order)
      /* Put the old order back and say why, the same revert-on-refusal contract
         the workflow task list uses for a status it could not change. */
      if (result && 'error' in result) {
        setTasks(before)
        onError(result.error)
      }
    })
  }

  if (tasks.length === 0) {
    /* `text-center` sits on the paragraphs, never on the container: alignment
       is inherited, and a container that centres would centre every label of
       anything a caller renders inside it. Pinned by inherited-alignment. */
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
        <p className="text-center text-sm font-medium text-neutral-700">No tasks yet</p>
        <p className="mx-auto mt-1 max-w-xs text-center text-xs leading-relaxed text-neutral-500">
          Add the first step. Everything after it can be set to wait for the ones above.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className={SHEET_SURFACE}>
        <ul data-slot="template-tasks" className="divide-y divide-neutral-200/80">
          {tasks.map((task, index) => {
            const [first, last] = legalPositions(tasks, task.id)
            const upBlocked = blockingNeighbour(tasks, task.id, index - 1)
            const downBlocked = blockingNeighbour(tasks, task.id, index + 1)
            const waitsFor = task.depends_on
              .map((id) => tasks.findIndex((t) => t.id === id))
              .filter((i) => i >= 0)
              .sort((a, b) => a - b)
            const waitedOnBy = tasks.filter((t) => t.depends_on.includes(task.id)).length

            return (
              <li key={task.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-neutral-400">
                  {String(index + 1).padStart(2, '0')}
                </span>

                <button
                  type="button"
                  onClick={() => onOpen(task.id)}
                  className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
                  aria-label={`Open ${task.subject}`}
                  /* The staircase: a plan's waves of work, visible without
                     drawing a graph. Capped at four levels, because an uncapped
                     indent at depth eight eats the subject column. */
                  style={{ paddingLeft: Math.min(depths.get(task.id) ?? 0, 4) * 12 }}
                >
                  <span className="block truncate text-sm font-medium text-neutral-900">{task.subject}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    {task.role_name} · {offsetPhrase(task)}
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-400">
                    {waitsFor.length === 0
                      ? 'Starts immediately'
                      : `Waits for ${waitsFor.slice(0, 3).map((i) => String(i + 1).padStart(2, '0')).join(', ')}${
                          waitsFor.length > 3 ? ` and ${waitsFor.length - 3} more` : ''
                        }`}
                  </span>
                </button>

                {waitedOnBy > 0 ? (
                  <Pill tone="neutral">{waitedOnBy} waiting</Pill>
                ) : null}

                <div className="flex shrink-0 items-center gap-0.5">
                  <MoveButton
                    ref={(el) => {
                      buttons.current.set(`${task.id}:up`, el)
                    }}
                    direction="up"
                    subject={task.subject}
                    blocked={index <= first ? upBlocked : null}
                    disabled={pending || index <= first}
                    onClick={() => move(task, 'up')}
                  />
                  <MoveButton
                    ref={(el) => {
                      buttons.current.set(`${task.id}:down`, el)
                    }}
                    direction="down"
                    subject={task.subject}
                    blocked={index >= last ? downBlocked : null}
                    disabled={pending || index >= last}
                    onClick={() => move(task, 'down')}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      {/* Otherwise a keyboard user presses a button and hears nothing at all. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  )
}

/**
 * One nudge.
 *
 * `disabled`, not `aria-disabled`, so a dead control leaves the tab order — and
 * the REASON goes in the accessible name, because a button that is simply off
 * with no explanation is the most common way this interaction is built badly.
 */
function MoveButton({
  ref,
  direction,
  subject,
  blocked,
  disabled,
  onClick,
}: {
  ref: (el: HTMLButtonElement | null) => void
  direction: 'up' | 'down'
  subject: string
  blocked: { subject: string; reason: 'waits-for' | 'waited-on' } | null
  disabled: boolean
  onClick: () => void
}) {
  const Glyph = direction === 'up' ? ArrowUpIcon : ArrowDownIcon
  const label = blocked
    ? blocked.reason === 'waits-for'
      ? `Cannot move “${subject}” above “${blocked.subject}”, which it waits for`
      : `Cannot move “${subject}” below “${blocked.subject}”, which waits for it`
    : `Move “${subject}” ${direction}`
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Glyph className="h-3.5 w-3.5" />
    </button>
  )
}

/**
 * The offset, in words.
 *
 * The number means two different things depending on whether the task waits for
 * anything — days from the plan's start, or days from its prerequisite being
 * done — and a label that does not say which leaves the author guessing at a
 * zero point they cannot recover from the saved number. This is the single most
 * likely way to get a template quietly wrong.
 */
export function offsetPhrase(task: Pick<TemplateTask, 'depends_on' | 'due_offset_days'>): string {
  const days = task.due_offset_days
  const plural = days === 1 ? 'day' : 'days'
  if (task.depends_on.length === 0) {
    return days === 0 ? 'Due the day the plan starts' : `Due ${days} ${plural} after the plan starts`
  }
  return days === 0 ? 'Due as soon as it is unblocked' : `Due ${days} ${plural} after the one before it`
}

/* -------------------------------------------------------------------------- */

/**
 * The options both "who does it" pickers offer.
 *
 * Active firm roles, plus `keep` — the role this task already has — even when
 * that one has since been archived. Without the exception, opening a task whose
 * role was retired would show the select sitting on some other name, and saving
 * anything else on the task would quietly reassign it.
 */
function RoleOptions({ firmRoles, keep }: { firmRoles: WorkflowRole[]; keep?: string }) {
  return (
    <>
      {firmRoles
        .filter((r) => r.status === 'active' || r.id === keep)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.status === 'active' ? '' : ' (archived)'}
          </option>
        ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Which of the firm's roles this template uses.
 *
 * A `FieldBox` with NO action and NO edit, so it has no pencil and no Save —
 * this is not a form, it is a set of immediate actions, which is exactly what
 * `MemberManager` says of itself for the same shape of problem.
 *
 * It used to hold a free-text box, and a template author typed a name into it
 * every time. That gave the firm four spellings of "Adviser" and no way to say
 * that two templates meant the same person, so the names moved to one list
 * curated on /admin and this card picks from it.
 *
 * The card is now informational more than operational: a task's own picker
 * attaches whatever role it names, so nothing here has to be done first. What
 * it is still for is seeing what this plan expects of the firm, and taking a
 * role back off when a task stops needing it.
 */
export function RoleManager({
  template,
  firmRoles,
}: {
  template: TemplateDetail
  firmRoles: WorkflowRole[]
}) {
  const [picked, setPicked] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const onTemplate = new Set(template.roles.map((r) => r.workflow_role_id))
  const unused = firmRoles.filter((r) => r.status === 'active' && !onTemplate.has(r.id))

  function run(action: () => Promise<Result>, after?: () => void) {
    setError(null)
    start(async () => {
      const result = await action()
      if (result && 'error' in result) setError(result.error)
      else after?.()
    })
  }

  return (
    <FieldBox
      title="Roles"
      view={
        <div data-slot="template-roles" className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">
            Who does the work. Whoever deploys this template picks one person for each.
          </p>

          {template.roles.length === 0 ? (
            <p className="text-xs text-neutral-400">
              None yet. Adding a task names one, or add one here first.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {template.roles.map((role) => (
                <li key={role.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-neutral-800">
                    {role.name}
                    <span className="ml-1.5 text-xs text-neutral-400">
                      {role.task_count} {role.task_count === 1 ? 'task' : 'tasks'}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending || role.task_count > 0}
                    onClick={() => run(() => removeTemplateRole(role.id))}
                    /* Refused with a count rather than cascaded: a role in use
                       is a question for the author, not one to answer on their
                       behalf by emptying six tasks of their owner. */
                    aria-label={
                      role.task_count > 0
                        ? `${role.name} is on ${role.task_count} tasks — change those first`
                        : `Remove ${role.name}`
                    }
                    title={
                      role.task_count > 0
                        ? `${role.name} is on ${role.task_count} tasks — change those first`
                        : `Remove ${role.name}`
                    }
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Only roles this template does not already use, and only ones the
              firm still offers — an archived role stays on the templates that
              have it, but is not handed out again. `unused` being empty is a
              statement, not a failure, so the picker is replaced by it. */}
          {unused.length === 0 ? (
            <p className="text-xs text-neutral-400">
              {firmRoles.some((r) => r.status === 'active')
                ? 'Every role the firm has is already on this plan.'
                : 'The firm has no roles yet. Add one under Administration.'}
            </p>
          ) : (
            <div className="flex gap-2">
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                aria-label="Add a role"
                className={FIELD_INPUT}
              >
                <option value="">Add a role…</option>
                {unused.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending || !picked}
                onClick={() => run(() => addTemplateRole(template.id, picked), () => setPicked(''))}
                className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      }
    />
  )
}

/**
 * Publish, archive, restore.
 *
 * Not a `FieldBox` — it is not a form. Publish is DISABLED while the gate has
 * anything in it, with the count on the button, because a Publish that fails on
 * click with something the client already knew is a worse answer than a button
 * that explains itself.
 */
export function TemplateLifecycle({ template, issues }: { template: TemplateDetail; issues: number }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function to(status: 'draft' | 'published' | 'archived') {
    setError(null)
    start(async () => {
      const result = await setWorkflowTemplateStatus(template.id, status)
      if (result && 'error' in result) setError(result.error)
    })
  }

  return (
    <div data-slot="template-lifecycle" className="mt-4 border-t border-neutral-200 pt-3">
      <div className="flex items-center justify-between gap-2">
        <Pill on={template.status === 'published'}>{TEMPLATE_STATUS_LABEL[template.status]}</Pill>

        <div className="flex gap-1.5">
          {template.status !== 'published' ? (
            <button
              type="button"
              disabled={pending || issues > 0}
              onClick={() => to('published')}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {issues > 0 ? `Publish — ${issues} to fix first` : 'Publish'}
            </button>
          ) : null}
          {template.status === 'published' ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => to('draft')}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Withdraw
            </button>
          ) : null}
          {template.status !== 'archived' ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => to('archived')}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        {template.status === 'draft'
          ? 'Nobody can deploy this yet.'
          : template.status === 'published'
            ? `Anyone can deploy this${
                template.deployment_count > 0
                  ? `. Used by ${template.deployment_count} ${
                      template.deployment_count === 1 ? 'workflow' : 'workflows'
                    }`
                  : ''
              }. Editing it changes future deployments only — workflows already running keep the tasks they were given.`
            : 'Kept for the record. Restore it to change or deploy it again.'}
      </p>

      {template.status === 'archived' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => to('published')}
          className="mt-2 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          Restore
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Adding a task. Always APPENDED last — never "insert at position", which makes
 * the author choose a number before they have written the task. Append then
 * move is one decision at a time, and it means every existing task is a legal
 * prerequisite at the moment of writing, so the picker needs no filtering.
 */
function NewTemplateTaskForm({
  template,
  firmRoles,
}: {
  template: TemplateDetail
  firmRoles: WorkflowRole[]
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const active = firmRoles.filter((r) => r.status === 'active')
  const [waits, setWaits] = useState(false)
  const [state, formAction, pending] = useActionState<Result, FormData>(addTemplateTask, null)

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  function hide() {
    setOpen(false)
    setWaits(false)
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
        /* The FIRM's list, not this template's: a task may name any active
           role and the template picks it up. What makes a task impossible is
           the firm having nobody to hand it to. */
        disabled={active.length === 0}
        title={active.length === 0 ? 'The firm has no roles yet — add one under Administration' : undefined}
        className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
      >
        Add task
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="add-template-task-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <h2 id="add-template-task-title" className="text-base font-semibold text-neutral-900">Add a task</h2>
          <input type="hidden" name="template_id" value={template.id} />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">What has to be done</span>
            <input name="subject" required autoFocus className={FIELD_INPUT} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Who does it</span>
            <select name="workflow_role_id" required defaultValue="" className={FIELD_INPUT}>
              <option value="" disabled>
                Choose a role
              </option>
              <RoleOptions firmRoles={firmRoles} />
            </select>
          </label>

          {template.tasks.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-neutral-700">Waits for</legend>
              <p className="text-xs text-neutral-500">
                Leave empty and it starts as soon as the plan does.
              </p>
              <div className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {template.tasks.map((t, i) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="depends_on"
                      value={t.id}
                      onChange={(e) => {
                        if (e.target.checked) setWaits(true)
                        else
                          setWaits(
                            Boolean(
                              e.currentTarget.form &&
                                [...e.currentTarget.form.querySelectorAll<HTMLInputElement>(
                                  'input[name="depends_on"]',
                                )].some((c) => c.checked),
                            ),
                          )
                      }}
                      className="rounded border-neutral-300"
                    />
                    <span className="text-xs tabular-nums text-neutral-400">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate text-neutral-700">{t.subject}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            {/* THE LABEL CHANGES WITH THE TICKBOXES ABOVE. The number means days
                from the plan's start for a task that waits for nothing, and days
                from its prerequisite finishing for every other — and there is no
                way to tell which from the saved number. */}
            <span className="font-medium text-neutral-700">
              {waits
                ? 'Due this many days after the last thing it waits for is done'
                : 'Due this many days after the plan starts'}
            </span>
            <input
              name="due_offset_days"
              type="number"
              min={0}
              defaultValue={0}
              className={FIELD_INPUT}
            />
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
              className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

/** One template task, open in the shared drawer. */
function TemplateTaskPanel({
  template,
  firmRoles,
  tasks,
  task,
  onClose,
  onError,
}: {
  template: TemplateDetail
  firmRoles: WorkflowRole[]
  /** The list as it is ON SCREEN, which during an optimistic move is not yet
   *  the list the server last sent. The panel's "earlier than me" set has to
   *  agree with what the author can see. */
  tasks: TemplateTask[]
  task: TemplateTask
  onClose: () => void
  onError: (message: string | null) => void
}) {
  const [pending, start] = useTransition()
  const index = tasks.findIndex((t) => t.id === task.id)
  // Only tasks ABOVE this one may be waited for; the rule that makes a cycle
  // unrepresentable is the same rule that makes this list short.
  const earlier = tasks.slice(0, Math.max(0, index))
  const waitedOnBy = tasks.filter((t) => t.depends_on.includes(task.id))

  return (
    <>
      <DrawerHeader
        id="template-task-title"
        eyebrow={template.name}
        title={task.subject}
        pills={
          <>
            <Pill tone="neutral">{task.role_name}</Pill>
            <Pill tone="neutral">{String(index + 1).padStart(2, '0')}</Pill>
          </>
        }
        onClose={onClose}
      />
      <DrawerBody>
        <FieldBox
          title="Details"
          action={saveTemplateTask}
          identity={
            <>
              <input type="hidden" name="task_id" value={task.id} />
              {/* The sentinel: without it, unticking everything would read as
                  "leave the prerequisites alone" and they could never be cleared. */}
              <input type="hidden" name="depends_on_set" value="1" />
            </>
          }
          view={
            <dl className="flex flex-col gap-3 text-sm">
              <Field label="What has to be done" value={task.subject} wrap />
              <Field label="Notes" value={task.description ?? undefined} wrap />
              <Field label="Who does it" value={task.role_name} />
              <Field label="When it is due" value={offsetPhrase(task)} wrap />
              <Field
                label="Waits for"
                value={
                  task.depends_on.length === 0
                    ? undefined
                    : tasks
                        .filter((t) => task.depends_on.includes(t.id))
                        .map((t) => t.subject)
                        .join(', ')
                }
                wrap
              />
              <Field
                label="Waited for by"
                value={waitedOnBy.length === 0 ? undefined : waitedOnBy.map((t) => t.subject).join(', ')}
                wrap
              />
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  What has to be done
                </span>
                <input name="subject" defaultValue={task.subject} required className={FIELD_INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Notes</span>
                <textarea name="description" rows={3} defaultValue={task.description ?? ''} className={FIELD_INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  Who does it
                </span>
                <select
                  name="workflow_role_id"
                  defaultValue={task.workflow_role_id}
                  className={FIELD_INPUT}
                >
                  <RoleOptions firmRoles={firmRoles} keep={task.workflow_role_id} />
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  {task.depends_on.length > 0
                    ? 'Days after the last thing it waits for'
                    : 'Days after the plan starts'}
                </span>
                <input
                  name="due_offset_days"
                  type="number"
                  min={0}
                  defaultValue={task.due_offset_days}
                  className={FIELD_INPUT}
                />
              </label>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                  Waits for
                </legend>
                {earlier.length === 0 ? (
                  <p className="text-xs text-neutral-400">
                    Nothing comes before this task, so it starts with the plan.
                  </p>
                ) : (
                  earlier.map((t, i) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="depends_on"
                        value={t.id}
                        defaultChecked={task.depends_on.includes(t.id)}
                        className="rounded border-neutral-300"
                      />
                      <span className="text-xs tabular-nums text-neutral-400">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate text-neutral-700">{t.subject}</span>
                    </label>
                  ))
                )}
              </fieldset>
            </div>
          }
        />
      </DrawerBody>
      <DrawerFooter>
        <button
          type="button"
          disabled={pending || waitedOnBy.length > 0}
          title={
            waitedOnBy.length > 0
              ? `${waitedOnBy.length} ${waitedOnBy.length === 1 ? 'task waits' : 'tasks wait'} for this one — change those first`
              : undefined
          }
          onClick={() => {
            onError(null)
            start(async () => {
              const result = await removeTemplateTask(task.id)
              if (result && 'error' in result) onError(result.error)
              else onClose()
            })
          }}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {waitedOnBy.length > 0
            ? `${waitedOnBy.length} ${waitedOnBy.length === 1 ? 'task waits' : 'tasks wait'} for this`
            : 'Remove task'}
        </button>
      </DrawerFooter>
    </>
  )
}
