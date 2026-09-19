'use client'

import { useActionState } from 'react'
import { requestStaffAccess, signUpForAccess } from '@/app/request-access/actions'

/**
 * The two forms a person meets on the way in, shared by the request page and
 * the consent screen so the two cannot drift.
 */
const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30'
const LABEL = 'text-xs font-semibold uppercase tracking-wider text-neutral-500'
const BUTTON =
  'w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40'

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpForAccess, null)
  if (state && 'ok' in state) {
    return (
      <p role="status" className="text-sm leading-relaxed text-neutral-700">
        {state.message}
      </p>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Full name</span>
        <input name="full_name" required autoComplete="name" className={FIELD} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Q Wealth email</span>
        <input name="email" type="email" required autoComplete="email" placeholder="you@qwealth.com.au" className={FIELD} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Password</span>
        <input name="password" type="password" required minLength={12} autoComplete="new-password" className={FIELD} />
      </label>
      {state && 'error' in state ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}

export function RequestAccessForm({ suggestedName, next }: { suggestedName: string | null; next?: string }) {
  const [state, action, pending] = useActionState(requestStaffAccess, null)
  return (
    <form action={action} className="flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Full name</span>
        <input name="full_name" required defaultValue={suggestedName ?? ''} autoComplete="name" className={FIELD} />
      </label>
      {state && 'error' in state ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? 'Sending…' : 'Request access'}
      </button>
    </form>
  )
}
