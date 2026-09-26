'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createClientGroup,
  createServiceProvider,
  type RegisterCreateState,
} from '@/app/(shell)/groups/actions'
import { AddAction } from '@/components/add-action'
import { FIELD_INPUT } from '@/components/field-box'

/**
 * The registers' + buttons: one dialog shape, two records it can make.
 *
 * Both navigate INTO the record on success — the template list's pattern, and
 * for the same reason: a household created empty exists to be given members,
 * a provider to be looked at, and hunting the new row out of the register
 * would be a wasted step. Everything else is the house creation dialog:
 * `qw-modal m-auto` (the preflight-margin rule), `aria-labelledby` on its own
 * heading, backdrop click closes, the trigger is `AddAction` so the button is
 * the same button every list has.
 *
 * ONE field. A household's members, a provider's contacts, service levels,
 * notes — all of that has a better home than a creation dialog: the record's
 * own page, which is where the dialog takes you. A creation form that asks
 * eight questions gets eight guesses.
 */
function CreateDialog({
  label,
  title,
  fieldLabel,
  placeholder,
  hint,
  action,
  destination,
  triggerVariant = 'primary',
  children,
}: {
  label: string
  title: string
  fieldLabel: string
  placeholder: string
  hint: string
  action: (prev: RegisterCreateState, formData: FormData) => Promise<RegisterCreateState>
  destination: (id: string) => string
  triggerVariant?: 'primary' | 'quiet'
  children?: React.ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<RegisterCreateState, FormData>(action, null)
  const titleId = `new-register-record-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`

  useEffect(() => {
    if (state && 'ok' in state && open) {
      formRef.current?.reset()
      dialogRef.current?.close()
      router.push(destination(state.id))
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

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  function hide() {
    dialogRef.current?.close()
  }

  return (
    <>
      <AddAction label={label} variant={triggerVariant} onClick={show} />

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <h2 id={titleId} className="text-base font-semibold text-neutral-900">
            {title}
          </h2>

          {children}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">{fieldLabel}</span>
            <input name="name" required autoFocus placeholder={placeholder} className={FIELD_INPUT} />
            <span className="text-xs text-neutral-500">{hint}</span>
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
              {pending ? 'Creating…' : label}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

/** A household or an entity — the register the button sits on fixes which. */
export function NewGroupForm({
  groupType,
  triggerVariant,
}: {
  groupType: 'household' | 'business_entity'
  triggerVariant?: 'primary' | 'quiet'
}) {
  const household = groupType === 'household'
  return (
    <CreateDialog
      label={household ? 'New household' : 'New entity'}
      title={household ? 'New client household' : 'New entity or structure'}
      fieldLabel="What it is called"
      placeholder={household ? 'Smith Household' : 'Smith Family Trust'}
      hint={
        household
          ? 'It starts as a prospect with nobody in it — you add the people on its page, which opens next.'
          : 'It starts as a prospect. Its people and holdings are added on its page, which opens next.'
      }
      action={createClientGroup}
      destination={(id) => `/groups/${id}`}
    triggerVariant={triggerVariant}
    >
      {/* The type travels with the form rather than being asked: the register
          the button sits on has already answered the question. */}
      <input type="hidden" name="group_type" value={groupType} />
    </CreateDialog>
  )
}

export function NewProviderForm({ triggerVariant }: { triggerVariant?: 'primary' | 'quiet' }) {
  return (
    <CreateDialog
      label="New provider"
      title="New service provider"
      fieldLabel="What they are called"
      placeholder="HUB24"
      hint="A platform, insurer or fund manager. The register is firm-wide, so a name that already exists is refused."
      action={createServiceProvider}
      destination={(id) => `/groups/providers/${id}`}
      triggerVariant={triggerVariant}
    />
  )
}
