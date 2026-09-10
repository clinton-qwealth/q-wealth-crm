import type { NoteHeader } from '@/lib/notes'
import { NoteRecord } from './file-notes'
import { SHEET } from './ui'

/**
 * The file notes filed under one workflow — the File Notes tab in the workflow
 * detail page's right column.
 *
 * **The row is the group page's row, imported rather than rebuilt.** `NoteRecord`
 * is the same component: kind as a pill with its glyph, the date opposite it,
 * the title, the author, and a disclosure onto the note's first 255 characters.
 * A second hand-built copy is where copies start to drift, and the half that
 * drifted would be the half nobody was testing — the same argument that made
 * `FieldBox` and `rich-text.tsx` shared.
 *
 * **What is NOT shared is the shell**, and that is deliberate. The group page
 * wraps its list in `DataSection`, which is built around a section that you add
 * records to: it owns a title and an add action. Neither belongs here — the tab
 * is already the title, and there is no way to write a note from this screen —
 * so this is a thinner shell around the same rows.
 *
 * **No workflow pill on the row.** On the group's page that pill is the fact
 * that tells one note from another. Here every note is filed under this
 * workflow by definition, so it would read the same on every row: precisely the
 * one-value pill the task list removed on 9 September. `NoteRecord`'s action is
 * a slot, so this screen simply passes nothing.
 */
export function WorkflowNotes({ notes }: { notes: NoteHeader[] }) {
  if (!notes.length) {
    return (
      /* Dashed, the house treatment for a screen that is empty rather than
         broken — and it says HOW a note gets here, because there is no way to
         file one from this screen. Without that sentence an adviser looking at
         an empty column has no idea whether the feature is missing or the notes
         are. */
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center">
        <p className="text-sm font-medium text-neutral-700">No file notes filed here yet</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
          A note is filed under a workflow from the group’s own file notes list — open the
          group and choose <span className="font-medium text-neutral-600">Add to workflow</span>.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-end">
        <p className="text-xs text-neutral-500">
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* The ledger's sheet, so this column reads as the same kind of thing as
          the accounts, insurance and group file-note lists rather than as a
          different design that happens to sit in a tab. */}
      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {notes.map((n) => (
            <NoteRecord key={n.note_id} note={n} />
          ))}
        </ul>
      </div>
    </div>
  )
}
