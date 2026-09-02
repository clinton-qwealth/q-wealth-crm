'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15"
        />
      </label>

      {state?.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
