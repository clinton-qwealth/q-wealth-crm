'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createPolicy, type CreatePolicyState } from '@/app/(shell)/groups/actions'
import type { OwnerOption, ProviderOption } from './add-account-modal'
import { PlusIcon } from './icons'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/** Amounts are entered per cover. A policy is one contract that may bundle
 *  several, so the form asks for each rather than one figure. */
const COVERS = [
  { key: 'life', label: 'Life', hint: 'Lump sum' },
  { key: 'tpd', label: 'TPD', hint: 'Lump sum' },
  { key: 'trauma', label: 'Trauma', hint: 'Lump sum' },
  { key: 'income_protection', label: 'Income protection', hint: 'Per month' },
] as const

/**
 * Add an insurance policy.
 *
 * Mirrors AddAccountModal: native <dialog> for focus trapping, Escape and an
 * inert background, with the same fade-and-rise transition.
 *
 * Owner and life insured are asked separately because they genuinely differ —
 * a policy can be owned by a spouse or a super fund while covering someone else.
 * Both default to nobody, so neither is assumed.
 */
export function AddPolicyModal({
  owners,
  providers,
  triggerVariant = 'primary',
}: {
  owners: OwnerOption[]
  providers: ProviderOption[]
  triggerVariant?: 'primary' | 'quiet'
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<CreatePolicyState, FormData>(
    createPolicy,
    null,
  )

  const show = () => {
    dialogRef.current?.showModal()
    setOpen(true)
  }
  const hide = () => {
    dialogRef.current?.close()
    setOpen(false)
  }

  useEffect(() => {
    if (state && 'ok' in state && open) {
      formRef.current?.reset()
      hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // <dialog> handles Escape itself, but closes without telling React.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => setOpen(false)
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  const trigger =
    triggerVariant === 'quiet' ? (
      <button
        type="button"
        onClick={show}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add policy
      </button>
    ) : (
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <PlusIcon className="h-4 w-4" />
        Add policy
      </button>
    )

  return (
    <>
      {trigger}

      <dialog
        ref={dialogRef}
        aria-labelledby="add-policy-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2
              id="add-policy-title"
              className="text-base font-semibold tracking-tight text-neutral-900"
            >
              Add insurance policy
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              The owner holds the contract; the life insured is the person covered.
            </p>
          </div>

          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Policy name</span>
                <input name="label" required placeholder="e.g. TAL Accelerated Protection" className={FIELD} />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Policy number</span>
                <input name="policy_number" required placeholder="e.g. TAL-88231" className={FIELD} />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Insurer</span>
                <select name="provider_party_id" className={FIELD} disabled={providers.length === 0}>
                  <option value="">
                    {providers.length === 0 ? 'None on file yet' : 'Not recorded'}
                  </option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Status</span>
                <select name="status" defaultValue="in_force" className={FIELD}>
                  <option value="in_force">In force</option>
                  <option value="lapsed">Lapsed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className={LABEL}>Owner</legend>
              <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                {owners.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-neutral-800">
                    <input type="checkbox" name="owner_party_ids" value={o.id} className="accent-brand" />
                    {o.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1.5">
              <legend className={LABEL}>Life insured</legend>
              <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                {owners.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-neutral-800">
                    <input type="checkbox" name="life_insured_ids" value={o.id} className="accent-brand" />
                    {o.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className={LABEL}>Cover</legend>
              <p className="text-xs text-neutral-500">
                Fill in the covers this policy holds. Life, TPD and trauma are lump sums;
                income protection is a monthly benefit.
              </p>
              {COVERS.map((c) => (
                <div key={c.key} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
                  <span className="text-sm text-neutral-700">{c.label}</span>
                  <input
                    name={`cover_${c.key}`}
                    inputMode="decimal"
                    placeholder={c.hint}
                    className={FIELD}
                  />
                  <input
                    name={`period_${c.key}`}
                    placeholder={c.key === 'income_protection' ? 'to age 65' : 'Benefit period'}
                    className={FIELD}
                  />
                </div>
              ))}
            </fieldset>

            <div className="grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Premium</span>
                <input name="premium" inputMode="decimal" placeholder="Optional" className={FIELD} />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Frequency</span>
                <select name="premium_frequency" defaultValue="" className={FIELD}>
                  <option value="">—</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="half_yearly">Half-yearly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Structure</span>
                <select name="premium_structure" defaultValue="" className={FIELD}>
                  <option value="">—</option>
                  <option value="stepped">Stepped</option>
                  <option value="level">Level</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Commenced</span>
              <input type="date" name="commenced_on" className={FIELD} />
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
              disabled={pending || owners.length === 0}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {pending ? 'Adding…' : 'Add policy'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
