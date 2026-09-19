/**
 * A staff member's name, in two parts.
 *
 * ## Why this module exists
 *
 * `staff_users` held one `full_name` until 19 September 2026. Splitting it into
 * `first_name` and `last_name` bought two things — a directory sorted by surname,
 * and the ability to address somebody by their first name without guessing (the
 * home page used to do `full_name.split(' ')[0]`, which is exactly the guess this
 * removes).
 *
 * It also created a risk: **ten display sites each deciding independently how to
 * join two strings back together.** That is the drift the split was supposed to
 * end, not start. So the composition lives here, once, and mirrors
 * `public.staff_display_name()` in the database — the two must agree, because a
 * name composed by a view and a name composed by the browser appear side by side
 * on the same screen.
 *
 * A plain module with no `'use client'`, so both server and client components can
 * import it. The house rule after the board's `next/headers` incident: pure
 * vocabulary goes in a plain `lib/` module with no directive.
 */

export type NameParts = { first_name: string; last_name: string }

/**
 * The display name. The inverse of the database's `split_staff_name()`.
 *
 * Tolerates a blank half even though the column constraints forbid one, because
 * this also renders optimistic rows the browser built before the database saw
 * them — and a half-typed name should render as what there is, not as `undefined`.
 */
export function fullName(p: NameParts): string {
  return [p.first_name, p.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
}

/**
 * Surname first, for a directory.
 *
 * Only for display — **the database does the actual ordering**, because sorting
 * in the component would sort one page of rows rather than the set. See the
 * `.order('last_name').order('first_name')` in the readers.
 */
export function sortName(p: NameParts): string {
  const first = (p.first_name ?? '').trim()
  const last = (p.last_name ?? '').trim()
  if (!last) return first
  return first ? `${last}, ${first}` : last
}

/**
 * Two letters for an avatar tile.
 *
 * **First and last, which a single string could only guess at.** The string
 * version this replaces took the first letter of the first TWO words, so
 * "Mary-Jane van der Berg" gave MV rather than MB. With the parts in hand there
 * is nothing to infer.
 *
 * Falls back to a middle dot rather than an empty tile, matching `InitialsTile`.
 */
export function initialsOf(p: NameParts): string {
  const letters = [p.first_name, p.last_name]
    .map((s) => (s ?? '').trim()[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
  return letters || '·'
}

/**
 * The first initial and last initial of a name that only exists as one string.
 *
 * For the places a name arrives already composed and cannot be taken apart
 * reliably — a client's `display_name`, or a `*_name` column a view produced.
 * **First and LAST token**, not the first two, which is the same correction
 * `initialsOf` gets above.
 */
export function initialsOfString(name: string): string {
  const words = (name ?? '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  const first = words[0]![0]!
  const last = words.length > 1 ? words[words.length - 1]![0]! : ''
  return (first + last).toUpperCase()
}
