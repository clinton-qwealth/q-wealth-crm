import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AddAction } from '@/components/add-action'
import { PRIMARY_ACTION, QUIET_ACTION } from '@/components/ui'

/**
 * Every "add a record" button on the site is the same button.
 *
 * Reported on 25 September 2026: the Templates tab's add button was grey with
 * no plus, while every other list's was orange with one. It had been written
 * out separately, as had user groups', workflow roles', and `DataSection`'s own
 * default — four copies, and the Templates one had drifted furthest. Its
 * primary variant was wrong too, hovering to `brand-700` where the others go to
 * `brand-600`, with no focus ring at all.
 *
 * ## Why a source scan and not only a render
 *
 * Rendering `AddAction` proves the button is right. It cannot prove the lists
 * USE it — which is the whole of what went wrong, since every one of those four
 * copies rendered perfectly well on its own. So the second block below reads
 * the files.
 *
 * The rule it encodes: a list that hands `DataSection` its own add affordance
 * builds it from `AddAction`. A list that passes nothing gets `DataSection`'s
 * default, which is built from the same tokens. Either is fine; a third,
 * hand-rolled button is the thing that is not.
 */
describe('the add button', () => {
  test('says what it adds, and is a button rather than a link to nowhere', () => {
    const onClick = vi.fn()
    render(<AddAction label="New template" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'New template' })
    /* The accessible name is the label ALONE — the plus is decorative and must
       not reach the name, or `getByRole('button', { name: 'New template' })`
       in the e2e suite stops matching. */
    expect(button.tagName).toBe('BUTTON')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  test('carries a plus in both variants — it is what reads as "add"', () => {
    const { container, rerender } = render(<AddAction label="New template" onClick={() => {}} />)
    expect(container.querySelector('svg'), 'primary has a plus').toBeTruthy()
    rerender(<AddAction label="New template" variant="quiet" onClick={() => {}} />)
    expect(container.querySelector('svg'), 'quiet has a plus').toBeTruthy()
  })

  /* The brand carries the meaning here: an add affordance is the one thing in
     a section a reader is looking for. Both variants are brand — one filled,
     one lettered — and neither is the neutral grey the Templates button had
     drifted to. */
  test('is brand-coloured in both variants, filled when primary and lettered when quiet', () => {
    const { container, rerender } = render(<AddAction label="New role" onClick={() => {}} />)
    expect(container.querySelector('button')!.className).toBe(PRIMARY_ACTION)
    expect(PRIMARY_ACTION, 'primary is a brand fill').toContain('bg-brand')
    expect(PRIMARY_ACTION, 'and its label reads on it').toContain('text-white')

    rerender(<AddAction label="New role" variant="quiet" onClick={() => {}} />)
    expect(container.querySelector('button')!.className).toBe(QUIET_ACTION)
    expect(QUIET_ACTION, 'quiet is brand lettering').toContain('text-brand')
    expect(QUIET_ACTION, 'on no fill of its own').not.toContain('bg-brand ')
  })

  /* Both hover to the same step. The Templates copy went to `brand-700`, which
     is a different colour arriving under the pointer on one tab out of four —
     invisible unless two are open side by side, which is how it was found. */
  test('both variants hover within the brand, and neither loses its focus ring', () => {
    for (const token of [PRIMARY_ACTION, QUIET_ACTION]) {
      expect(token).toMatch(/hover:(bg|text)-brand-\d00/)
      expect(token, 'a keyboard user can see where they are').toContain('focus-visible:ring')
    }
    expect(PRIMARY_ACTION).toContain('hover:bg-brand-600')
  })
})

/**
 * The rule, stated so it can be checked: a component that offers a QUIET add
 * trigger draws it with the shared pieces — `AddAction`, or `QUIET_ACTION`
 * and a `PlusIcon` directly.
 *
 * This is the shape the bug had. `template-list.tsx` carried a
 * `triggerVariant` and neither piece, so its quiet trigger was grey with no
 * plus; `workflow-role-list.tsx` had the right colours written out by hand and
 * still no plus. Every other trigger on the site already followed the rule,
 * which is why the Templates tab looked wrong beside them.
 *
 * ## What this does NOT check, and why
 *
 * An earlier version demanded that every file rendering a `DataSection` import
 * `AddAction`. That failed on `file-notes.tsx`, which is correct — its trigger
 * lives in `add-note-modal.tsx`, a different file — and a text scan cannot
 * follow a component across a module boundary. The rule below is on the file
 * that DRAWS the trigger, which is the file a text scan can actually see.
 *
 * It also does not police the brand fill written out by hand. A modal's own
 * submit button is legitimately that fill and a dozen of them write it out; a
 * scan that failed on those would be failing for something this is not about.
 */
describe('every quiet add trigger is drawn from the same pieces', () => {
  const dir = 'components'
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ file: f, source: readFileSync(join(dir, f), 'utf8') }))
  /* Files that DECLARE the prop, so they are the ones that draw the trigger.
     Matching `triggerVariant` loosely also caught `file-notes.tsx` and
     `workflow-workspace.tsx`, which only pass it down to a trigger somebody
     else draws — a false positive that says nothing about how it looks. */
  const triggers = sources.filter(({ source }) => source.includes('triggerVariant?:'))

  test('there are triggers to check, so the scan below is not passing on an empty list', () => {
    /* Eight at the time of writing: four add-*-modal, workflow-section, and
       the three admin lists. A guard on the guard — a scan that matched
       nothing would pass for ever. */
    expect(triggers.length).toBeGreaterThanOrEqual(8)
  })

  test('each draws it with AddAction, or with QUIET_ACTION and a plus', () => {
    const wrong = triggers
      .filter(({ source }) => {
        if (source.includes('<AddAction')) return false
        return !(source.includes('QUIET_ACTION') && source.includes('PlusIcon'))
      })
      .map(({ file }) => file)
    expect(wrong, 'these draw their own quiet add trigger').toEqual([])
  })
})
