import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The top bar's shape, since it was re-cut on 25 September 2026: navigation on
 * the bar's TRUE centre, and an Administration pill beside the mark that
 * appears only inside the admin area.
 *
 * What a plausible implementation gets wrong, and what each test pins:
 *
 * - **The nav is centred with spacers**, which centres it between its
 *   neighbours instead of on the bar — so the links shift sideways when the
 *   pill appears or the search grows. The grid's equal `minmax(0,1fr)` flanks
 *   are the fix, and the classes are the only place jsdom can see it.
 * - **The pill renders everywhere**, and every page in the product claims to
 *   be Administration. Or it string-matches the pathname, and some future
 *   `/administrivia` page inherits the badge — `isCurrentNavItem` is a segment
 *   test, and the trailing-slash case below is what proves it is being used.
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
  test('is three tracks with the navigation in the centre one', () => {
    const { container } = at('/')
    const bar = container.querySelector('header > div') as HTMLElement
    /* minmax(0,1fr), not 1fr: a bare 1fr track's minimum is its content, so
       the search box would shove the nav off-centre exactly when the window
       got narrow. */
    expect(bar.className).toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    expect(bar.children).toHaveLength(3)
    /* The nav IS the centre track — not inside a flank, where it would be
       centred relative to its neighbours rather than the bar. */
    expect(bar.children[1]).toBe(screen.getByRole('navigation', { name: 'Main' }))
  })

  test('keeps the mark on the left flank and the account controls on the right', () => {
    const { container } = at('/')
    const bar = container.querySelector('header > div') as HTMLElement
    expect(bar.children[0]!.querySelector('a[aria-label="Q Wealth CRM home"]')).toBeTruthy()
    expect(bar.children[2]!.querySelector('a[aria-label="Help"]')).toBeTruthy()
  })
})

describe('the Administration pill', () => {
  test('is absent everywhere that is not the admin area', () => {
    for (const path of ['/', '/groups', '/workflows', '/reports']) {
      const { unmount } = at(path)
      expect(screen.queryByText('Administration'), `no pill at ${path}`).toBeNull()
      unmount()
    }
  })

  test('appears at /admin and stays for the pages inside it', () => {
    for (const path of ['/admin', '/admin/templates/abc-123']) {
      const { unmount } = at(path)
      expect(screen.getByText('Administration'), `pill at ${path}`).toBeTruthy()
      unmount()
    }
  })

  /* The segment rule, not a prefix rule: isCurrentNavItem matches `/admin` and
     `/admin/…`, and nothing else that merely starts with the letters. */
  test('does not leak onto a route that only starts with the same letters', () => {
    at('/administrivia')
    expect(screen.queryByText('Administration')).toBeNull()
  })

  test('says where you are — it is not a link, and it sits beside the mark', () => {
    const { container } = at('/admin')
    const pill = screen.getByText('Administration')
    expect(pill.closest('a')).toBeNull()
    const bar = container.querySelector('header > div') as HTMLElement
    expect(bar.children[0]!.contains(pill), 'on the left flank, with the mark').toBe(true)
  })
})
