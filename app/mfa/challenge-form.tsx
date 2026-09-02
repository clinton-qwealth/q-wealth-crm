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
        <span className="text-xs font-medium text-neutral-600">
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
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15 text-center font-mono text-lg tracking-[0.3em]"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || code.trim().length < 6}
        className="mt-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {busy ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  )
}
