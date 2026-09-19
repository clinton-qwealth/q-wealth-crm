'use client'

import { useState } from 'react'
import { staffAvatarUrl } from '@/lib/avatar'

/**
 * A staff member's face, or their initials.
 *
 * With a photo on file it draws an `<img>` whose source is the app's own route
 * — never a Storage URL, which would be a signature baked into HTML — and falls
 * back to initials if the picture fails to load. Without one it draws the
 * initials `InitialsTile` has always drawn, at the size asked for.
 *
 * `alt=""` and `aria-hidden`: every place this sits, the name is printed
 * beside it, so a screen reader hearing "photo of Sarah Chen, Sarah Chen"
 * would be told twice.
 *
 * Three sizes, a closed set, because Tailwind scans source text and a class
 * assembled at runtime is never generated.
 */
const SIZE = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-8 w-8 text-[11px]',
  lg: 'h-16 w-16 text-lg',
} as const

export type AvatarSize = keyof typeof SIZE

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '·'
  )
}

export function Avatar({
  staffId,
  name,
  avatarPath,
  size = 'md',
  className = '',
}: {
  staffId: string
  name: string
  avatarPath: string | null
  size?: AvatarSize
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const box = `${SIZE[size]} shrink-0 rounded-full ring-1 ring-neutral-200/70 ${className}`

  if (avatarPath && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by our own
      // route with a per-caller redirect; next/image would try to optimise a
      // URL that answers 302.
      <img
        src={staffAvatarUrl(staffId, avatarPath)}
        alt=""
        aria-hidden="true"
        data-slot="avatar"
        onError={() => setBroken(true)}
        className={`${box} object-cover`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      data-slot="avatar-initials"
      className={`${box} flex items-center justify-center bg-neutral-100 font-semibold tracking-wide text-neutral-600`}
    >
      {initialsOf(name)}
    </span>
  )
}
