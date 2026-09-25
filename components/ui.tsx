import type { ReactNode } from 'react'
import { initialsOfString } from '@/lib/staff-name'
import {
  ArchiveIcon,
  BankIcon,
  BoatIcon,
  BoxIcon,
  BuildingIcon,
  CarIcon,
  CashIcon,
  CreditCardIcon,
  DocumentIcon,
  GemIcon,
  GroupIcon,
  EnvelopeIcon,
  HouseIcon,
  MeetingIcon,
  NoteIcon,
  PauseIcon,
  PhoneIcon,
  ShieldTickIcon,
  StudyIcon,
  TaskIcon,
  TrendUpIcon,
  UmbrellaIcon,
} from './icons'

/**
 * Wireframe primitives.
 *
 * Content sits over pale chart artwork, so surfaces are opaque white with a hair
 * border rather than translucent — text legibility wins over showing the texture
 * through the panel. The brand orange appears only on primary actions, focus
 * rings and small state marks; everything structural is neutral.
 */

export function PageHeading({
  eyebrow,
  title,
  description,
  meta,
  actions,
  summary,
}: {
  eyebrow?: string
  title: string
  description?: string
  /** Status marks sitting under the title. Kept separate from `description`,
   *  which renders a paragraph — pills inside a <p> would be wrong markup. */
  meta?: ReactNode
  actions?: ReactNode
  /**
   * Headline figures sharing the header row, e.g. a group's wealth summary.
   *
   * With a summary the header becomes a grid: the title takes the first five
   * of twelve columns and the summary the last seven — cards start two-fifths
   * of the way across (41.7%), which is where they were asked to start. Below
   * `lg` the summary drops under the title at full width.
   */
  summary?: ReactNode
}) {
  const heading = (
    <div>
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
          {title}
        </h1>
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
        {description ? (
          <p className="mt-1 max-w-prose text-sm text-neutral-500">{description}</p>
        ) : null}
    </div>
  )

  if (summary) {
    return (
      <div className="col-span-full grid grid-cols-1 items-center gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3 lg:col-span-5">
          {heading}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        <div className="lg:col-span-7">{summary}</div>
      </div>
    )
  }

  return (
    <div className="col-span-full flex flex-wrap items-end justify-between gap-3">
      {heading}
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/*
 * Elevation, in two steps and no more.
 *
 * A card lifts off the page ground; a sheet lifts off a well inside a card.
 * Both use the same two-layer shadow — a 1px contact edge plus a soft, offset
 * ambient — so the page reads as paper on a desk rather than as outlined
 * regions. Until 6 Sep 2026 the card shadow was 4% and the page ground was
 * white (see layout.tsx), so cards had nothing to lift off and nothing to lift
 * with; the wells inside them carried more tone than the page around them.
 *
 * SHEET is exported because DataSection and the members list must be the same
 * object: one white surface with hairline rows, the only elevated thing in its
 * well.
 */
/**
 * The two-layer elevation every sheet and card wears — a 1px contact edge plus
 * a soft offset ambient, so a surface reads as paper on a desk rather than an
 * outlined region.
 *
 * Its own token because the investment-mix chart is a **dark** sheet (10 Sep)
 * and cannot use `SHEET`, which bakes in `bg-white`. Overriding a background
 * utility with another depends on which rule Tailwind emits last, which is not
 * something to rely on; composing from the shadow instead keeps one definition
 * of the elevation and one of the surface.
 */
export const SHEET_SHADOW =
  'shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_16px_-10px_rgb(0_0_0/0.15)]'

export const SHEET_SURFACE = `rounded-lg border border-neutral-200 bg-white ${SHEET_SHADOW}`

/*
 * SHEET clips its contents so hairline rows and footer bands meet the rounded
 * corner cleanly. SHEET_SURFACE is the same surface WITHOUT the clip, for a
 * sheet that hosts a popover — the board card's priority menu opens below the
 * footer, and under SHEET it was cut off at the card's edge (seen in a
 * screenshot, invisible to jsdom). Anything that opens a menu uses SURFACE.
 */
export const SHEET = `overflow-hidden ${SHEET_SURFACE}`

/*
 * WELL is the ground a sheet sits on, inside a card. One token, used by the
 * tabs body and the members list, so the two wells on the page are the same
 * tone by construction.
 *
 * It is LIGHTER than the page ground, and only barely off white. Three tones
 * were tried on 6 Sep 2026 and the history is the reason for the value:
 *
 *   #f5f5f5  — the same as the page. The well dissolved into it; only the
 *              card's hairline edge separated them.
 *   #eaeaea  — darker than the page. Read as a continuation of the page's
 *              background image, whose chart marks sit at about that grey.
 *   #fafafa  — lighter than the page. The card reads as one clean white object
 *              lifted off the grey, with a faint inset where the records sit.
 *
 * The lesson: a well cannot be told apart from the page by being a nearby
 * grey in either direction. What separates the SHEETS is their shadow and
 * border — that is what the ledger was built to do — so the well's job is now
 * only to hint at an inset, not to carry contrast. A cool slate tint was
 * offered as the alternative (separation by hue rather than tone) and declined
 * to keep the palette in one neutral family.
 */
/**
 * The gutter every slide-out panel sits on: 32px.
 *
 * **One token because there are two panels and they must not drift.** The
 * member record panel (an individual) and the task panel (a task) are the same
 * kind of surface — a native `dialog` over the workspace, a header, a tabbed
 * body, sometimes a footer — and a reader moving between them reads the second
 * as the same thing as the first. The member panel was widened 20 → 24 → 32 on
 * 11 September, a step at a time on sight; the task panel stayed at 20 and the
 * two were a third of a gutter apart until 15 September, when this was asked
 * for as "the same padding, I want to keep it uniform".
 *
 * It could only drift because nothing held them together: four places in each
 * panel carry it — the header, each tab's body, the footer, and the tab
 * strip's own prop — and eight independent class lists is eight chances to
 * change one and miss seven.
 *
 * **The strip is the one place this token cannot reach.** `Tabs` takes its
 * gutter as a NUMBER, because Tailwind scans source text and a constructed
 * `-mx-${n}` would never be generated — so `gutter={8}` is written out at each
 * call site and the tests are what keep it in step with this.
 */
export const PANEL_GUTTER = 'px-8'

export const WELL = 'bg-neutral-50'

/**
 * The floor under the group page's working area: half the viewport.
 *
 * Asked for on 14 September at 70% and brought down to 50% the same day, on
 * sight. The centre column holds a tab strip and whatever
 * the active tab has, and some tabs have very little — a group with two assets
 * left a card barely taller than its own heading, sitting beside a file-notes
 * column three times its height. A working area that resizes to whatever
 * happens to be in it reads as an empty page rather than as a page with room.
 *
 * It also stops the height JUMPING between tabs, which is the part a reader
 * feels without being able to name: Accounts is tall, Goals is a placeholder,
 * and switching between them used to move everything below the card.
 *
 * **It belongs on the PANEL, not on the card.** A grounded panel carries the
 * grey well and cancels the card's bottom padding to reach its edge; a minimum
 * on the card would leave the well at its content height with a white band
 * below it, which looks like a rendering fault rather than like space. Putting
 * the floor on the panel makes the well itself the thing that is 50vh.
 *
 * `vh` rather than `dvh` on purpose: this is a floor, and `dvh` changes as a
 * mobile browser's address bar hides, which would reflow the page mid-scroll
 * for no benefit to a MINIMUM.
 *
 * A token rather than a number passed in, because Tailwind scans source text —
 * a constructed `min-h-[${n}vh]` would never be generated. Same rule as the
 * gutter steps in `Tabs`.
 */
export const WORKING_AREA = 'min-h-[50vh]'

/**
 * A dashed, quiet block standing where a component will go, saying what.
 *
 * Used on the group page where no group is visible, and across the workflow
 * detail page while it is being built out column by column. It says in words
 * what belongs there, so a half-built screen reads as a plan rather than as
 * something broken.
 */
export function Placeholder({ children, className = 'h-56' }: { children: string; className?: string }) {
  return (
    <div
      className={`flex ${className} items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60`}
    >
      <p className="px-4 text-center text-sm text-neutral-400">{children}</p>
    </div>
  )
}

/**
 * The two-column split a tab uses when its records sit on the left and the
 * right is reserved.
 *
 * **Exported so the two tabs that use it cannot drift.** The group page's
 * Workflows tab established it and its Accounts tab was asked for "exactly the
 * same" on 10 September — which is a correctness requirement, not a visual
 * preference, so it is one constant rather than two copies of a class string.
 * Same reasoning as `SHEET`: a shared token means the two are literally the
 * same object, and nobody has to notice when one is changed.
 *
 * 13fr / 7fr — 65 / 35 — and **proportional rather than a fixed width**, so it
 * scales with the window. It started at 11 / 9 and moved a point at a time on
 * 10 September, on sight rather than by calculation: the accounts rows are over
 * budget in a 55% column — a name, a type, the owners, a currency figure and a
 * trend badge — and 60% still was not enough. Each point is worth about 29px at
 * 1440, 25px at 1280 and 18px at 1024. Widening the constant widens BOTH tabs
 * on purpose; the two were asked to match, and a card stack takes the extra
 * room happily.
 *
 * **35% is about as narrow as the reserved half should go.** It is still a
 * legible region rather than a sliver, but a fourth point would make it one —
 * at which point the honest move is a different layout, not a thinner column. The Workflows column was first pinned to the board's
 * card width so the same card was met at the same size on both screens; once it
 * was widened at the reader's request the width no longer matched the board, and
 * a fixed width had nothing left to match. `minmax(0,…)` on both tracks because
 * a grid track's default `min-width: auto` refuses to shrink below its content,
 * which is what lets a long account label or a wide card push the layout out.
 *
 * Below `lg` it is one column and the reserved half drops beneath.
 */
/**
 * The label above a section's sheet — "Investment Accounts", "Members".
 *
 * The `mb-2.5` belongs to the row, not the label: inside a `SECTION_TOOLBAR`
 * the row carries the margin and `DataSection` strips it from here.
 */
export const SECTION_HEADING =
  'mb-2.5 truncate text-xs font-semibold uppercase tracking-wider text-neutral-500'

/**
 * A section's header row: the label on the left, the thing you add with on the
 * right, and the gap down to the sheet.
 *
 * ## This is what makes the two columns of a `TAB_SPLIT` line up
 *
 * The mix chart beside the accounts list has no heading of its own (removed
 * 10 September) and still has to start level with the records sheet, so it
 * renders this same row invisible.
 *
 * It used to render `SECTION_HEADING` instead, and that was 8px short — the
 * heading is a 16px text line, but the row's real height is set by the taller
 * thing in it, the 24px add control. Reported on 11 September as the chart
 * sitting a little high. A row is not the height of its label.
 *
 * So the spacer mirrors the row AND holds an invisible `QUIET_ACTION`, which
 * is the tallest thing a header row contains. Both sides are then one token
 * each and cannot drift: change the control's padding and both move together.
 */
export const SECTION_TOOLBAR = 'mb-2.5 flex items-center gap-3'

/**
 * The quiet add control — "+ Add account", "+ Add note".
 *
 * One string, because there were six identical copies of it: `DataSection`'s
 * own default link and five modal triggers. Its HEIGHT is now load-bearing as
 * well as its look, since a section's header row is as tall as this and the
 * mix chart's spacer is measured against it. See `SECTION_TOOLBAR`.
 */
/**
 * The primary action button: brand fill, white label, a glyph before it.
 *
 * Paired with QUIET_ACTION below — the same action at the two prominences a
 * `DataSection` gives it. Named here rather than written out per caller
 * because it HAD been written out per caller, four times, and they drifted:
 * one hovered to `brand-700` instead of `brand-600` and carried no focus ring.
 * `components/add-action.tsx` has the account of how that was found.
 */
export const PRIMARY_ACTION =
  'inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40'

export const QUIET_ACTION =
  'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30'

export const TAB_SPLIT = 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]'

/**
 * Two columns of equal weight — assets and liabilities.
 *
 * A sibling of `TAB_SPLIT` rather than a use of it: that split is 65/35 because
 * it holds a list beside a chart, and these two are the same kind of thing,
 * read against each other. Same gap and same breakpoint, so the two tabs still
 * feel like one page.
 */
export const BALANCE_SPLIT = 'grid grid-cols-1 gap-4 lg:grid-cols-2'

/**
 * The right half of a `TAB_SPLIT`, before anything has been decided for it.
 *
 * Dashed, because in this app dashed means **planned, not built** — the same
 * mark the Goals tab and the Tools and Actions tab's inactive buttons wear, and deliberately
 * NOT what a loading skeleton wears. It is meant to look like a placeholder
 * rather than an empty region, so the space can be seen and decided on instead
 * of being filled with a guess dressed up as a feature.
 *
 * `aria-hidden` and empty: there is nothing here to announce yet, and a screen
 * reader should not be told about a blank. It carries no children on purpose —
 * a `Placeholder` with a sentence in it is a different thing, for a space whose
 * eventual contents are already known.
 */
export function ReservedColumn() {
  return (
    <div
      aria-hidden
      data-slot="placeholder"
      className="min-h-[8rem] rounded-lg border border-dashed border-neutral-300/80"
    />
  )
}

export function Card({
  children,
  className = '',
  title,
  action,
  padding = 'default',
}: {
  children: ReactNode
  className?: string
  title?: string
  action?: ReactNode
  /**
   * `default` is 16px, the site's card gutter. `roomy` is 24px, for a card
   * that IS the record rather than a container of rows — the workflow detail
   * page's, where a title, controls, a bar and a boxed section sit directly on
   * the card and 16px reads as cramped. A prop rather than a className
   * override, so the choice is legible and does not depend on which of two
   * padding utilities wins in the stylesheet.
   */
  padding?: 'default' | 'roomy'
}) {
  return (
    <section
      className={`rounded-lg border border-neutral-200 bg-white ${
        padding === 'roomy' ? 'p-6' : 'p-4'
      } shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)] ${className}`}
    >
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {title}
            </h2>
          ) : null}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  change,
  title,
  bare = false,
  size = 'md',
  className = '',
}: {
  label: string
  value: string
  /** Printed beneath the value. */
  hint?: string
  /**
   * How the figure has moved, printed under it as "+0.2% over the last 30
   * days" with the percentage coloured.
   *
   * The tone is decided HERE and not by the caller, the same rule `Pill` gives
   * for its own: green up, red down, grey flat, and no way for one tile to
   * pick a different green from the next. Both colours are the ones
   * `PILL_TONES` already uses for a rising and falling value, so a headline and
   * the account rows below it do not drift into separate greens and reds.
   *
   * Pass a percentage already rounded to the precision it prints at — the tone
   * is read from this number, so an unrounded +0.04 would print "0.0%" and
   * colour it green. `wealthSummary` rounds before it returns.
   *
   * The period is fixed rather than a prop because the schema computes exactly
   * one baseline, the thirty days before an account's latest valuation. A
   * second period should arrive with its own data, not as a caption.
   */
  change?: { pct: number; text: string }
  /** NOT printed — a native tooltip on the tile. For a caveat that should be
   *  discoverable without being on the page: the wealth summary's "no
   *  liabilities recorded yet" lives here after the printed version was
   *  dropped for being noise under a headline. */
  title?: string
  /**
   * No card at all: the label and figure sit straight on whatever is behind
   * them. The wealth summary uses this in the group header.
   *
   * How it got here, 6 Sep 2026: charcoal tiles (rejected — twice in one day,
   * as chrome and as accent), then white cards with a brand rule (rejected —
   * still a row of boxes competing with the title). A headline figure does not
   * need a container; the page's cards are for records. Emphasis comes from
   * SCALE alone, which is the one thing every attempt had in common.
   */
  bare?: boolean
  /**
   * `lg` is the headline: 24px at `xl` and above, 20px below. It was 30px for
   * an afternoon and came down a step on sight — the largest type on the page
   * should be the page title, and a figure that outweighs the name of the
   * client it describes has the hierarchy backwards.
   *
   * `sm` is a supporting figure: 16px, with a smaller label. The group header
   * used it briefly for investments and assets stacked beside a `lg` Total
   * wealth; that was reversed in favour of three equals, so nothing uses `sm`
   * at the time of writing. Kept: it is the right size for a secondary figure
   * and the next one will want it.
   */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <div
      title={title}
      className={
        bare
          ? className
          : `rounded-lg border border-neutral-200 bg-white p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)] ${className}`
      }
    >
      <p
        className={`font-semibold uppercase tracking-wider text-neutral-500 ${
          size === 'sm' ? 'text-[10px]' : 'text-[11px]'
        }`}
      >
        {label}
      </p>
      <p
        className={`font-semibold tabular-nums tracking-tight text-neutral-900 ${
          size === 'lg' ? 'mt-1 text-xl xl:text-2xl' : size === 'sm' ? 'mt-0.5 text-base' : 'mt-1 text-2xl'
        }`}
      >
        {value}
      </p>
      {/* neutral-600 throughout, not 500, for the reason already recorded on
          `PILL_TONES`: on this page's ground 500 measures 4.35:1, under the
          4.5:1 floor for text this small, and 600 measures 7.17:1. These tiles
          are `bare` in the group header, so the ground is the shell's own — an
          opaque white artwork multiplied over neutral-100, which that layout
          samples at #f5f5f5 — and not a white card. */}
      {change ? (
        <p data-slot="change" className="mt-1 text-xs leading-snug text-neutral-600">
          <span
            className={`font-semibold tabular-nums ${
              change.pct > 0
                ? 'text-emerald-700'
                : change.pct < 0
                  ? 'text-red-700'
                  : 'text-neutral-600'
            }`}
          >
            {change.text}
          </span>{' '}
          over the last 30 days
        </p>
      ) : null}
      {hint ? (
        <p className="mt-1 text-xs leading-snug text-neutral-400">{hint}</p>
      ) : null}
    </div>
  )
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors disabled:opacity-50 focus-visible:ring-2'

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  className = '',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'quiet'
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-600 focus-visible:ring-brand/40',
    secondary:
      'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 focus-visible:ring-brand/30',
    quiet: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-brand/30',
  }[variant]

  return (
    <button type={type} className={`${BUTTON_BASE} ${styles} ${className}`}>
      {children}
    </button>
  )
}

export type PillTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const PILL_TONES: Record<PillTone, string> = {
  // Brand marks something as *ours* — an identity or a label, not a state.
  brand: 'bg-brand-100 text-brand-700 ring-brand-200 font-semibold',
  // Green marks a state that is live, on or granted.
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 font-semibold',
  // Amber marks a state that is paused or needs attention — not wrong, not live.
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 font-semibold',
  // Red is the mirror of success: a value moving the wrong way. Same weights, so
  // an up mark and a down mark read as one pair rather than two designs.
  danger: 'bg-red-50 text-red-700 ring-red-200 font-semibold',
  // neutral-600, not 500: 500 on the 100 ground measured 4.35:1 in a browser,
  // under the 4.5:1 floor for text this small. 600 measures 7.17:1.
  neutral: 'bg-neutral-100 text-neutral-600 ring-neutral-200 font-medium',
  /*
   * Blue marks WHERE YOU ARE — the record you are looking at, among others of
   * its kind. Added 11 September 2026 for the member panel's Memberships tab,
   * where a person's groups are listed and one of them is the group whose page
   * the panel was opened from.
   *
   * It is not a state, which is why it takes none of the state colours: that
   * membership is not healthier or worse than the others, it is the one you
   * came in through. Brand was the closest existing fit — it marks something as
   * ours, an identity rather than a state — but brand is also the action
   * colour, and a pill nobody can click should not wear it.
   *
   * Sky already carries the insurance tile, and that overlap is accepted rather
   * than missed: a tile is a 36px glyph square on a record row, this is a text
   * pill beside a group's name, and the two never stand as alternatives to one
   * another. If sky ever has to mean one thing only, this is the caller to move.
   */
  info: 'bg-sky-50 text-sky-700 ring-sky-200 font-semibold',
}

/**
 * Small state mark.
 *
 * `on` carries the meaning: a positive, live state is green, anything else is
 * neutral. Keeping that rule inside the component rather than at each call site
 * means a new status cannot quietly pick the wrong colour, and the two colours
 * stay distinguishable — green says "this is on", brand says "this is ours".
 *
 * Pass `tone` explicitly only to override, e.g. `tone="brand"` for a label like
 * an access-profile name, which is an identity rather than a state.
 */
export function Pill({
  on = false,
  tone,
  title,
  children,
}: {
  on?: boolean
  tone?: PillTone
  /** A native tooltip, for a chip that abbreviates — e.g. "Due today" carrying the date. */
  title?: string
  children: ReactNode
}) {
  const resolved = tone ?? (on ? 'success' : 'neutral')
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ring-1 ${PILL_TONES[resolved]}`}
    >
      {children}
    </span>
  )
}

/* Exported so a section total is formatted by the same rule as the rows it
   sums — a total that renders cents differently from its own list reads as a
   different kind of number. */
export const accountMoney = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

/**
 * An amount OWED, as the balance sheet prints it: a leading minus.
 *
 * Liabilities are stored positive — the column decides the sign, not the row —
 * so the sign is put back here, once, for display. A true minus (U+2212), not
 * a hyphen: it is the width of a plus and sits on the maths axis, where a
 * hyphen is short and low and reads as a dash in a name.
 *
 * This is the first half of what tells the two columns apart (decided 14
 * September, after the two read as one list): the figures on the right are
 * signed and a shade lighter, and their tiles are filled. See `BalanceItemTile`.
 */
export const owedMoney = (value: string | number | null | undefined) =>
  `\u2212${accountMoney.format(Math.abs(Number(value ?? 0)))}`

/**
 * An account's latest value with a direction mark: green up, red down.
 *
 * The comparison is against the average of the valuations in the 30 days before
 * the latest one, not against the previous day. Values arrive daily, and one
 * day's movement is noise — the average says where the account has been running.
 *
 * No mark is drawn when there is no baseline (a new account has nothing to
 * compare against) or when the value sits exactly on the average. An arrow in
 * those cases would assert a direction the data does not show.
 */
export function AccountValue({
  value,
  changeAmount,
  changePct,
  baselineValue,
  baselinePoints,
}: {
  value: string | number | null
  changeAmount?: string | number | null
  changePct?: string | number | null
  baselineValue?: string | number | null
  baselinePoints?: number | null
}) {
  if (value == null) {
    /*
     * Says so, rather than rendering nothing.
     *
     * A blank right-hand side reads as a rendering fault, not as an absence of
     * data — and now that the section total states how many accounts it leaves
     * out, the rows it means should account for themselves. Two of the five
     * real accounts are in this state, because nothing writes a valuation after
     * the opening one.
     *
     * Deliberately quiet — smaller, lighter and not tabular — because this is
     * the absence of a figure and must not be mistaken for one at a glance. The
     * row's own styling makes values large and dark, so all three are overridden
     * here.
     */
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs font-normal text-neutral-400">No value recorded</span>
        {/* The same spacer the valued rows carry, so this sits on the column's
            right edge instead of 18px adrift of every amount above it. */}
        <span className="block size-[18px] shrink-0" aria-hidden="true" />
      </span>
    )
  }

  const change = changeAmount == null ? null : Number(changeAmount)
  const up = change != null && change > 0
  const down = change != null && change < 0

  // Kept on the title rather than on the row: the arrow answers "which way" at a
  // glance, and the figures behind it are there when someone wants them.
  const detail =
    change === null || baselineValue == null
      ? undefined
      : [
          `${up ? 'Up' : down ? 'Down' : 'Level at'} ${accountMoney.format(Math.abs(change))}`,
          changePct == null ? null : `(${Math.abs(Number(changePct))}%)`,
          `against the 30-day average of ${accountMoney.format(Number(baselineValue))}`,
          baselinePoints ? `from ${baselinePoints} valuations` : null,
        ]
          .filter(Boolean)
          .join(' ')

  return (
    <span className="inline-flex items-center gap-1.5" title={detail}>
      <span className="tabular-nums">{accountMoney.format(Number(value))}</span>
      {up || down ? (
        /* Circular rather than a full pill: the contents are a single glyph, so
           the horizontal padding a pill carries for text would leave it adrift.
           Tones come straight from PILL_TONES so this stays in step with the
           status pills instead of drifting into its own greens and reds. */
        <span
          className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full ring-1 ${
            up ? PILL_TONES.success : PILL_TONES.danger
          }`}
        >
          <svg viewBox="0 0 8 8" aria-hidden="true" className="size-[7px]">
            <path
              d={up ? 'M4 0.5 L8 7.5 L0 7.5 Z' : 'M4 7.5 L0 0.5 L8 0.5 Z'}
              fill="currentColor"
            />
          </svg>
          {/* The colour carries the meaning, so it needs a text equivalent. */}
          <span className="sr-only">{up ? 'increasing' : 'decreasing'}</span>
        </span>
      ) : (
        /* Holds the badge's width open so every amount in the column shares one
           right edge, whether or not a direction can be shown. An empty circle
           would read as a state of its own; empty space reads as nothing. */
        <span className="block size-[18px] shrink-0" aria-hidden="true" />
      )}
    </span>
  )
}

/**
 * The leading tile on a record row: a glyph on a tinted square.
 *
 * This is what stops a list of money reading as a list of text. Before it,
 * every row was two lines of type and a figure, all at the same weight — the
 * eye had nowhere to land, and no amount of background shading fixed that
 * because the problem was hierarchy, not tone. A tile gives each record an
 * anchor and a spot of colour without adding a single border.
 *
 * Tones, each 50/100/700 so they sit alike: superannuation borrows the success
 * green (protected, long-horizon money); investment is GOLD, because it is
 * money — see the token in globals.css for why that is not amber. Brand orange
 * is kept out of the tiles altogether so it still means "action" on this page.
 */
const TILE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1'

/**
 * The tile a record wears when it is **no longer live** — a suspended or closed
 * account, a lapsed or cancelled policy.
 *
 * ## Grey, and NOT amber
 *
 * Amber is the obvious choice for "suspended" and it is the wrong one here.
 * The gold token exists precisely to stay clear of it: `globals.css` says a
 * gold tile must not sit beside an amber mark and read as two warnings. Gold-50
 * is `#fbf6e4` and Tailwind's amber-50 is `#fffbeb` — so a suspended
 * INVESTMENT account would change from one pale warm yellow to an almost
 * identical one, which is no signal at all, while undoing the separation that
 * token was created for. Grey has no such neighbour on this page.
 *
 * One grey for every not-live state, because the GLYPH separates them: the
 * ground says "not live", the glyph says which, and the tooltip names it. A
 * second hue would be a third encoding on a 36px square.
 *
 * The glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11) rather than the
 * 4.5:1 text needs. neutral-500 on neutral-100 is recorded above, measured in
 * a browser, at 4.35:1 — the same pair, with room to spare.
 *
 * Solid and flat, deliberately: **not dashed**, which in this app means
 * "planned, not built" (`Placeholder`, `ReservedColumn`), and **not pulsing**,
 * which means "arriving" (`PageSkeleton`). That three-way rule is written out
 * on `GhostRing` in `account-donut.tsx`.
 */
const TILE_DORMANT = 'bg-neutral-100 text-neutral-500 ring-neutral-200'

const GLYPH = 'h-[18px] w-[18px]'

/**
 * The lifecycle states a tile can show, and the word each one gets.
 *
 * Kept here rather than at the call site for the reason `Pill` gives above: a
 * status added to the database later cannot then quietly pick the wrong
 * treatment in one place and the right one in another. These maps were the
 * status pills' only readers before the pills were removed on 11 September.
 */
export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  closed: 'Closed',
}

export const POLICY_STATUS_LABEL: Record<string, string> = {
  in_force: 'In force',
  lapsed: 'Lapsed',
  cancelled: 'Cancelled',
}

/** The live state of each kind of record — everything else is dormant. */
export const ACCOUNT_LIVE = 'active'
export const POLICY_LIVE = 'in_force'

/**
 * What a dormant record shows instead of its type glyph: paused, or over.
 *
 * Anything not named here falls back to the archive, which is the safer of the
 * two to be wrong about — a state nobody has taught this map about is more
 * likely to be an ending than a pause.
 */
function dormantGlyph(status: string) {
  return status === 'suspended' || status === 'lapsed' ? (
    <PauseIcon className={GLYPH} />
  ) : (
    <ArchiveIcon className={GLYPH} />
  )
}

/**
 * A tile plus, when the record is dormant, the word for it.
 *
 * The tile is `aria-hidden`, so `title` reaches a pointer and nothing else —
 * which is why the `sr-only` sibling is not optional. The status pill this
 * replaced was the ONLY place an account's status was rendered anywhere in the
 * app, so without this the word would leave the product's readable output
 * entirely. `sr-only` is `position: absolute`, so it adds no layout weight to
 * the row's flex line.
 */
function Tile({ tone, glyph, label }: { tone: string; glyph: ReactNode; label?: string }) {
  return (
    <>
      <span className={`${TILE} ${tone}`} title={label} aria-hidden="true">
        {glyph}
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  )
}

/**
 * `status` is required, not optional: a tile that silently defaults to "live"
 * would show a closed account as an ordinary one, which is the failure this
 * whole change exists to prevent.
 */
export function AccountTypeTile({ type, status }: { type: string; status: string }) {
  const superannuation = type === 'superannuation'
  const dormant = status !== ACCOUNT_LIVE
  return (
    <Tile
      tone={
        dormant
          ? TILE_DORMANT
          : superannuation
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
            : 'bg-gold-50 text-gold-700 ring-gold-100'
      }
      /* A dormant row gives up its type glyph, and so the glance-level shortcut
         for superannuation vs investment, because the tile is saying something
         else. The row's own second line still names the type in words. */
      glyph={
        dormant ? (
          dormantGlyph(status)
        ) : superannuation ? (
          <ShieldTickIcon className={GLYPH} />
        ) : (
          <TrendUpIcon className={GLYPH} />
        )
      }
      label={dormant ? (ACCOUNT_STATUS_LABEL[status] ?? status) : undefined}
    />
  )
}

/**
 * A person's initials in a circle — the leading tile for a member row.
 *
 * A circle, where accounts get a square: people and things should not look
 * like the same kind of object. Neutral tone, because a member row has no
 * type to colour by and a wash of brand orange down the members list would
 * shout over the one pill that matters there, "Deceased".
 */
/**
 * A client group's tile: three figures on a neutral square.
 *
 * Neutral, and a SQUARE, on this page's own rule — people are circles and
 * things are squares, and a group is a thing. It takes no colour because the
 * coloured tiles all encode a kind (green super, gold investment, sky
 * insurance) and a group has no kind worth a hue; the row beside it already
 * says which group it is.
 */
export function GroupTile() {
  return (
    <span className={`${TILE} bg-neutral-100 text-neutral-500 ring-neutral-200`} aria-hidden="true">
      <GroupIcon className={GLYPH} />
    </span>
  )
}

/**
 * Initials for a name that only exists as ONE string.
 *
 * Unlike `Avatar`, this is not staff-only: the members list draws a client's
 * `display_name` with it, and a party has no first/last columns to read. So it
 * keeps splitting a string — but takes the **first and last** token rather than
 * the first two, which is the correction that came out of the staff name split
 * on 19 September 2026. "Mary-Jane van der Berg" gives MB, not MV.
 */
export function InitialsTile({ name }: { name: string }) {
  const initials = initialsOfString(name)
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-semibold tracking-wide text-neutral-600 ring-1 ring-neutral-200/70"
      aria-hidden="true"
    >
      {initials || '·'}
    </span>
  )
}

/** Insurance has no per-policy type to colour by — a policy bundles covers —
 *  so one umbrella tile gives the rows the same anchor as accounts without
 *  inventing a distinction the data does not make. Blue: cover, shelter,
 *  the one colour on the page that is neither money nor a state. */
export function PolicyTile({ status }: { status: string }) {
  const dormant = status !== POLICY_LIVE
  return (
    <Tile
      tone={dormant ? TILE_DORMANT : 'bg-sky-50 text-sky-700 ring-sky-100'}
      glyph={dormant ? dormantGlyph(status) : <UmbrellaIcon className={GLYPH} />}
      label={dormant ? (POLICY_STATUS_LABEL[status] ?? status) : undefined}
    />
  )
}

/**
 * The live state of a balance-sheet item, and the word for the other one.
 *
 * Beside `ACCOUNT_STATUS_LABEL` and `POLICY_STATUS_LABEL` rather than in
 * `lib/balance-sheet.ts`, because this is the map the TILE reads and the rule
 * `Pill` gives applies: one place decides what a status looks like.
 */
export const ITEM_STATUS_LABEL: Record<string, string> = { active: 'Active', closed: 'Closed' }

/**
 * Which glyph each of the 22 types gets.
 *
 * **The glyph is the only thing distinguishing one of these rows from another
 * at a glance**, because a tile's tone is spent on which SIDE the row is on —
 * light blue for owned, light red for owed (see `TILE_OWED`) — not on which
 * type it is. Twenty-two types could never have had twenty-two hues anyway, and the
 * two that matter at a glance are the two columns.
 *
 * A type with no entry falls back to the box, which is `other_asset`'s own
 * glyph — a type this map has not been taught about is more likely to be a new
 * kind of thing than a new kind of debt.
 */
const ITEM_GLYPH: Record<string, (p: { className?: string }) => ReactNode> = {
  principal_residence: HouseIcon,
  investment_property: HouseIcon,
  holiday_home_or_land: HouseIcon,
  commercial_property: BuildingIcon,
  cash_at_bank: CashIcon,
  term_deposit: CashIcon,
  motor_vehicle: CarIcon,
  boat_or_caravan: BoatIcon,
  home_contents: BoxIcon,
  collectibles_and_art: GemIcon,
  business_interest: BuildingIcon,
  other_asset: BoxIcon,
  home_loan: HouseIcon,
  investment_property_loan: HouseIcon,
  line_of_credit: CreditCardIcon,
  margin_loan: BankIcon,
  personal_loan: BankIcon,
  car_loan: CarIcon,
  credit_card: CreditCardIcon,
  hecs_help: StudyIcon,
  business_loan: BuildingIcon,
  other_liability: BankIcon,
}

/**
 * The two tile treatments the balance sheet uses, and the reason there are two.
 *
 * Both columns were neutral squares on 14 September and read as one list, with
 * nothing but their headings to tell them apart. **A liability took a very
 * light red** the same day, and **an asset a light blue** shortly after — the
 * same pair, and in the same order, as the proportion bar at the top of the
 * tab (see `balance-bar.tsx`), so a row and the bar summarising it are
 * speaking one language.
 *
 * Blue was free and red was not. Red is the falling half of `PILL_TONES`, and
 * a mortgage is not a warning; that is a deliberate trade — a debt is the one
 * thing on a balance sheet that subtracts, and the columns now separate at a
 * glance instead of on a heading. The signed figure beside the tile says the
 * same thing in words, so neither carries it alone. Blue collides with
 * nothing: the "this group" pill and the insurance tile are both SKY, which is
 * a different family, and no other tile on this page is blue.
 *
 * Same shape as every other coloured tile — 50 ground, 700 glyph, 100 ring —
 * so they read as this page's tiles rather than as oversized pills. The danger
 * pill keeps `ring-red-200` and a bolder weight, which is what separates it
 * from the liability tile on a page that could show both.
 *
 * blue-700 on blue-50 is 6.16:1 and red-700 on red-50 is 5.91:1 — both well
 * over the 3:1 floor a glyph needs (WCAG 1.4.11) and over the 4.5:1 text floor
 * too, and close enough to each other that neither side reads as the louder
 * one. Flat hex throughout, so those are arithmetic rather than browser
 * measurements.
 */
const TILE_OWNED = 'bg-blue-50 text-blue-700 ring-blue-100'
const TILE_OWED = 'bg-red-50 text-red-700 ring-red-100'

/**
 * An asset or a liability. Same square as an account, the type drawn on it,
 * and the SIDE carried by the tile's tone — see `TILE_OWED` above.
 *
 * `side` is taken from the row rather than looked up from the type, because
 * the database already derived it (`assets_liabilities.side` is a generated
 * column) and a second mapping here could only ever disagree with the first.
 *
 * A closed row — a house sold, a loan repaid — gives up its type glyph for the
 * archive and takes the dormant grey, exactly as a closed account does. That
 * matters more here than there: closed items are excluded from every total on
 * the page, so the row has to look like it is not being counted.
 */
export function BalanceItemTile({
  type,
  side,
  status,
}: {
  type: string
  side: string
  status: string
}) {
  const dormant = status !== 'active'
  const Glyph = ITEM_GLYPH[type] ?? BoxIcon
  return (
    <Tile
      tone={dormant ? TILE_DORMANT : side === 'liability' ? TILE_OWED : TILE_OWNED}
      glyph={dormant ? <ArchiveIcon className={GLYPH} /> : <Glyph className={GLYPH} />}
      label={dormant ? (ITEM_STATUS_LABEL[status] ?? status) : undefined}
    />
  )
}

/**
 * A note's kind as a glyph. Neutral, like a person's initials: a note records
 * something that happened, not a category of holding, and the right-hand
 * column should stay calm beside the coloured centre. The glyph carries the
 * difference between a call, a meeting and an email; the tone does not.
 */
const NOTE_GLYPH: Record<string, (p: { className?: string }) => ReactNode> = {
  file_note: DocumentIcon,
  meeting_summary: MeetingIcon,
  phone_call: PhoneIcon,
  email_record: EnvelopeIcon,
  task_note: TaskIcon,
  other: NoteIcon,
}

export function NoteTypeTile({ type }: { type: string }) {
  const Glyph = NOTE_GLYPH[type] ?? NoteIcon
  return (
    <span className={`${TILE} bg-neutral-100 text-neutral-600 ring-neutral-200/70`} aria-hidden="true">
      <Glyph className="h-[18px] w-[18px]" />
    </span>
  )
}

/**
 * The kind's glyph alone, for a pill rather than a tile.
 *
 * Exported instead of NOTE_GLYPH itself, so the map stays the one place a kind
 * is mapped to a mark and a caller cannot pick a different fallback. The file
 * notes list wears this inside its kind pill; NoteTypeTile is the same glyph
 * with a tile around it.
 */
export function NoteTypeGlyph({ type, className = 'h-3 w-3' }: { type: string; className?: string }) {
  const Glyph = NOTE_GLYPH[type] ?? NoteIcon
  return <Glyph className={className} />
}

/* Exported for the policy drawer, which prints each cover on its own line: a
   list whose figures rounded differently from the summary above it would read
   as two different quantities. */
export const coverMoney = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

/**
 * A policy's cover, as one readable figure.
 *
 * Lump sums and income streams are never added together: $750,000 of life cover
 * plus $6,500 a month is not $756,500. A policy holding both shows both, joined
 * rather than summed — which is why the database keeps the two totals in
 * separate columns rather than leaving it to each caller to remember.
 *
 * Returns null when there is nothing to show, so the caller renders no figure
 * rather than a misleading zero.
 */
export function coverSummary(
  lumpSum: string | number | null | undefined,
  monthly: string | number | null | undefined,
) {
  const parts: string[] = []
  if (lumpSum != null && Number(lumpSum) > 0) parts.push(coverMoney.format(Number(lumpSum)))
  if (monthly != null && Number(monthly) > 0) {
    parts.push(`${coverMoney.format(Number(monthly))}/mo`)
  }
  return parts.length ? parts.join(' + ') : null
}
