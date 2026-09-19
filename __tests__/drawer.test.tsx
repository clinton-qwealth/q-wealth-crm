import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@/components/drawer'

/**
 * The shared record drawer.
 *
 * Two of these were hand-rolled before this component existed, and
 * `field-box.tsx` had already written down what happens next: a third copy is
 * where copies start to drift, "and the half that drifted would be the half
 * nobody was testing." This file is the other half of that bargain — the shape
 * is in one place, so it can be tested as a component rather than scanned for
 * as a string across N files.
 *
 * jsdom stubs `showModal`/`close` by toggling the `open` attribute and firing
 * the event. What it deliberately does not reproduce is modality: the top
 * layer, the inert background and the real focus trap. Those are the browser's
 * and are checked in the end-to-end spec, not here.
 */

afterEach(() => vi.restoreAllMocks())

function Harness({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <Drawer open={open} onClose={() => setOpen(false)} labelledBy="t">
      <DrawerHeader id="t" title="Netwealth Wrap" eyebrow="Smith Household" onClose={() => setOpen(false)} />
      <p>the body</p>
    </Drawer>
  )
}

describe('Drawer', () => {
  /**
   * The line that stops a list of twenty accounts putting twenty full records
   * in the document. A closed `<dialog>` keeps its children, so this has to be
   * a render-time decision rather than a CSS one.
   */
  test('holds nothing while it is closed', () => {
    const { container } = render(<Harness startOpen={false} />)
    const dialog = container.querySelector('dialog')!
    expect(dialog).toBeTruthy()
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(dialog.textContent).toBe('')
  })

  test('and opens onto its content', () => {
    const { container } = render(<Harness />)
    const dialog = container.querySelector('dialog')!
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(screen.getByText('the body')).toBeTruthy()
  })

  /**
   * Escape and a backdrop click both close the element without telling React.
   * An owner that only cleared its state in its own button handler would keep
   * the old id, and the next open would flash the previous record.
   */
  test('reports a close that React did not initiate', () => {
    const { container } = render(<Harness />)
    const dialog = container.querySelector('dialog') as HTMLDialogElement
    // Not fireEvent: this is the browser closing the element of its own accord,
    // which is what Escape does. act() is only here to flush the state update
    // the listener triggers.
    act(() => dialog.close())
    expect(dialog.textContent).toBe('')
  })

  /* A `contains()` check here would close the drawer on every click inside it. */
  test('closes on a backdrop click and not on a click inside', () => {
    const { container } = render(<Harness />)
    const dialog = container.querySelector('dialog') as HTMLDialogElement

    fireEvent.click(screen.getByText('the body'))
    expect(dialog.hasAttribute('open')).toBe(true)

    fireEvent.click(dialog)
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  test('and on its own close button', () => {
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(container.querySelector('dialog')!.hasAttribute('open')).toBe(false)
  })

  /**
   * `showModal()` on an already-open dialog throws InvalidStateError in a real
   * browser. jsdom's stub raises nothing, so without this assertion the guard
   * could be deleted and only production would find out.
   */
  test('opens the element once, however often the owner re-renders', () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const { rerender } = render(<Harness />)
    rerender(<Harness />)
    rerender(<Harness />)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('carries the drawer class and exactly one of its two widths', () => {
    const { container } = render(<Harness />)
    const cls = container.querySelector('dialog')!.className
    expect(cls).toContain('qw-drawer')
    const widths = ['sm:w-[34rem]', 'sm:w-lg'].filter((w) => cls.includes(w))
    expect(widths, 'a drawer must take one width, not none and not both').toHaveLength(1)
  })
})

describe('DrawerHeader', () => {
  /**
   * Neither hand-rolled drawer manages this, so a screen reader lands on
   * "Close panel" with no idea what opened. Assertable precisely because
   * jsdom's `showModal` stub moves no focus — only an explicit call can satisfy
   * it.
   */
  test('moves focus to the record name, so what opened is what is announced', () => {
    render(<Harness />)
    const heading = screen.getByRole('heading', { name: 'Netwealth Wrap' })
    expect(document.activeElement).toBe(heading)
  })

  test('and the heading is focusable by the app but not by Tab', () => {
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'Netwealth Wrap' }).getAttribute('tabindex')).toBe(
      '-1',
    )
  })

  test('names the dialog after that heading', () => {
    const { container } = render(<Harness />)
    const id = container.querySelector('dialog')!.getAttribute('aria-labelledby')
    expect(screen.getByRole('heading', { name: 'Netwealth Wrap' }).id).toBe(id)
  })

  /* The drawer covers the page, so the one context worth repeating is the one
     you cannot see while reading. */
  test('says where the record is, above what it is', () => {
    render(<Harness />)
    expect(screen.getByText('Smith Household')).toBeTruthy()
  })
})

/**
 * The census, which is the whole return on extracting this component.
 *
 * `modal-centring.test.ts` has to scan every file for `qw-modal` and check the
 * copies still agree, because modals are hand-rolled nine times over. Drawers
 * are not, any more — so the assertion is not "the copies agree" but "there is
 * only one", which is the stronger statement and the one that catches a fourth
 * drawer on the day somebody writes it.
 */
/**
 * The footer, added 19 September for the account drawer's Delete button. The
 * contract is small and load-bearing: it is the column's LAST child and it does
 * not shrink, so it sits beneath whichever scrolling part precedes it — a body
 * or a `fill` Tabs strip — and takes exactly its own height.
 */
describe('DrawerFooter', () => {
  test('pins beneath the body as the column’s last, unshrinking child', () => {
    const { container } = render(
      <Drawer open onClose={() => {}} labelledBy="f">
        <DrawerHeader id="f" title="Netwealth Wrap" onClose={() => {}} />
        <DrawerBody>
          <p>the body</p>
        </DrawerBody>
        <DrawerFooter>
          <button type="button">Delete account</button>
        </DrawerFooter>
      </Drawer>,
    )
    const column = container.querySelector('dialog')!.firstElementChild!
    const footer = column.lastElementChild!
    expect(footer.getAttribute('data-slot')).toBe('drawer-footer')
    expect(footer.className).toContain('shrink-0')
    expect(footer.className).toContain('border-t')
    expect(footer.textContent).toBe('Delete account')
    /* And the body before it is the part that grows. */
    expect(footer.previousElementSibling!.className).toContain('flex-1')
  })
})

describe('the drawer shape', () => {
  const dir = resolve(__dirname, '../components')
  const holders = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => readFileSync(resolve(dir, f), 'utf8').includes('qw-drawer'))

  test('lives in exactly one file', () => {
    expect(holders.length, 'a drawer was hand-rolled again').toBe(1)
    expect(holders[0]).toBe('drawer.tsx')
  })
})
