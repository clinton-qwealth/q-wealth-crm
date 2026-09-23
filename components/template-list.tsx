'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createWorkflowTemplate, type TemplateCreateState } from '@/app/(shell)/admin/actions'
import { DataRow, DataSection } from '@/components/data-section'
import { Pill } from '@/components/ui'
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
          primary={t.name}
          secondary={secondaryLine(t)}
          meta={
            /* Published is the only live state, so it is the only one that
               takes the "on" treatment. Draft and archived look alike on
               purpose: the word carries the difference, and archived sorts to
               the bottom anyway. */
            <Pill on={t.status === 'published'}>{TEMPLATE_STATUS_LABEL[t.status]}</Pill>
          }
          trigger={{ label: `Open ${t.name}`, href: `/admin/templates/${t.id}` }}
        />
      ))}
    </DataSection>
  )
}

/** What the row says under the name. The deployment count only appears once
 *  there is one — "used by 0 workflows" is noise on every draft. */
function secondaryLine(t: TemplateSummary): string {
  const parts = [
    `${t.task_count} ${t.task_count === 1 ? 'task' : 'tasks'}`,
    `${t.role_count} ${t.role_count === 1 ? 'role' : 'roles'}`,
  ]
  if (t.deployment_count > 0) {
    parts.push(`used by ${t.deployment_count} ${t.deployment_count === 1 ? 'workflow' : 'workflows'}`)
  }
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
      <button
        type="button"
        onClick={show}
        className={
          triggerVariant === 'quiet'
            ? 'rounded-md px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
            : 'rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700'
        }
      >
        New template
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-lg p-0 backdrop:bg-neutral-900/20"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">New workflow template</h2>
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
