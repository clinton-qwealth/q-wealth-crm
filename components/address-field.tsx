'use client'

import { useRef, useState } from 'react'
import { isEmailAddress, splitAddresses } from '@/lib/workflow-board'
import { CrossIcon } from './icons'

/**
 * A recipient field: finished addresses become pills, and the next one is
 * typed after them.
 *
 * **Why pills rather than a comma-separated string.** A single text input makes
 * the person type the punctuation that separates the addresses, and then makes
 * them proof-read it — a missing comma silently turns two recipients into one
 * malformed one, and nothing on screen says so until the record is read back.
 * A pill is the field telling the writer what it understood, one address at a
 * time, while they can still fix it.
 *
 * **Blue, and the first blue in this app.** Everywhere else a coloured state
 * mark is brand orange or a status tone (amber warns, red refuses). A recipient
 * pill is neither: it is a piece of data the person entered, not an action they
 * can take and not a condition they should worry about. Orange would read as
 * something to click and amber as something wrong, so this borrows the
 * convention every mail client already taught its users. The same reasoning as
 * the gold in `globals.css`: a colour is chosen against what it must not be
 * confused with.
 *
 * **Fully controlled, including the text still being typed.** The parent owns
 * both the committed list and the draft, which is not ceremony — it is what
 * lets Send count an address that was typed but never finished. See the send
 * path in `email-tool.tsx`; losing what somebody typed is the one outcome this
 * field must never produce.
 */
export function AddressField({
  id,
  addresses,
  draft,
  onChange,
  onDraftChange,
  describedBy,
  placeholder,
}: {
  /** Goes on the real `<input>`, so a `<label htmlFor>` still names the field. */
  id: string
  /** The finished addresses, in the order they were added. */
  addresses: readonly string[]
  /** What is still being typed. Not yet an address, and not yet recorded. */
  draft: string
  onChange: (addresses: string[]) => void
  onDraftChange: (draft: string) => void
  /** Ids of anything already describing the field, e.g. the prefill hint. */
  describedBy?: string
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /**
   * Turn a run of text into pills, keeping whatever could not become one.
   *
   * The refused fragments go BACK into the draft rather than being dropped. A
   * field that quietly deletes a half-typed address is worse than one that
   * refuses to pill it, because the person has no way of knowing it happened.
   */
  function commit(text: string) {
    const candidates = splitAddresses(text)
    if (!candidates.length) {
      onDraftChange('')
      setProblem(null)
      return
    }

    const next = [...addresses]
    const refused: string[] = []
    let duplicate = false
    for (const candidate of candidates) {
      if (!isEmailAddress(candidate)) refused.push(candidate)
      else if (next.includes(candidate)) duplicate = true
      else next.push(candidate)
    }

    if (next.length !== addresses.length) onChange(next)
    onDraftChange(refused.join(' '))
    setProblem(
      refused.length === 1
        ? `“${refused[0]}” does not look like an email address.`
        : refused.length
          ? `${refused.length} of those do not look like email addresses.`
          : duplicate
            ? 'That address is already there.'
            : null,
    )
  }

  function remove(address: string) {
    onChange(addresses.filter((a) => a !== address))
    setProblem(null)
  }

  function keyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    /* A comma, a semicolon and a space can none of them appear inside an
       address, so each one FINISHES the address being typed rather than being
       typed into it. That is the whole point of the field: the separator
       becomes the field's business instead of the writer's. */
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') {
      e.preventDefault()
      commit(draft)
      return
    }

    /* Backspace at the start takes the last pill off — the behaviour every
       token field has, and the only way to correct the list without reaching
       for the mouse. */
    if (e.key === 'Backspace' && !draft && addresses.length) {
      e.preventDefault()
      onChange(addresses.slice(0, -1))
      setProblem(null)
      return
    }

    /* No Tab branch. Tab moves focus, focus leaving fires blur, and blur
       commits — so handling Tab here as well would be a second path to the
       same place. It was written that way first, and it MASKED the blur
       handler: deleting the blur commit entirely left every test passing,
       because Tab was quietly doing the work. One path, tested once. */
  }

  function paste(e: React.ClipboardEvent<HTMLInputElement>) {
    /* Both spellings asked for: `text/plain` is the canonical type, and `text`
       is the legacy alias the spec maps onto it — which not every DataTransfer
       implementation actually does. */
    const text = e.clipboardData.getData('text/plain') || e.clipboardData.getData('text')
    if (!text) return
    /* Always taken over, even for a single address with no separator in it, so
       there is ONE rule for what a paste does rather than two that differ by
       what happened to be on the clipboard. */
    e.preventDefault()
    commit(`${draft} ${text}`)
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        /* Clicking the box's own padding focuses the input, which is what makes
           the whole thing read as one field. On mousedown rather than click, and
           only when the box itself was hit, so a pill's remove button keeps its
           own event. */
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          inputRef.current?.focus()
        }}
        className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2 py-1.5 transition-colors focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand/15"
      >
        {addresses.map((address) => (
          <span
            key={address}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2 pr-1 text-xs font-medium text-blue-800 ring-1 ring-inset ring-blue-200"
          >
            <span className="truncate">{address}</span>
            <button
              type="button"
              aria-label={`Remove ${address}`}
              /* preventDefault on mousedown keeps focus in the input, so the
                 blur that would otherwise commit the draft never fires.
                 Without it, correcting the list mid-sentence silently turns
                 the half-typed address into a pill — verified by removing this
                 line, which empties the input. (It does NOT corrupt the list:
                 React resolves the click handler's props at dispatch, so the
                 removal still works off the committed list. The cost is the
                 writer's unfinished words, which is enough.) Click still
                 fires, so the keyboard path is untouched. */
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => remove(address)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-blue-500 outline-none transition-colors hover:bg-blue-100 hover:text-blue-800 focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <CrossIcon className="h-3 w-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          id={id}
          /* Text, not `type="email"`: the browser's own validator would judge
             a half-typed address, and this field judges addresses itself — one
             at a time, at the moment each is finished. */
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value)
            if (problem) setProblem(null)
          }}
          onKeyDown={keyDown}
          onPaste={paste}
          onBlur={() => {
            if (draft.trim()) commit(draft)
          }}
          placeholder={addresses.length ? 'Add another' : placeholder}
          aria-invalid={problem ? true : undefined}
          aria-describedby={
            [describedBy, problem ? `${id}-problem` : null].filter(Boolean).join(' ') || undefined
          }
          className="min-w-[9rem] flex-1 border-0 bg-transparent p-0 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
      </div>

      {/* Described by, not announced as an alert. A field-level message belongs
          to its field, and the modal already has the one `role="alert"` — a
          second would make "the error" ambiguous to a screen reader and to a
          test. `aria-invalid` is what marks the input itself. */}
      {problem ? (
        <p id={`${id}-problem`} className="text-[11px] text-red-600">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
