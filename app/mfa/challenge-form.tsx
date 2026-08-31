'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export function ChallengeForm({ next }: { next: string }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()

    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp?.find((f) => f.status === 'verified')
    if (listErr || !totp) {
      setBusy(false)
      setError('No verified authenticator found for this account.')
      return
    }

    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
      factorId: totp.id,
      code: code.trim(),
    })

    if (verifyErr) {
      setBusy(false)
      // Codes are time-based; a wrong code is usually a clock or typo issue.
      setError('That code was not accepted. Check the current code and try again.')
      return
    }

    // The session is now aal2. Refresh so server components see the new claims.
    router.replace(next)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Authentication code
        </span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-lg tracking-[0.3em] outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-visible:border-neutral-100"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || code.trim().length < 6}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  )
}
