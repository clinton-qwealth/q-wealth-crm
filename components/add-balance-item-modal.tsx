'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  createBalanceItem,
  type CreateBalanceItemState,
} from '@/app/(shell)/groups/actions'
import { ASSET_TYPES, LIABILITY_TYPES } from '@/lib/balance-sheet'
import { PlusIcon } from './icons'
import { QUIET_ACTION } from './ui'
import type { OwnerOption, ProviderOption } from './add-account-modal'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/** What a liability can be secured against: the group's live assets. */
export type SecurityOption = { id: string; label: string }

/**
 * Add-asset and add-liability dialog — one component, told which side it is on.
 *
 * Not two: the two forms differ in their type list, their words, and one extra
 * field, and every other line of them is identical. Two files would drift, and
 * the thing that must not drift is the share arithmetic.
 *
 * The same native `<dialog>` as `AddAccountModal`, for the same reasons given
 * there: focus trapping, Escape, an inert background and top-layer stacking all
 * come free and are all easy to get subtly wrong by hand.
 */
export function AddBalanceItemModal({
  side,
  owners,
  providers,
  securable = [],
  triggerVariant = 'primary',
}: {
  side: 'asset' | 'liability'
  owners: OwnerOption[]
  providers: ProviderOption[]
  /** Only read on the liability side — the assets a loan can be secured on. */
  securable?: SecurityOption[]
  triggerVariant?: 'primary' | 'quiet'
}) {
  const liability = side === 'liability'
  const word = liability ? 'liability' : 'asset'
  const addLabel = liability ? 'Add liability' : 'Add asset'
  const types = liability ? LIABILITY_TYPES : ASSET_TYPES

  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  /* Which owners are ticked, so a share box appears beside each one as it is
     chosen. The checkboxes stay uncontrolled — this mirrors them rather than
     owning them, so `form.reset()` still clears the form in one call. */
  const [chosen, setChosen] = useState<string[]>([])
  const [state, formAction, pending] = useActionState<CreateBalanceItemState, FormData>(
    createBalanceItem,
    null
  )

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }

  function hide() {
    setOpen(false)
    dialogRef.current?.close()
  }

  useEffect(() => {
    if (state && 'ok' in state && state.ok && open) {
      formRef.current?.reset()
      setChosen([])
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

  const trigger =
    triggerVariant === 'primary' ? (
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <PlusIcon className="h-4 w-4" />
        {addLabel}
      </button>
    ) : (
      <button type="button" onClick={show} className={QUIET_ACTION}>
        <PlusIcon className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    )

  const titleId = `add-${word}-title`

  return (
    <>
      {trigger}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
              {liability ? 'Add liability' : 'Add asset'}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {liability
                ? 'Amount owed today. Ownership decides which group it rolls up to.'
                : 'Value today. Ownership decides which group it rolls up to.'}
            </p>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Type</span>
                {/* The list is this side's types only, which is what keeps a
                    car loan out of the assets column: `side` is a generated
                    column in the database, derived from exactly this value. */}
                <select name="item_type" required defaultValue={types[0]![0]} className={FIELD}>
                  {types.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>{liability ? 'Lender' : 'Institution'}</span>
                <select
                  name="institution_party_id"
                  className={FIELD}
                  disabled={providers.length === 0}
                >
                  <option value="">
                    {providers.length === 0 ? 'None recorded yet' : 'Not specified'}
                  </option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Name</span>
              <input
                name="label"
                required
                placeholder={liability ? 'e.g. 14 Mercer St mortgage' : 'e.g. 14 Mercer St'}
                className={FIELD}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>{liability ? 'Amount owed' : 'Value'}</span>
                {/* Positive on both sides. A liability's sign is decided once,
                    where the totals are worked out, rather than in every caller
                    that ever sums a mixed list. */}
                <input
                  name="value"
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${FIELD} tabular-nums`}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Valued on</span>
                <input type="date" name="valued_on" className={FIELD} />
              </label>
            </div>

            {liability ? (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Secured against</span>
                <select
                  name="secured_against_id"
                  className={FIELD}
                  disabled={securable.length === 0}
                >
                  <option value="">
                    {securable.length === 0 ? 'No assets recorded yet' : 'Unsecured'}
                  </option>
                  {securable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <fieldset className="flex flex-col gap-1.5">
              <legend className={LABEL}>Owners</legend>
              <p className="text-xs text-neutral-400">
                Shares split evenly unless you set them. They must total 100%.
              </p>
              {owners.length === 0 ? (
                <p className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                  This group has no members to own {liability ? 'a liability' : 'an asset'}.
                </p>
              ) : (
                <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                  {owners.map((o) => {
                    const ticked = chosen.includes(o.id)
                    return (
                      <div key={o.id} className="flex items-center gap-2">
                        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-white">
                          <input
                            type="checkbox"
                            name="owner_party_ids"
                            value={o.id}
                            className="h-3.5 w-3.5 accent-[var(--brand-500)]"
                            onChange={(e) =>
                              setChosen((prev) =>
                                e.target.checked
                                  ? [...prev, o.id]
                                  : prev.filter((id) => id !== o.id)
                              )
                            }
                          />
                          {o.name}
                        </label>
                        {/* The share box appears only once a name is ticked:
                            a column of empty percentages beside unticked names
                            reads as a form somebody failed to fill in. */}
                        {ticked ? (
                          <span className="flex items-center gap-1">
                            <input
                              name={`share_${o.id}`}
                              inputMode="decimal"
                              aria-label={`${o.name} share`}
                              placeholder="Even"
                              className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15"
                            />
                            <span className="text-xs text-neutral-500">%</span>
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </fieldset>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Notes</span>
              <input name="notes" placeholder="Optional" className={FIELD} />
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
              {pending ? 'Adding…' : addLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
