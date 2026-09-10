import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getCurrentStaff()` — the "who is this, and are they staff" check every page
 * makes.
 *
 * No direct test existed: three files mock the whole module, and the round-trip
 * harness deliberately mocks it out because React `cache()` would double-count.
 * So the auth pair was the one part of every page load nothing measured. Since
 * 10 September the pair is one round trip — `getClaims()` is local — and the
 * depth case at the end is the first test to say so.
 *
 * React's `cache()` is a pass-through outside a server render, so each call
 * here runs fresh; that is what lets the cases stand alone.
 */
type Claims = { data: { claims: { sub: string; aal: string } } | null; error: { message: string } | null }

const queries: string[] = []
let CLAIMS: Claims = { data: null, error: null }
let ROW: Record<string, unknown> | null = null
let ROW_ERROR: { message: string } | null = null
const eqCalls: [string, string][] = []

const getClaims = vi.fn(async () => CLAIMS)
/* A DIFFERENT id from the claims, on purpose: a revert to getUser() would then
   query the wrong user and fail the `eq` assertion, rather than merely throw. */
const getUser = vi.fn(async () => ({ data: { user: { id: 'someone-else' } }, error: null }))

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims, getUser },
    from: () => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          eqCalls.push([column, value])
          return chain
        },
        /* Resolves immediately: nothing here is timed. What "one round trip"
           means for this function is "one query", and that is counted rather
           than clocked — see the last test. */
        maybeSingle: async () => {
          queries.push('staff_users')
          return { data: ROW, error: ROW_ERROR }
        },
      }
      return chain
    },
  }),
}))

const { getCurrentStaff } = await import('@/lib/staff')

const PROFILE = {
  name: 'Adviser',
  view_all_groups: false,
  view_sensitive: false,
  manage_groups: false,
  manage_staff: false,
  file_unmatched_notes: false,
}
const signedIn: Claims = { data: { claims: { sub: 'user-1', aal: 'aal2' } }, error: null }
const row = (o: Record<string, unknown> = {}) => ({
  id: 's1',
  full_name: 'A Adviser',
  email: 'a@example.com',
  status: 'active',
  staff_access_assignments: { access_profiles: PROFILE },
  ...o,
})

beforeEach(() => {
  CLAIMS = { data: null, error: null }
  ROW = null
  ROW_ERROR = null
  eqCalls.length = 0
  queries.length = 0
  getClaims.mockClear()
  getUser.mockClear()
})

describe('getCurrentStaff', () => {
  /** The no-session shape: null data, no error. The gate is on `sub`. */
  test('with no session it is null, and the staff table is never asked', async () => {
    CLAIMS = { data: null, error: null }
    await expect(getCurrentStaff()).resolves.toBeNull()
    expect(eqCalls).toEqual([])
  })

  test('looks the staff row up by the token’s own subject, never by asking GoTrue', async () => {
    CLAIMS = signedIn
    ROW = row()
    const staff = await getCurrentStaff()

    expect(eqCalls).toEqual([['auth_user_id', 'user-1']])
    expect(getUser).not.toHaveBeenCalled()
    expect(staff).toEqual({
      id: 's1',
      full_name: 'A Adviser',
      email: 'a@example.com',
      status: 'active',
      access_profiles: PROFILE,
    })
  })

  test('the assignment embed is tolerated as an array as well as an object', async () => {
    CLAIMS = signedIn
    ROW = row({ staff_access_assignments: [{ access_profiles: PROFILE }] })
    await expect(getCurrentStaff()).resolves.toMatchObject({ access_profiles: PROFILE })
  })

  /**
   * The instant lock-out this change leans on. GoTrue is no longer asked
   * whether a session is revoked, so the staff row's status is what removes
   * somebody now — and it is re-read on every request.
   */
  test('an inactive staff row is null, whatever the token says', async () => {
    CLAIMS = signedIn
    ROW = row({ status: 'inactive' })
    await expect(getCurrentStaff()).resolves.toBeNull()
  })

  test('a signed-in account with no staff row or no profile is null', async () => {
    CLAIMS = signedIn
    ROW = null
    await expect(getCurrentStaff()).resolves.toBeNull()
    ROW = row({ staff_access_assignments: null })
    await expect(getCurrentStaff()).resolves.toBeNull()
  })

  test('a query error is null rather than a throw here, since the caller redirects', async () => {
    CLAIMS = signedIn
    ROW_ERROR = { message: 'permission denied' }
    await expect(getCurrentStaff()).resolves.toBeNull()
  })

  /**
   * The point of the change: ONE round trip, the `staff_users` select.
   *
   * **Counted, not timed.** An earlier version measured elapsed time against a
   * fixed 25ms sleep, which is the same construction that put CI red on
   * 10 September when the group page's depth test read 3 instead of 2 on
   * unchanged code. There is nothing to time here anyway: `getClaims()` is
   * local, so the query count IS the round-trip count, and the two assertions
   * that a revert to `getUser()` would break are the ones above — GoTrue is
   * never called, and the row is looked up by the token's own subject.
   */
  test('issues exactly one query, so the auth step costs no round trip of its own', async () => {
    CLAIMS = signedIn
    ROW = row()
    await getCurrentStaff()
    expect(queries).toEqual(['staff_users'])
  })

  test('and issues none at all when there is no session', async () => {
    CLAIMS = { data: null, error: null }
    await getCurrentStaff()
    expect(queries).toEqual([])
  })
})
