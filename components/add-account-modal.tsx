'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createAccount, type CreateAccountState } from '@/app/(shell)/groups/actions'
import { PlusIcon } from './icons'

export type OwnerOption = { id: string; name: string }
export type ProviderOption = { id: string; name: string }

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/**
 * Add-account dialog.
 *
 * Uses the native <dialog>: focus trapping, Escape-to-close, an inert background
 * and top-layer stacking come free, and are all easy to get subtly wrong by hand.
 * The fade and slide live in globals.css, where @starting-style and
 * `allow-discrete` can reach the backdrop and the discrete display property.
 *
 * Owners are the group's own members rather than every party in the system: an
 * account being added from a group's page is almost always owned by someone in
 * it, and a joint account is simply two of them ticked.
 */
export function AddAccountModal({
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
  const [state, formAction, pending] = useActionState<CreateAccountState, FormData>(
    createAccount,
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

  // Close once the server reports success, and clear the form so reopening does
  // not present the previous account's details.
  useEffect(() => {
    if (state && 'ok' in state && state.ok && open) {
      formRef.current?.reset()
      hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Escape is handled by <dialog> itself, but it fires `cancel`/`close` without
  // telling React, so the local state has to follow.
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
        Add account
      </button>
    ) : (
      <button
        type="button"
        onClick={show}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add account
      </button>
    )

  return (
    <>
      {trigger}

      <dialog
        ref={dialogRef}
        aria-labelledby="add-account-title"
        // Clicking the backdrop lands on the dialog itself; clicks inside the
        // panel land on the panel, so comparing the target distinguishes them.
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 id="add-account-title" className="text-base font-semibold tracking-tight text-neutral-900">
              Add financial account
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Ownership decides which group the account rolls up to.
            </p>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Type</span>
                <select name="account_type" required defaultValue="investment" className={FIELD}>
                  <option value="investment">Investment</option>
                  <option value="superannuation">Superannuation</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Provider</span>
                <select name="provider_party_id" className={FIELD} disabled={providers.length === 0}>
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

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Account name</span>
                <input
                  name="label"
                  required
                  placeholder="e.g. Netwealth Wrap"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Status</span>
                <select name="status" defaultValue="active" className={FIELD}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className={LABEL}>Owners</legend>
              <p className="text-xs text-neutral-400">
                Tick more than one for a joint account.
              </p>
              {owners.length === 0 ? (
                <p className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                  This group has no members to own an account.
                </p>
              ) : (
                <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                  {owners.map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        name="owner_party_ids"
                        value={o.id}
                        className="h-3.5 w-3.5 accent-[var(--brand-500)]"
                      />
                      {o.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Account number</span>
                <input
                  name="account_number"
                  required
                  placeholder="e.g. 12345678"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Opened</span>
                <input type="date" name="opened_on" className={FIELD} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Opening value</span>
                <input
                  name="opening_value"
                  inputMode="decimal"
                  placeholder="Optional"
                  className={`${FIELD} tabular-nums`}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Valued on</span>
                <input type="date" name="valued_on" className={FIELD} />
              </label>
            </div>

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
              {pending ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
