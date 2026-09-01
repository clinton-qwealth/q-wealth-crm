'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Enrolling = { factorId: string; qr: string; secret: string }

export function EnrolPanel({ enrolled }: { enrolled: boolean }) {
  const router = useRouter()
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()

    // A previous abandoned attempt leaves an unverified factor behind, and
    // Supabase refuses a second enrolment with the same friendly name. Clear
    // any unverified leftovers first so retrying always works.
    const { data: existing } = await supabase.auth.mfa.listFactors()
    for (const f of existing?.all ?? []) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    }

    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator',
    })
    setBusy(false)
    if (err || !data) {
      setError(err?.message ?? 'Could not start enrolment.')
      return
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (!enrolling) return
    setBusy(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()

    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code: code.trim(),
    })
    setBusy(false)
    if (err) {
      setError('That code was not accepted. Check the current code and try again.')
      return
    }
    setEnrolling(null)
    setCode('')
    router.refresh()
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.auth.mfa.listFactors()
    for (const f of data?.all ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    setBusy(false)
    router.refresh()
  }

  if (enrolling) {
    return (
      <form onSubmit={confirm} className="mt-4 flex flex-col gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Scan this with your authenticator app, then enter the code it shows.
        </p>
        <div
          className="w-fit rounded-md bg-white p-2"
          // qr_code is an SVG data URI produced by Supabase Auth.
          dangerouslySetInnerHTML={{ __html: `<img alt="" src="${enrolling.qr}" width="180" height="180" />` }}
        />
        <details className="text-xs text-neutral-500 dark:text-neutral-400">
          <summary className="cursor-pointer">Can’t scan the code?</summary>
          <p className="mt-1.5">
            Enter this key manually:{' '}
            <code className="break-all font-mono">{enrolling.secret}</code>
          </p>
        </details>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          placeholder="000000"
          className="w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono tracking-[0.3em] outline-none focus-visible:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
        />

        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || code.trim().length < 6}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEnrolling(null)
              setError(null)
            }}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium dark:border-neutral-700"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="mt-4">
      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {enrolled ? (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
        >
          {busy ? 'Removing…' : 'Remove authenticator'}
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? 'Starting…' : 'Set up authenticator'}
        </button>
      )}
    </div>
  )
}
