import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The top bar's shape, since it was re-cut on 25 September 2026: navigation on
 * the bar's TRUE centre, and an Administration pill beside the mark that
 * appears only inside the admin area.
 *
 * What a plausible implementation gets wrong, and what each test pins:
 *
 * - **The nav drifts back against the mark.** It is centred in the gap
 *   between the mark and the search box — deliberately NOT the bar's true
 *   centre: that was built first, and Clinton preferred the gap on looking at
 *   both, since the bar's heavy right flank made true centre read lopsided.
 *   The middle wrapper's `flex-1 justify-center` is the whole mechanism, and
 *   its classes are the only place jsdom can see it.
 * - **Every page claims to be Administration**, or a special area's pill
 *   string-matches the pathname and some future `/administrivia` page inherits
 *   it — `isCurrentNavItem` is a segment test, and the leak cases below prove
 *   it is being used. The ordinary pages say CRM, which since 25 September is
 *   the pill's DEFAULT rather than its absence: one pill, always, in one of
 *   three colourways.
 * - **The pill carries the admin route as a link.** It must not: it says where
 *   you ARE. The four nav links deliberately do not list /admin, and a
 *   clickable pill would put a protected destination into every admin page's
 *   chrome for the e2e no-dead-links sweeps to trip on.
 */
let PATHNAME = '/'
vi.mock('next/navigation', () => ({ usePathname: () => PATHNAME }))
vi.mock('next/link', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/link')>()
  return { ...mod, useLinkStatus: () => ({ pending: false }) }
})
/* The sign-out action reaches next/headers through the Supabase client; the
   menu only needs it to exist. */
vi.mock('@/app/actions', () => ({ signOut: vi.fn() }))

const { TopNav } = await import('@/components/top-nav')

const at = (pathname: string) => {
  PATHNAME = pathname
  return render(<TopNav staffFirstName="A" staffLastName="Adviser" isAdmin />)
}

beforeEach(() => {
  PATHNAME = '/'
})

describe('the bar', () => {
  test('floats the navigation on the middle of the slack, between mark and search', () => {
    const { container } = at('/')
    const bar = container.querySelector('header > div') as HTMLElement
    expect(bar.children).toHaveLength(3)
    /* The middle child owns ALL the slack and centres the nav on it. `flex-1`
       without `justify-center` parks the links back against the mark; a
       spacer-less row does the same. Both are the drift this pins against. */
    const middle = bar.children[1] as HTMLElement
    expect(middle.contains(screen.getByRole('navigation', { name: 'Main' }))).toBe(true)
    expect(middle.className).toContain('flex-1')
    expect(middle.className).toContain('justify-center')
    /* And the flanks hold their size rather than sharing it, or the nav's
       centring would wander with the window. */
    expect((bar.children[0] as HTMLElement).className).toContain('shrink-0')
    expect((bar.children[2] as HTMLElement).className).toContain('shrink-0')
  })

  test('keeps the mark on the left flank and the account controls on the right', () => {
    const { container } = at('/')
    const bar = container.querySelector('header > div') as HTMLElement
    expect(bar.children[0]!.querySelector('a[aria-label="Q Wealth CRM home"]')).toBeTruthy()
    expect(bar.children[2]!.querySelector('a[aria-label="Help"]')).toBeTruthy()
  })
})

describe('the area pill', () => {
  test('says CRM on every ordinary page — the default is a pill, not an absence', () => {
    for (const path of ['/', '/groups', '/workflows', '/reports', '/profile', '/preferences']) {
      const { unmount } = at(path)
      expect(screen.getByText('CRM'), `CRM pill at ${path}`).toBeTruthy()
      expect(screen.queryByText('Administration'), `no admin pill at ${path}`).toBeNull()
      expect(screen.queryByText('Q-Intelligence'), `no Q-Intelligence pill at ${path}`).toBeNull()
      unmount()
    }
  })

  test('appears at /admin and stays for the pages inside it', () => {
    for (const path of ['/admin', '/admin/templates/abc-123']) {
      const { unmount } = at(path)
      expect(screen.getByText('Administration'), `pill at ${path}`).toBeTruthy()
      expect(screen.queryByText('CRM'), `the default gives way at ${path}`).toBeNull()
      unmount()
    }
  })

  /* Each colourway is its own hue, and the hue is on the pill the word is on.
     A copy-paste that left Q-Intelligence wearing the brand, or CRM wearing
     sky (the insurance tiles' colour), passes every presence test above. */
  test('wears the right colour: blue CRM, purple Q-Intelligence, brand Administration', () => {
    const pill = (path: string, word: string) => {
      const { unmount } = at(path)
      const cls = screen.getByText(word).className
      unmount()
      return cls
    }
    expect(pill('/', 'CRM')).toContain('text-blue-700')
    expect(pill('/help', 'Q-Intelligence')).toContain('text-purple-700')
    expect(pill('/admin', 'Administration')).toContain('text-brand-700')
  })

  /* ONE pill, saying where you are — never both. The find-first over the area
     list is what a later overlapping prefix would silently break. */
  test('names Q-Intelligence in the help area, and only that', () => {
    for (const path of ['/help', '/help/fees-and-charging']) {
      const { unmount } = at(path)
      expect(screen.getByText('Q-Intelligence'), `pill at ${path}`).toBeTruthy()
      expect(screen.queryByText('Administration'), `not the admin pill at ${path}`).toBeNull()
      unmount()
    }
    at('/admin')
    expect(screen.queryByText('Q-Intelligence')).toBeNull()
  })

  /* The segment rule, not a prefix rule: isCurrentNavItem matches `/admin` and
     `/admin/…`, and nothing else that merely starts with the letters. */
  test('a route that only starts with an area’s letters is just the CRM', () => {
    const first = at('/administrivia')
    expect(screen.queryByText('Administration')).toBeNull()
    expect(screen.getByText('CRM')).toBeTruthy()
    first.unmount()
    const second = at('/helpdesk')
    expect(screen.queryByText('Q-Intelligence')).toBeNull()
    expect(screen.getByText('CRM')).toBeTruthy()
    second.unmount()
  })

  /**
   * The slot is what anchors the NAV, not the pill: the pill's word changes
   * width with the area, and the fixed room is what stops that reaching the
   * flank — so the centred run's anchor chain (mark → slot → slack) is
   * constant and the links hold still across pages. Mutation, and it was run:
   * drop `w-36` from the slot in `top-nav.tsx` — this fails, and the drift is
   * back on every area change.
   */
  test('sits in a fixed-width slot, so its word cannot move the nav', () => {
    for (const [path, word] of [['/', 'CRM'], ['/admin', 'Administration'], ['/help', 'Q-Intelligence']] as const) {
      const { unmount } = at(path)
      const slot = screen.getByText(word).parentElement as HTMLElement
      expect(slot.className, `a fixed slot at ${path}`).toContain('w-36')
      expect(slot.className, `that cannot be squeezed at ${path}`).toContain('shrink-0')
      unmount()
    }
  })

  test('says where you are — it is not a link, and it sits beside the mark', () => {
    const { container } = at('/admin')
    const pill = screen.getByText('Administration')
    expect(pill.closest('a')).toBeNull()
    const bar = container.querySelector('header > div') as HTMLElement
    expect(bar.children[0]!.contains(pill), 'on the left flank, with the mark').toBe(true)
  })
})
