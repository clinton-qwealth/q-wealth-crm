'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-visible:border-neutral-100"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-visible:border-neutral-100"
        />
      </label>

      {state?.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
