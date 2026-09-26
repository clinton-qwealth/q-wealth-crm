'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  addProviderContact,
  removeProviderContact,
  type ProviderContactState,
} from '@/app/(shell)/groups/actions'
import { FIELD_INPUT } from '@/components/field-box'
import { PlusIcon } from '@/components/icons'
import { InitialsTile, SHEET, WELL } from '@/components/ui'
import type { ProviderContact } from '@/lib/groups'

/**
 * A provider's key contacts: the households' members well, worn by a provider.
 *
 * Same object on purpose — a light well, one sheet lifting off it, hairline
 * rows with an initials circle (contacts are PEOPLE, and people are circles
 * here), the role as the second line, and the add action as the sheet's footer
 * band. An adviser who has used a household page already knows how this works.
 *
 * The differences are the record's, not the design's: a contact has no drawer
 * (four fields fit on the row), so rows do not open — instead each carries a
 * quiet Remove, refused for nobody since contacts are firm-curated like the
 * register itself. And the add is a small dialog rather than the member
 * panel's person-search, because a BDM is not on file anywhere else to be
 * searched for — the table's migration says why they are not parties.
 */
export function ProviderContacts({
  providerPartyId,
  contacts,
}: {
  providerPartyId: string
  contacts: ProviderContact[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function remove(id: string) {
    setError(null)
    start(async () => {
      const result = await removeProviderContact(id)
      if (result && 'error' in result) setError(result.error)
    })
  }

  return (
    <div className={`mt-5 rounded-lg p-3 ${WELL}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Key contacts</h3>

      <div className={`mt-2.5 ${SHEET}`}>
        {contacts.length ? (
          <ul className="divide-y divide-neutral-200/80">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <InitialsTile name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900">{c.name}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {[c.role_title, c.email, c.phone].filter(Boolean).join(' · ') || 'Contact'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(c.id)}
                  aria-label={`Remove ${c.name}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-sm text-neutral-400">No contacts yet.</p>
        )}

        {/* The footer band, as the members sheet closes itself. */}
        <div className="border-t border-neutral-200 bg-neutral-50">
          <AddContactDialog providerPartyId={providerPartyId} />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function AddContactDialog({ providerPartyId }: { providerPartyId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ProviderContactState, FormData>(
    addProviderContact,
    null,
  )

  useEffect(() => {
    if (state && 'ok' in state) {
      formRef.current?.reset()
      /* Close the element; its `close` event clears `open` below — one path
         out of the dialog, and no setState inside this effect. */
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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          dialogRef.current?.showModal()
        }}
        className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add contact
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="add-provider-contact-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close()
        }}
        className="qw-modal m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-5">
          <h2 id="add-provider-contact-title" className="text-base font-semibold text-neutral-900">
            Add a key contact
          </h2>
          <input type="hidden" name="provider_party_id" value={providerPartyId} />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Name</span>
            <input name="name" required autoFocus className={FIELD_INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Role</span>
            <input name="role_title" placeholder="BDM" className={FIELD_INPUT} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-neutral-700">Email</span>
              <input name="email" type="email" className={FIELD_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-neutral-700">Phone</span>
              <input name="phone" className={FIELD_INPUT} />
            </label>
          </div>

          {state && 'error' in state ? (
            <p role="alert" className="text-xs text-red-600">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !open}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {pending ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
