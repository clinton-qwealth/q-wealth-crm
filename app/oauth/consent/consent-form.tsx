'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * Human-readable descriptions for the scopes Supabase Auth issues. Anything not
 * listed is still shown, unmodified, rather than hidden — a consent screen that
 * quietly omits a scope is worse than one that shows a raw string.
 */
const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm who you are',
  profile: 'Your name and profile details',
  email: 'Your email address',
  phone: 'Your phone number',
  offline_access: 'Stay connected without asking you again each time',
}

export function ConsentForm({
  authorizationId,
  clientName,
  clientUri,
  redirectUri,
  scope,
  staffName,
  staffEmail,
  profileName,
}: {
  authorizationId: string
  clientName: string
  clientUri: string | null
  redirectUri: string
  scope: string
  staffName: string
  staffEmail: string
  profileName: string
}) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scopes = scope.split(/\s+/).filter(Boolean)

  async function decide(decision: 'approve' | 'deny') {
    setBusy(decision)
    setError(null)
    const supabase = createSupabaseBrowserClient()

    // skipBrowserRedirect so we handle failures ourselves instead of the client
    // navigating away mid-error.
    const { data, error: err } =
      decision === 'approve'
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          })

    if (err || !data?.redirect_url) {
      setBusy(null)
      setError(
        err?.message ??
          'That did not go through. The request may have expired — start again from the application.'
      )
      return
    }

    // Deliberately a full navigation: redirect_url points back to the OAuth
    // client, which is outside this app.
    window.location.assign(data.redirect_url)
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
          Q Wealth CRM
        </p>

        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Give {clientName} access to your CRM account?
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          It will be able to read and write client information{' '}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            as you
          </span>
          , limited to exactly what your access profile already permits. It cannot see
          anything you cannot see.
        </p>

        <dl className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-neutral-500 dark:text-neutral-400">Signing in as</dt>
            <dd className="text-right">
              <span className="font-medium">{staffName}</span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                {staffEmail} · {profileName}
              </span>
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-neutral-500 dark:text-neutral-400">Application</dt>
            <dd className="text-right font-medium">
              {clientUri ? (
                <a
                  href={clientUri}
                  className="underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {clientName}
                </a>
              ) : (
                clientName
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-neutral-500 dark:text-neutral-400">Returns you to</dt>
            <dd className="max-w-[60%] break-all text-right font-mono text-xs">
              {redirectUri}
            </dd>
          </div>
        </dl>

        {scopes.length > 0 ? (
          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              It is asking for
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {scopes.map((s) => (
                <li key={s} className="flex gap-2">
                  <span aria-hidden className="text-neutral-400">
                    •
                  </span>
                  <span>
                    {SCOPE_LABELS[s] ?? <code className="text-xs">{s}</code>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-5 rounded-md bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Tax file numbers and other sensitive identifiers are never shared through this
          connection, whatever your profile allows. Those are only ever revealed in the CRM
          itself, and every reveal is logged.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => decide('approve')}
            disabled={busy !== null}
            className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy === 'approve' ? 'Authorising…' : 'Authorise'}
          </button>
          <button
            type="button"
            onClick={() => decide('deny')}
            disabled={busy !== null}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {busy === 'deny' ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </div>
    </main>
  )
}
