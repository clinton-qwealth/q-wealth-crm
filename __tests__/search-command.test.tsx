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
      expect(screen.getByText('Search groups, people and workflows.')).toBeTruthy()
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
      expect(screen.getByText('Janet Testsmith')).toBeTruthy()
      expect(screen.getByText('Annual review')).toBeTruthy()
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
     * **The Knowledgebase is named as unbuilt rather than left out.**
     *
     * Dashed, which in this app means "planned, not built" — the same mark the
     * Tools tab's inactive tiles and the reserved column wear. Leaving it out
     * would make the list look complete and the section look decided.
     */
    test('the Knowledgebase says it is not built, rather than being absent', async () => {
      await open()
      const note = document.querySelector('[data-slot="search-knowledgebase"]')!
      expect(note.textContent).toContain('Knowledgebase')
      expect(note.textContent).toContain('not built yet')
      expect(note.className, 'a planned thing is dashed in this app').toContain('border-dashed')
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
      await user.click(screen.getByText('Annual review'))

      expect(push).toHaveBeenCalledWith('/workflows/w1')
      await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
    })

    /* A person has no page of their own, so the result goes to the group whose
       panel holds their record. */
    test('a person goes to their group', async () => {
      const user = await openWith()
      await user.click(screen.getByText('Janet Testsmith'))
      expect(push).toHaveBeenCalledWith('/groups/g1')
    })

    /**
     * A service provider has no page at all yet. The row is still shown —
     * knowing the name is on file is worth something — but it cannot be
     * followed, and a disabled control says that better than a link to a 404.
     */
    test('a service provider is shown but cannot be followed', async () => {
      const user = await openWith()
      const row = screen.getByText('Netwealth').closest('button')!
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
      /* The TITLE, not the row's text. A row's text includes its detail line,
         and the workflow's detail happens to be "Testsmith Household" — so a
         `textContent` comparison matched the workflow row while claiming to
         have found the household, and a clamp-instead-of-wrap mutation passed. */
      const activeTitle = () =>
        document.querySelector('[data-slot="search-hit"][data-active="true"] span')?.textContent

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
      /* The TITLE, not the row's text. A row's text includes its detail line,
         and the workflow's detail happens to be "Testsmith Household" — so a
         `textContent` comparison matched the workflow row while claiming to
         have found the household, and a clamp-instead-of-wrap mutation passed. */
      const activeTitle = () =>
        document.querySelector('[data-slot="search-hit"][data-active="true"] span')?.textContent

      await user.keyboard('{ArrowUp}')
      expect(activeTitle(), 'up from the first should reach the last').toContain('Annual review')

      await user.keyboard('{ArrowDown}')
      expect(activeTitle(), 'down from the last should reach the first').toContain(
        'Testsmith Household',
      )
    })
  })
})
