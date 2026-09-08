'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { PencilIcon } from './icons'

const INPUT =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'

/** Exported so every field box's inputs are the same object, not a near-copy. */
export const FIELD_INPUT = INPUT

/**
 * Structurally the same as the server actions' own state. Kept local so this
 * module imports no server code — a client component that reached into a
 * `'use server'` file for anything but a type would pull the whole thing in.
 */
export type SaveState = { error: string } | { ok: true } | null

const noop = async (): Promise<SaveState> => null

/**
 * THE standard layout for a group of fields: a bordered box carrying its own
 * title, a pencil at the right that turns the box editable, and Cancel and Save
 * in the pencil's place while it is.
 *
 * Extracted 8 September, when the task panel became the fourth place to want
 * it. It began as an editable section in the member record panel, was rebuilt
 * by hand for the workflow detail page's field box, and a third copy would have
 * been the point at which the copies started to drift — and the half that
 * drifted would be the half nobody was testing. Two rules travel with it, and
 * both are load-bearing:
 *
 *  - **The whole box is the form**, so the header's Save submits it without
 *    reaching across the tree.
 *  - **Nothing submittable is rendered while reading.** A test asserts a box in
 *    its read state contains no input, select or textarea at all, which keeps
 *    "reading a record cannot change it" true of the DOM rather than merely of
 *    intent.
 *
 * The title sits INSIDE the border. Outside, its text sat on the container's
 * gutter while the fields sat one padding-width further in — a heading not
 * lining up with the thing it heads.
 *
 * `edit` is optional: a box with nothing editable renders no pencil rather than
 * one that opens a form with nothing in it.
 */
export function FieldBox({
  title,
  as: Heading = 'h3',
  action = noop,
  identity,
  view,
  edit,
}: {
  title: string
  /**
   * The heading level, because a box's title has to fit the outline of the
   * page it lands on: in the workflow's left card it follows the page's `h1`,
   * and in the task panel it follows the panel's own `h2`. A skipped level is
   * a real accessibility defect, not a cosmetic one.
   */
  as?: 'h2' | 'h3'
  /** The server action the box submits to. Omit for a read-only box. */
  action?: (prev: SaveState, form: FormData) => Promise<SaveState>
  /**
   * Hidden inputs naming the record — rendered only while editing, for the same
   * reason the fields are.
   */
  identity?: ReactNode
  view: ReactNode
  /** The inputs. Their `name` attributes become the patch keys. */
  edit?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [state, formAction, pending] = useActionState<SaveState, FormData>(action, null)

  /* A save closes the box back to its read-only form — the server has already
     revalidated the values behind it. Adjusted during render rather than in an
     effect, so the edit form never paints once more after a successful save.
     `handled` is the state already acted on, because useActionState hands back
     a new object on every submission. */
  const [handled, setHandled] = useState<SaveState>(null)
  if (state !== handled) {
    setHandled(state)
    if (state && 'ok' in state) setEditing(false)
  }
  const error = state && 'error' in state ? state.error : null

  return (
    <form action={formAction} className="rounded-lg border border-neutral-200 px-4 py-4">
      {editing ? identity : null}

      <div className="flex items-center justify-between gap-3">
        <Heading className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </Heading>
        {edit && editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : edit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${title.toLowerCase()}`}
            title={`Edit ${title.toLowerCase()}`}
            className="rounded-md p-1 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="mt-3.5">{edit && editing ? edit : view}</div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/**
 * One label-over-value field, for a box's read state.
 *
 * Label above value, not beside it. Side by side with the value right-aligned,
 * every field opened a gap of a different width — "Assigned to" nearly filled
 * its column while "Added" left a void — so the eye travelled a different
 * distance for each one. Stacking removes the contention.
 *
 * An absent value is an em-dash, not a blank. A blank space is ambiguous: it
 * could mean nothing was recorded, or that the field failed to render.
 */
export function Field({
  label,
  value,
  wrap = false,
  muted = false,
  span = false,
  leading,
}: {
  label: string
  /** A node, not only a string, so a field can hold a chip or a link. */
  value: ReactNode
  wrap?: boolean
  /** A real word standing in for an absent value — quieter, like the em-dash. */
  muted?: boolean
  /**
   * Take the whole row, whatever the grid's column count. `col-span-full`
   * rather than `col-span-2`: the task panel's Details box is three across and
   * the workflow's is two, and a description has to cross both.
   */
  span?: boolean
  /** A mark before the value, e.g. an initials tile for a person. */
  leading?: ReactNode
}) {
  const absent = value === null || value === undefined || value === ''
  return (
    <div className={`min-w-0 ${span ? 'col-span-full' : ''}`}>
      <dt className="text-xs leading-snug text-neutral-500">{label}</dt>
      <dd
        className={`mt-0.5 flex items-center gap-2 text-sm ${
          muted ? 'text-neutral-400' : 'text-neutral-900'
        }`}
      >
        {leading}
        <span className={`min-w-0 ${wrap ? 'whitespace-pre-wrap leading-relaxed' : 'truncate leading-snug'}`}>
          {absent ? <span className="text-neutral-400">—</span> : value}
        </span>
      </dd>
    </div>
  )
}

/**
 * A value shown in a box's EDIT state that cannot be edited — a created date,
 * a completion stamp. It renders as a value in both modes, and the absence of
 * an input is the answer to why: editing it would be falsifying the record.
 */
export function ReadonlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <span className="block text-xs text-neutral-500">{label}</span>
      <span className="mt-0.5 block text-sm text-neutral-900">
        {value === null || value === undefined || value === '' ? (
          <span className="text-neutral-400">—</span>
        ) : (
          value
        )}
      </span>
    </div>
  )
}

/** A labelled input, select or textarea inside a box's edit state. */
export function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
