/**
 * A set of checkboxes with the sentinel that gives an EMPTIED set a meaning.
 *
 * `formData.getAll(field)` is `[]` both when the control was never on the form
 * and when it was there with every box unticked. Under patch semantics those
 * are "leave it alone" and "remove every one" — so the hidden `sentinel` input
 * travels first, and its presence is what says the set was submitted. The
 * action reads it with `readSet(formData, field, sentinel)`.
 *
 * Extracted 20 Sep 2026 from the policy drawer's `PartyPicker`, when the user
 * drawer became the third place to want it. The third copy is where drift
 * starts — see `drawer.tsx`.
 */
export function CheckboxSet({
  legend,
  field,
  sentinel,
  options,
  chosen,
  emptyText,
}: {
  legend: string
  /** The checkboxes' `name`, which becomes the patch key. */
  field: string
  /** The hidden input's `name`. Its presence means "this set was on the form". */
  sentinel: string
  options: { id: string; name: string }[]
  /** The ids ticked to begin with. */
  chosen: string[]
  /** Shown instead of boxes when there is nothing to offer. The sentinel still travels. */
  emptyText: string
}) {
  return (
    <fieldset>
      <input type="hidden" name={sentinel} value="1" />
      <legend className="mb-1 text-xs text-neutral-500">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-neutral-500">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          {options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-white"
            >
              <input
                type="checkbox"
                name={field}
                value={o.id}
                defaultChecked={chosen.includes(o.id)}
                className="h-3.5 w-3.5 accent-[var(--brand-500)]"
              />
              {o.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
