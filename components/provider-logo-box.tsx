'use client'

import { useRef, useState, useTransition } from 'react'
import { setProviderLogo } from '@/app/(shell)/groups/actions'
import { BuildingIcon } from '@/components/icons'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  isProviderLogoType,
  PROVIDER_LOGO_BUCKET,
  PROVIDER_LOGO_MIME_TYPES,
  PROVIDER_LOGO_SIZE_LIMIT,
  providerLogoPath,
  providerLogoUrl,
} from '@/lib/provider-logo'

/**
 * The provider's logo: the staff `PhotoBox`, worn by the register.
 *
 * Same choreography, same reasons. The bytes go up from the BROWSER with the
 * staff member's own session — the bucket refuses a wrong type or size before
 * any policy runs — and only then does the server action move the ROW, which
 * validates the path and hands back what it replaced for best-effort cleanup.
 * A failed row-move orphans the fresh bytes, so they are removed on the spot.
 *
 * The fallback is the register's own building tile, not an empty box: a
 * provider without a logo is the normal state, not a broken one.
 */
export function ProviderLogoBox({
  partyId,
  name,
  logoPath,
}: {
  partyId: string
  name: string
  logoPath: string | null
}) {
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  function upload(file: File) {
    setError(null)
    if (!isProviderLogoType(file.type)) {
      setError('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > PROVIDER_LOGO_SIZE_LIMIT) {
      setError('That image is larger than 2 MB.')
      return
    }
    const path = providerLogoPath(partyId, file.type)
    start(async () => {
      const supabase = createSupabaseBrowserClient()
      const { error: uploadError } = await supabase.storage
        .from(PROVIDER_LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) {
        setError(uploadError.message)
        return
      }
      const result = await setProviderLogo(partyId, path)
      if (result && 'error' in result) {
        /* The row was not updated, so the bytes are an orphan. Best effort. */
        await supabase.storage.from(PROVIDER_LOGO_BUCKET).remove([path])
        setError(result.error)
      }
    })
  }

  function remove() {
    setError(null)
    start(async () => {
      const result = await setProviderLogo(partyId, null)
      if (result && 'error' in result) setError(result.error)
    })
  }

  return (
    <div className="mb-4 flex items-center gap-4">
      {logoPath ? (
        /* A plain img on purpose: the src is a same-origin route that 302s to a
           short-lived signed URL, which next/image cannot optimise through. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={providerLogoUrl(partyId, logoPath)}
          alt={`${name} logo`}
          className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain p-1 ring-1 ring-neutral-200"
        />
      ) : (
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"
          aria-hidden="true"
        >
          <BuildingIcon className="h-6 w-6" />
        </span>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30">
            {busy ? 'Saving…' : logoPath ? 'Replace logo' : 'Upload logo'}
            <input
              ref={input}
              type="file"
              accept={PROVIDER_LOGO_MIME_TYPES.join(',')}
              disabled={busy}
              className="sr-only"
              aria-label={logoPath ? 'Replace logo' : 'Upload logo'}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) upload(file)
                e.target.value = ''
              }}
            />
          </label>
          {logoPath ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500/30"
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-neutral-500">PNG, JPEG or WebP, up to 2 MB.</p>
        {error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
