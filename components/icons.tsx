/**
 * Hand-rolled icons rather than an icon package. Four glyphs is not worth a
 * dependency, and inlining keeps them on the brand's stroke weight.
 */
type IconProps = { className?: string }

const base = 'h-4 w-4'

export function SearchIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m13 13 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function HelpIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8.1 7.7c0-1 .85-1.7 1.9-1.7s1.9.7 1.9 1.65c0 .8-.45 1.2-1.15 1.65-.6.4-.85.75-.85 1.35v.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="0.85" fill="currentColor" />
    </svg>
  )
}

export function UserIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="10" cy="7" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.25 16.25c.9-2.6 3.1-4 5.75-4s4.85 1.4 5.75 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PlusIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path
        d="M10 4.75v10.5M4.75 10h10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PhoneIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path
        d="M4.6 3.75h2.05l1 2.55-1.35 1.05a8.6 8.6 0 0 0 4.6 4.6l1.05-1.35 2.55 1v2.05a1.1 1.1 0 0 1-1.2 1.1A11.7 11.7 0 0 1 3.5 4.95a1.1 1.1 0 0 1 1.1-1.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CopyIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.25 3.75a1.5 1.5 0 0 0-1.5-1.5h-4A2.5 2.5 0 0 0 2.25 4.75v4a1.5 1.5 0 0 0 1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function TickIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* A message bubble, for the code that will go out by SMS. Tail on the lower
   left so it reads as outgoing rather than received. */
export function SmsIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2.25" y="3.25" width="11.5" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.75 11.25v2.25l2.75-2.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* The mirror of TickIcon — same box, same stroke weight, so a pass mark and a
   fail mark read as one pair rather than two designs. */
export function CrossIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function EyeIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M1.5 8s2.4-4.25 6.5-4.25S14.5 8 14.5 8s-2.4 4.25-6.5 4.25S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

export function EyeOffIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M3.2 4.6C2.1 5.6 1.5 8 1.5 8s2.4 4.25 6.5 4.25c1 0 1.9-.2 2.7-.6M6.1 3.95c.6-.13 1.24-.2 1.9-.2 4.1 0 6.5 4.25 6.5 4.25s-.63 1.1-1.75 2.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function PencilIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M11.4 2.35a1.2 1.2 0 0 1 1.7 0l.55.55a1.2 1.2 0 0 1 0 1.7L6.2 12.05l-3 .75.75-3 7.45-7.45Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M10.3 3.45 12.55 5.7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
