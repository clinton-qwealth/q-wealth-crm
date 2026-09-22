import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const { SearchCommand } = await import('@/components/search-command')

/**
 * The shortcut hint has to differ by platform, which the server cannot know.
 * It is read during render via useSyncExternalStore rather than corrected in an
 * effect, so these tests pin the value each platform actually gets.
 */
function onPlatform(userAgent: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
}

/** What the route handler would send back. */
const results = {
  households: [{ id: 'g1', title: 'Testsmith Household', detail: null, href: '/groups/g1' }],
  entities: [{ id: 'g3', title: 'Testing Entity Pty Ltd', detail: null, href: '/groups/g3' }],
  providers: [{ id: 'p9', title: 'Netwealth', detail: 'Service provider', href: '' }],
  people: [{ id: 'p1', title: 'Janet Testsmith', detail: 'Testsmith Household', href: '/groups/g1' }],
  workflows: [{ id: 'w1', title: 'Annual review', detail: 'Testsmith Household', href: '/workflows/w1' }],
}

const answerWith = (body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: async () => body,
  } as Response)

/**
 * A result row, found by its TITLE slot rather than by text.
 *
 * `getByText('Janet Testsmith')` stopped working the moment the matched run
 * was set in a `<mark>`: Testing Library matches an element's OWN text nodes,
 * and the title is now "Janet " + <mark>Test</mark> + "smith" across three of
 * them. Reading the slot's `textContent` joins them back together, which is
 * what a person sees.
 */
const hits = () => Array.from(document.querySelectorAll('[data-slot="search-hit"]')) as HTMLButtonElement[]
const titleOf = (hit: Element) => hit.querySelector('[data-slot="search-hit-title"]')?.textContent ?? ''
const hit = (title: string) => {
  const found = hits().find((h) => titleOf(h) === title)
  if (!found) throw new Error(`no result titled "${title}"`)
  return found
}
const activeHit = () => document.querySelector('[data-slot="search-hit"][data-active="true"]')!
const activeTitle = () => titleOf(activeHit())

beforeEach(() => {
  push.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('SearchCommand', () => {
  test('shows the command symbol on Apple platforms', () => {
    onPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    render(<SearchCommand />)
    expect(screen.getByText(/⌘/)).toBeDefined()
  })

  test('shows Ctrl elsewhere', () => {
    onPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    render(<SearchCommand />)
    expect(screen.getByText(/Ctrl/)).toBeDefined()
    expect(screen.queryByText(/⌘/)).toBeNull()
  })

  test('an iPad counts as Apple', () => {
    onPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')
    render(<SearchCommand />)
    expect(screen.getByText(/⌘/)).toBeDefined()
  })

  /**
   * **The thing in the bar is a button, and pressing it opens a dialog.**
   *
   * It used to be an input that searched nothing — it widened on focus, had a
   * working ⌘K, and had no query, no results and no backend. An input that
   * moves focus elsewhere the moment you type into it is a trap for anybody
   * using a screen reader, and it makes two places to hold one query.
   */
  test('the bar holds a button, not a search field', () => {
    render(<SearchCommand />)
    const trigger = screen.getByRole('button', { name: /search or ask/i })
    /* The visible words and the accessible name are the same, so somebody
       driving this by voice can say what they can see. */
    expect(trigger.textContent).toContain('Search or ask')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.querySelector('dialog'), 'the dialog is mounted before it is opened').toBeNull()
  })

  test('pressing it opens the modal, with the field ready to type in', async () => {
    const user = userEvent.setup()
    render(<SearchCommand />)
    await user.click(screen.getByRole('button', { name: /search/i }))

    const field = screen.getByLabelText('Search or ask')
    expect(field).toBeTruthy()
    expect(document.activeElement).toBe(field)
  })

  test('and the shortcut opens it too, from anywhere on the page', async () => {
    const user = userEvent.setup()
    render(<SearchCommand />)
    expect(document.querySelector('dialog')).toBeNull()

    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByLabelText('Search or ask')).toBeTruthy()
  })

  /**
   * The member panel's lesson, which this project has been caught by four
   * times: a closed `<dialog>` still has its contents in the document. Mounting
   * only while open means no stale result list behind a shut dialog.
   *
   * Driven by dispatching the dialog's own `close` event, which is what a
   * browser does when Escape is pressed on a modal — jsdom implements neither
   * the key handling nor the top layer, so `{Escape}` here would assert
   * nothing. What is being tested is the component's reaction to closing, which
   * is the half that lives in this file.
   */
  test('closing it takes the dialog out of the document entirely', async () => {
    const user = userEvent.setup()
    render(<SearchCommand />)
    await user.click(screen.getByRole('button', { name: /search/i }))
    const dialog = document.querySelector('dialog')!
    expect(dialog).not.toBeNull()

    dialog.close()
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
  })

  describe('what it shows', () => {
    const open = async () => {
      const user = userEvent.setup()
      render(<SearchCommand />)
      await user.click(screen.getByRole('button', { name: /search/i }))
      return user
    }

    /* The bar and the field say the same three words, so the empty state is
       where the areas being searched are named — on screen at exactly the
       moment somebody needs to know what this box reaches. */
    test('nothing typed names what will be searched', async () => {
      await open()
      expect(screen.getByText('Search groups, people, workflows and the firm’s policies.')).toBeTruthy()
    })

    /* One keystroke must not sweep the database, and the modal says why it is
       waiting rather than reporting nothing found. */
    test('one character waits, and asks the server nothing', async () => {
      const f = answerWith({ results })
      const user = await open()
      await user.type(screen.getByLabelText('Search or ask'), 'a')

      expect(screen.getByText(/Keep typing/)).toBeTruthy()
      expect(f, 'a single letter went to the server').not.toHaveBeenCalled()
    })

    test('a real query is sent once, and its sections are drawn in order', async () => {
      answerWith({ results })
      const user = await open()
      await user.type(screen.getByLabelText('Search or ask'), 'test')

      await waitFor(() =>
        expect(document.querySelectorAll('[data-slot="search-section"]').length).toBe(5),
      )
      expect(
        Array.from(document.querySelectorAll('[data-slot="search-section"]')).map((s) =>
          s.getAttribute('data-section'),
        ),
      ).toEqual(['households', 'entities', 'providers', 'people', 'workflows'])
      expect(hit('Janet Testsmith')).toBeTruthy()
      expect(hit('Annual review')).toBeTruthy()
    })

    test('a section with nothing in it is not drawn at all', async () => {
      answerWith({ results: { ...results, entities: [], providers: [] } })
      const user = await open()
      await user.type(screen.getByLabelText('Search or ask'), 'test')

      await waitFor(() =>
        expect(document.querySelectorAll('[data-slot="search-section"]').length).toBe(3),
      )
      expect(screen.queryByText('Entities')).toBeNull()
    })

    test('no matches says so, and quotes what was searched for', async () => {
      answerWith({
        results: { households: [], entities: [], providers: [], people: [], workflows: [] },
      })
      const user = await open()
      await user.type(screen.getByLabelText('Search or ask'), 'zzzz')

      await waitFor(() => expect(screen.getByText(/Nothing found for/)).toBeTruthy())
      expect(screen.getByText(/zzzz/)).toBeTruthy()
    })

    /**
     * **The Knowledgebase is a section like the others, since 22 Sep 2026.**
     *
     * It was a dashed placeholder — "Not built yet" — until the policies were
     * synced in. A passage opens the CRM's own reader at the heading that
     * matched, and the line under the title says which heading that was.
     */
    test('a policy passage is listed under Knowledgebase and opens the reader', async () => {
      answerWith({
        results: {
          ...results,
          knowledgebase: [
            { id: 'c1', title: 'Complaints Policy', detail: 'Timeframes', href: '/help/10092549#timeframes' },
          ],
        },
      })
      const user = await open()
      await user.type(screen.getByLabelText('Search or ask'), 'test')
      await waitFor(() =>
        expect(document.querySelector('[data-section="knowledgebase"]')).not.toBeNull(),
      )
      const section = document.querySelector('[data-section="knowledgebase"]')!
      expect(section.querySelector('h2')?.textContent).toContain('Knowledgebase')
      expect(section.textContent).toContain('Complaints Policy')
      expect(section.textContent).toContain('Timeframes')
      expect(document.querySelector('[data-slot="search-knowledgebase"]'), 'the placeholder is gone').toBeNull()
      expect(document.body.textContent).not.toContain('Not built yet')
    })
  })

  describe('choosing a result', () => {
    const openWith = async (body: unknown = { results }) => {
      answerWith(body)
      const user = userEvent.setup()
      render(<SearchCommand />)
      await user.click(screen.getByRole('button', { name: /search/i }))
      await user.type(screen.getByLabelText('Search or ask'), 'test')
      /* Waiting on the SECTIONS, not on a title: "Testsmith Household" is also
         the detail line on two other rows, so a text query matches three
         elements and throws. */
      await waitFor(() =>
        expect(document.querySelectorAll('[data-slot="search-hit"]').length).toBe(5),
      )
      return user
    }

    test('clicking one navigates and closes the modal', async () => {
      const user = await openWith()
      await user.click(hit('Annual review'))

      expect(push).toHaveBeenCalledWith('/workflows/w1')
      await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
    })

    /* A person has no page of their own, so the result goes to the group whose
       panel holds their record. */
    test('a person goes to their group', async () => {
      const user = await openWith()
      await user.click(hit('Janet Testsmith'))
      expect(push).toHaveBeenCalledWith('/groups/g1')
    })

    /**
     * A service provider has no page at all yet. The row is still shown —
     * knowing the name is on file is worth something — but it cannot be
     * followed, and a disabled control says that better than a link to a 404.
     */
    test('a service provider is shown but cannot be followed', async () => {
      const user = await openWith()
      const row = hit('Netwealth')
      expect(row.disabled, 'a provider row can be followed to nowhere').toBe(true)

      await user.click(row)
      expect(push).not.toHaveBeenCalled()
    })

    /**
     * **The arrow keys walk one list, not five.** The sections are a drawing
     * decision; the cursor crosses their boundaries as if they were not there,
     * which is what makes a grouped list usable from the keyboard at all.
     */
    test('the arrows walk across section boundaries, and Enter opens', async () => {
      const user = await openWith()

      expect(activeTitle()).toContain('Testsmith Household')

      await user.keyboard('{ArrowDown}')
      expect(activeTitle(), 'it stopped at the end of the first section').toContain(
        'Testing Entity Pty Ltd',
      )

      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(activeTitle()).toContain('Janet Testsmith')

      await user.keyboard('{Enter}')
      expect(push).toHaveBeenCalledWith('/groups/g1')
    })

    /* BOTH directions. A version that clamped instead of wrapping passed a
       test that only walked up from the first row, because going up from index
       zero and going down from the last are different expressions. */
    test('and it wraps rather than stopping at either end', async () => {
      const user = await openWith()

      await user.keyboard('{ArrowUp}')
      expect(activeTitle(), 'up from the first should reach the last').toContain('Annual review')

      await user.keyboard('{ArrowDown}')
      expect(activeTitle(), 'down from the last should reach the first').toContain(
        'Testsmith Household',
      )
    })
  })

  /**
   * How a result is drawn, reviewed on 14 September.
   *
   * A row was a title and a detail on one line with a tint on the active one.
   * It is now a record: a mark before the words, the matched run set heavier,
   * the count on each heading, an Enter hint on the row the cursor is on, and
   * the keys explained once at the foot.
   */
  describe('how a result is drawn', () => {
    const openWith = async (body: unknown = { results }) => {
      answerWith(body)
      const user = userEvent.setup()
      render(<SearchCommand />)
      await user.click(screen.getByRole('button', { name: /search or ask/i }))
      await user.type(screen.getByLabelText('Search or ask'), 'test')
      await waitFor(() => expect(hits().length).toBeGreaterThanOrEqual(5))
      return user
    }

    /**
     * **People are circles, things are squares** — the same shape rule the
     * record rows follow, so a result reads as the kind of thing it is before
     * its words are read. A person's mark is their initials; everything else
     * carries a glyph.
     */
    test('every row leads with a mark, circles for people and squares for things', async () => {
      await openWith()
      for (const h of hits()) {
        const mark = h.firstElementChild!
        expect(mark.getAttribute('aria-hidden'), `${titleOf(h)} has no mark`).toBe('true')
      }
      expect(hit('Janet Testsmith').firstElementChild!.className).toContain('rounded-full')
      expect(hit('Janet Testsmith').firstElementChild!.textContent).toBe('JT')
      for (const t of ['Testsmith Household', 'Netwealth', 'Annual review']) {
        const mark = hit(t).firstElementChild!
        expect(mark.className, `${t} is not a square`).toContain('rounded-md')
        expect(mark.querySelector('svg'), `${t} has no glyph`).not.toBeNull()
      }
    })

    /**
     * **The three kinds of square are three different drawings.** Asserted on
     * the path data, because all three share every class — a mutation that
     * gave every square the group glyph passed the test above, which only asked
     * whether a glyph was present.
     */
    test('a group, a provider and a workflow are drawn differently', async () => {
      await openWith()
      const drawing = (t: string) =>
        Array.from(hit(t).firstElementChild!.querySelectorAll('path, circle'))
          .map((el) => el.outerHTML)
          .join('|')
      const [group, provider, workflow] = [
        drawing('Testsmith Household'),
        drawing('Netwealth'),
        drawing('Annual review'),
      ]
      expect(new Set([group, provider, workflow]).size, 'two kinds share a glyph').toBe(3)
      // And the two kinds of group share one: the section says which is which.
      expect(drawing('Testing Entity Pty Ltd')).toBe(group)
    })

    /* Neutral throughout. On a record row a coloured tile encodes a kind of
       holding, and there are no holdings in a search list. */
    test('and the marks take no colour', async () => {
      await openWith()
      for (const h of hits()) {
        const cls = h.firstElementChild!.className
        expect(cls, `${titleOf(h)} wears a colour`).toContain('bg-neutral-100')
        expect(cls).not.toMatch(/bg-(emerald|gold|sky|brand|amber|red)/)
      }
    })

    /**
     * **The matched run is set heavier**, so the eye lands on why the row is
     * here. `<mark>` for its meaning, with the browser's yellow overridden.
     * Only the first occurrence: a second in one short title is noise.
     */
    test('the matched letters are marked, once, and not in yellow', async () => {
      await openWith()
      const title = hit('Testsmith Household').querySelector('[data-slot="search-hit-title"]')!
      const marks = title.querySelectorAll('mark')
      expect(marks).toHaveLength(1)
      expect(marks[0].textContent).toBe('Test')
      expect(marks[0].className).toContain('bg-transparent')
      // And the visible title is still whole.
      expect(title.textContent).toBe('Testsmith Household')
    })

    test('the match is found regardless of case, and a title with no match is left alone', async () => {
      await openWith({
        results: { ...results, workflows: [{ id: 'w2', title: 'TESTING plan', detail: null, href: '/workflows/w2' }] },
      })
      expect(hit('TESTING plan').querySelector('mark')?.textContent).toBe('TEST')
      expect(hit('Netwealth').querySelector('mark')).toBeNull()
    })

    /* A section that is full then reads as "5 of more", not "these are all". */
    test('each section heading carries its count', async () => {
      await openWith({
        results: {
          ...results,
          households: [
            ...results.households,
            { id: 'g9', title: 'Another Household', detail: null, href: '/groups/g9' },
          ],
        },
      })
      const heading = document.querySelector('[data-section="households"] h2')!
      expect(heading.textContent).toContain('Households')
      expect(heading.textContent).toContain('2')
      expect(document.querySelector('[data-section="people"] h2')!.textContent).toContain('1')
    })

    /**
     * **The Enter hint sits on the active row and nowhere else.** A list of
     * buttons has no other way to say "this one, on Enter" without labelling
     * every row; and it is withheld from a row that cannot be followed.
     */
    test('only the active row shows the Enter hint', async () => {
      const user = await openWith()
      const hint = (h: Element) => h.querySelector('kbd')
      expect(hint(activeHit())?.textContent).toBe('↵')
      expect(hits().filter((h) => hint(h)).length, 'more than one row claims Enter').toBe(1)

      await user.keyboard('{ArrowDown}')
      expect(hint(activeHit())?.textContent).toBe('↵')
      expect(hits().filter((h) => hint(h)).length).toBe(1)
    })

    test('a row that cannot be followed says so, and is never tinted as active', async () => {
      const user = await openWith()
      const provider = hit('Netwealth')
      expect(provider.textContent).toContain('No page yet')
      expect(provider.querySelector('[data-slot="search-hit-title"]')!.className).toContain('text-neutral-500')

      /* Walk the cursor onto it BY KEY: a disabled button receives no mouse
         events, so hovering it would prove nothing. It is the third row —
         households, entities, then providers. */
      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(provider.getAttribute('data-active')).toBe('true')
      expect(provider.className).not.toContain('bg-brand-50')
      expect(provider.querySelector('kbd')).toBeNull()
    })

    /* Said once at the foot, in the same `kbd` idiom as the bar's ⌘K, so the
       three read as one family rather than as help text. */
    test('the keys are explained once, at the foot', async () => {
      await openWith()
      const dialog = document.querySelector('dialog')!
      const footer = dialog.lastElementChild!
      expect(footer.textContent).toContain('to move')
      expect(footer.textContent).toContain('to open')
      expect(footer.textContent).toContain('to close')
      expect(footer.querySelectorAll('kbd').length).toBe(4)
    })
  })
})
