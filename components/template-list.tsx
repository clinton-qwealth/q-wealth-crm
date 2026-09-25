'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createWorkflowTemplate, type TemplateCreateState } from '@/app/(shell)/admin/actions'
import { AddAction } from '@/components/add-action'
import { DataRow, DataSection } from '@/components/data-section'
import { WorkflowTemplateTile } from '@/components/ui'
import { TEMPLATE_STATUS_LABEL, type TemplateSummary } from '@/lib/templates'

/**
 * The Templates tab: every workflow template, and the way to start one.
 *
 * A LIST ONLY — opening a template goes to its own route rather than a drawer.
 * A template is not a record with a few fields; it is a list of tasks, each of
 * which is itself a record wanting a panel. A drawer here would need a second
 * drawer inside it, and the editor's rows carry a position, a subject, a role,
 * an offset, prerequisite chips and two move buttons, which does not fit the
 * drawer's 480–670px of content. The route also keeps the editor's read off the
 * admin page's single wave, which every administrator pays for on every visit.
 */
export function TemplateList({ templates }: { templates: TemplateSummary[] }) {
  return (
    <DataSection
      title="Workflow templates"
      countLabel={`${templates.length} ${templates.length === 1 ? 'template' : 'templates'}`}
      addLabel="New template"
      action={<NewTemplateForm triggerVariant="quiet" />}
      emptyAction={<NewTemplateForm />}
      empty={{
        title: 'No templates yet',
        description:
          'A template is a set of tasks, in order, that anybody can deploy into a workflow. Write one here and publish it when it is ready.',
      }}
    >
      {templates.map((t) => (
        <DataRow
          key={t.id}
          /* The lifecycle rides the TILE, the way an account's status does —
             violet and a workflow glyph when published, a pencil while it is
             still being written, the archive when it is done with. The pill
             that used to sit in `meta` gave the status the row's figure slot;
             the figure a template is scanned for is how much it is USED. */
          leading={<WorkflowTemplateTile status={t.status} />}
          primary={t.name}
          secondary={secondaryLine(t)}
          meta={
            t.deployment_count > 0 ? (
              <span className="block text-right">
                {t.deployment_count}
                <span className="block text-[11px] font-normal leading-tight text-neutral-400">
                  {t.deployment_count === 1 ? 'workflow' : 'workflows'}
                </span>
              </span>
            ) : undefined
          }
          trigger={{ label: `Open ${t.name}`, href: `/admin/templates/${t.id}` }}
        />
      ))}
    </DataSection>
  )
}

/**
 * What the row says under the name.
 *
 * The state LEADS the line for anything not published, in words, because on
 * the tile it is only a glyph and a tint — a reader who cannot tell violet
 * from grey still gets "Draft" before the counts. Published rows do not say
 * "Published", the same way an active account does not say "Active": the
 * ordinary state is the unmarked one.
 *
 * The deployment count moved from this line to the row's figure slot, where a
 * number the list is scanned for belongs.
 */
function secondaryLine(t: TemplateSummary): string {
  const parts = [
    `${t.task_count} ${t.task_count === 1 ? 'task' : 'tasks'}`,
    `${t.role_count} ${t.role_count === 1 ? 'role' : 'roles'}`,
  ]
  if (t.status !== 'published') parts.unshift(TEMPLATE_STATUS_LABEL[t.status])
  return parts.join(' · ')
}

/**
 * Starting a template, then going straight into it.
 *
 * The one creation dialog in this codebase that navigates on success. Every
 * other one closes and leaves you looking at the list, which is right when the
 * thing you made is complete; a template made of nothing but a name is not, and
 * hunting for it in the list to start writing would be a wasted step.
 */
export function NewTemplateForm({ triggerVariant = 'primary' }: { triggerVariant?: 'primary' | 'quiet' }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<TemplateCreateState, FormData>(
    createWorkflowTemplate,
    null,
  )

  /* show/hide rather than an effect on `open`: the same shape every other
     creation dialog here uses, and it keeps React's state and the dialog
     element in step without a render pass between them. */
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
      router.push(`/admin/templates/${state.id}`)
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
      <AddAction label="New template" variant={triggerVariant} onClick={show} />

      <dialog
        ref={dialogRef}
        aria-labelledby="new-template-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <div>
            <h2 id="new-template-title" className="text-base font-semibold text-neutral-900">New workflow template</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Name it now; the tasks, the roles and the order come next.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Name</span>
            <input
              name="name"
              required
              autoFocus
              placeholder="New client onboarding"
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Description</span>
            <textarea
              name="description"
              rows={2}
              placeholder="What this plan is for."
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
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
              {pending ? 'Creating…' : 'Create and open'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
