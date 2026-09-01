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
