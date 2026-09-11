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

/** A shield with a tick: superannuation — protected, long-horizon money. */
export function ShieldTickIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5 3.5 5v4.5c0 4 2.8 6.9 6.5 8 3.7-1.1 6.5-4 6.5-8V5L10 2.5Z" />
      <path d="m7.5 10 1.8 1.8L12.8 8.3" />
    </svg>
  )
}

/** A rising line: an investment account. */
export function TrendUpIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 15.5 8 10l3 3 6-7" />
      <path d="M13 6h4v4" />
    </svg>
  )
}

/** An umbrella: an insurance policy. */
export function UmbrellaIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 10.5a7.5 7.5 0 0 1 15 0Z" />
      <path d="M10 10.5v5a1.75 1.75 0 0 0 3.5 0" />
      <path d="M10 3V2" />
    </svg>
  )
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** A page with lines: a file note. */
export function DocumentIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M5 2.5h7l3.5 3.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" />
      <path d="M12 2.5V6h3.5M7.5 10h5M7.5 13h5" />
    </svg>
  )
}

/** Two people: a meeting. */
export function MeetingIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="13.5" cy="8" r="2" />
      <path d="M2.5 16c.5-3 2.5-4.5 4.5-4.5S11 13 11.5 16M12 16c.2-2 1.2-3.2 2.5-3.5 1.6-.3 2.8.8 3 2.5" />
    </svg>
  )
}

/** An envelope: an email record. */
export function EnvelopeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3 5.5 7 5.5 7-5.5" />
    </svg>
  )
}

/* ---- The task panel's Tools tab ------------------------------------------
   Five glyphs for the actions and apps a task will offer. All on the STROKE
   convention above, so they sit at the same weight as the ledger's tiles —
   a tool tile is 64px where a ledger tile is 36px, and a glyph that thickened
   with its container would look like a different family. Email and SMS reuse
   EnvelopeIcon and SmsIcon rather than gaining near-copies. */

/** A signature over a baseline: sending a document to be signed. */
export function SignatureIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M2.75 13.5c2.25 0 2.5-7 4.75-7 1.75 0 1.25 5.5 3 5.5 1.25 0 1.5-2 2.75-2 1 0 1.5 1 3 1" />
      <path d="M2.75 16.75h14.5" />
    </svg>
  )
}

/** DocumentIcon's page, with a plus where its lines would be: make a document. */
export function DocumentPlusIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M5 2.5h7l3.5 3.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" />
      <path d="M12 2.5V6h3.5" />
      <path d="M10 9.5v5M7.5 12h5" />
    </svg>
  )
}

/** A curve from one marked point to another: a modelled path from now to then. */
export function PathwayIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M4 16c2.5-.5 4-2.5 5-5.5s2.5-5 5-5.5" />
      <circle cx="3.25" cy="16.25" r="1.35" />
      <circle cx="15.25" cy="4.75" r="1.35" />
    </svg>
  )
}

/** An hourglass: how long something lasts. */
export function HourglassIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M6 2.5h8M6 17.5h8" />
      <path d="M6.75 2.5v2.1c0 1.2 3.25 3.3 3.25 5.4s-3.25 4.2-3.25 5.4v2.1" />
      <path d="M13.25 2.5v2.1c0 1.2-3.25 3.3-3.25 5.4s3.25 4.2 3.25 5.4v2.1" />
    </svg>
  )
}

/** One node fanning out to two: a workflow. The word carries the verb
    ("Launch"), so the glyph carries the object — the same division as the
    envelope and the signature beside it. */
export function WorkflowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <circle cx="4.25" cy="10" r="1.75" />
      <circle cx="15.75" cy="5.75" r="1.75" />
      <circle cx="15.75" cy="14.25" r="1.75" />
      <path d="M6 9.25 14 6.4M6 10.75l8 2.85" />
    </svg>
  )
}

/** A star, for the STAR calculator — the name is the glyph. */
export function StarIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M10 2.6 12.29 7.24 17.4 7.99 13.7 11.6 14.57 16.69 10 14.29 5.43 16.69 6.3 11.6 2.6 7.99 7.71 7.24Z" />
    </svg>
  )
}

/** A ticked box: a task note. */
export function TaskIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="m6.5 10 2.3 2.3L13.5 7.5" />
    </svg>
  )
}

/** A pen over lines: any other kind of note. */
export function NoteIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M3.5 16.5h13M3.5 13h6" />
      <path d="m12.2 4.3 2.5 2.5-6.2 6.2H6v-2.5l6.2-6.2Z" />
    </svg>
  )
}

/* Priority glyphs, Jira-shaped: direction says the level, the double says urgent. */
export function PriorityLowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} strokeWidth={2} aria-hidden="true">
      <path d="m5 8 5 5 5-5" />
    </svg>
  )
}
export function PriorityMediumIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} strokeWidth={2} aria-hidden="true">
      <path d="M5 7.5h10M5 12.5h10" />
    </svg>
  )
}
export function PriorityHighIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} strokeWidth={2} aria-hidden="true">
      <path d="m5 12 5-5 5 5" />
    </svg>
  )
}
export function PriorityUrgentIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} strokeWidth={2} aria-hidden="true">
      <path d="m5 10 5-5 5 5M5 15l5-5 5 5" />
    </svg>
  )
}

/** A small chevron, to say that a control opens something. */
/** A due date's mark: a page-a-day calendar, one bar of binding at the top. */
export function CalendarIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronDownIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className={className}>
      <path d="M5.5 8l4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Two bars: a record that is paused — a suspended account, a lapsed policy.
 *
 * Its own icon rather than a reused one. `CrossIcon` is this app's
 * remove/close affordance (the address field's clear, the member panel's
 * dismiss, a failed check) and inside a tile would read as a control; the
 * hourglass is a workflow-template glyph, not a state.
 */
export function PauseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M7.75 4.5v11M12.25 4.5v11" />
    </svg>
  )
}

/** A lidded box: a record that is over — a closed account, a cancelled policy. */
export function ArchiveIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...STROKE} aria-hidden="true">
      <path d="M2.75 4.25h14.5v3H2.75z" />
      <path d="M4.25 7.25v8.25a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V7.25" />
      <path d="M8.25 10.5h3.5" />
    </svg>
  )
}
