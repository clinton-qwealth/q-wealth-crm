import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * `createBalanceItem` — the shares in particular.
 *
 * The database refuses anything but a total of exactly 100, twice (in the
 * function and again in a deferred trigger at COMMIT), so the job here is to
 * turn what a reader typed into a valid split or into a sentence they can act
 * on — never into a database error.
 */
const calls: { name: string; args: Record<string, unknown> }[] = []
let failure: string | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return { error: failure ? { message: failure } : null }
    },
  }),
}))

const { createBalanceItem } = await import('@/app/(shell)/groups/actions')

const form = (entries: Record<string, string>, owners: string[] = []) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  for (const o of owners) fd.append('owner_party_ids', o)
  return fd
}

const BASE = { item_type: 'principal_residence', label: ' Mercer Street ', value: '1,200,000.50' }

beforeEach(() => {
  calls.length = 0
  failure = null
})

describe('what reaches the database', () => {
  test('every field, trimmed, with blanks as null', async () => {
    const res = await createBalanceItem(
      null,
      form({ ...BASE, valued_on: '', institution_party_id: '', secured_against_id: '', notes: '' }, ['p1']),
    )
    expect(res).toEqual({ ok: true })
    expect(calls[0].name).toBe('create_asset_liability')
    expect(calls[0].args).toEqual({
      p_item_type: 'principal_residence',
      p_label: 'Mercer Street',
      /* A string, not a number: numeric(14,2) keeps full precision and a JS
         number would round-trip through binary floating point on the way. The
         commas and the dollar sign a reader types are stripped here. */
      p_value: '1200000.50',
      p_owners: [{ party_id: 'p1', share_percent: '100.00' }],
      // A `date` column refuses '' outright, so a blank date must be null.
      p_valued_on: null,
      p_institution_party_id: null,
      p_secured_against_id: null,
      p_notes: null,
    })
  })

  test('the optional links are passed through when they are chosen', async () => {
    await createBalanceItem(
      null,
      form({ ...BASE, item_type: 'home_loan', valued_on: '2026-09-01', institution_party_id: 'pr1', secured_against_id: 'b1', notes: 'Fixed to 2028' }, ['p1']),
    )
    expect(calls[0].args).toMatchObject({
      p_valued_on: '2026-09-01',
      p_institution_party_id: 'pr1',
      p_secured_against_id: 'b1',
      p_notes: 'Fixed to 2028',
    })
  })
})

describe('the shares', () => {
  const shares = () => calls[0].args.p_owners as { party_id: string; share_percent: string }[]

  /** Two names ticked and nothing typed means half each. */
  test('left blank, they split evenly', async () => {
    await createBalanceItem(null, form(BASE, ['p1', 'p2']))
    expect(shares()).toEqual([
      { party_id: 'p1', share_percent: '50.00' },
      { party_id: 'p2', share_percent: '50.00' },
    ])
  })

  /**
   * **Three owners is the case that catches a naive split.** 100/3 is 33.33
   * three times over, which totals 99.99 — and the database refuses anything
   * but 100. The cent of a percent goes to the first owner rather than being
   * rounded away, so the sum is exact by construction.
   */
  test('an even split of three still totals exactly 100', async () => {
    await createBalanceItem(null, form(BASE, ['p1', 'p2', 'p3']))
    expect(shares().map((s) => s.share_percent)).toEqual(['33.34', '33.33', '33.33'])
    expect(shares().reduce((sum, s) => sum + Number(s.share_percent), 0)).toBe(100)
  })

  test('what is typed is used, in the order the owners were ticked', async () => {
    await createBalanceItem(null, form({ ...BASE, share_p1: '60', share_p2: '40' }, ['p1', 'p2']))
    expect(shares()).toEqual([
      { party_id: 'p1', share_percent: '60' },
      { party_id: 'p2', share_percent: '40' },
    ])
  })

  /* A reader who typed 60 and left the other blank meant something, and it was
     not "and 50 for the other" — which is what an even split would silently
     produce. Nothing is sent. */
  test('a half-filled split is refused rather than evened out', async () => {
    const res = await createBalanceItem(null, form({ ...BASE, share_p1: '60' }, ['p1', 'p2']))
    expect(res).toEqual({ error: 'Give every owner a share, or leave them all blank for an even split.' })
    expect(calls).toEqual([])
  })

  test('shares that do not total 100 are refused, and the message says what they came to', async () => {
    const res = await createBalanceItem(null, form({ ...BASE, share_p1: '60', share_p2: '30' }, ['p1', 'p2']))
    expect(res).toEqual({ error: 'Shares must total 100%, not 90%.' })
    expect(calls).toEqual([])
  })

  /**
   * **A split that is exactly 100 on paper is not always exactly 100 in binary
   * floating point.** 5.00 + 63.01 + 31.99 comes to 99.99999999999999, and
   * refusing it would be refusing the reader's own arithmetic — the same class
   * of bug as holding money in a float. So the comparison is made at two
   * decimal places, which is the precision the column itself has.
   *
   * The fixture is chosen, not invented: most splits (thirds included) happen
   * to be exact, so a test built on 33.33 / 33.33 / 33.34 passes with the
   * rounding removed. This one was found by searching for a triple that is not.
   */
  test('a split that floating point cannot represent exactly is still accepted', async () => {
    expect(Number('5.00') + Number('63.01') + Number('31.99')).not.toBe(100)
    const res = await createBalanceItem(
      null,
      form({ ...BASE, share_p1: '5.00', share_p2: '63.01', share_p3: '31.99' }, ['p1', 'p2', 'p3']),
    )
    expect(res).toEqual({ ok: true })
    expect(shares()).toHaveLength(3)
  })

  test('a per cent sign a reader typed is not a syntax error', async () => {
    await createBalanceItem(null, form({ ...BASE, share_p1: '60%', share_p2: '40 %' }, ['p1', 'p2']))
    expect(shares().map((s) => s.share_percent)).toEqual(['60', '40'])
  })

  test('a share that is not a number is refused', async () => {
    const res = await createBalanceItem(null, form({ ...BASE, share_p1: 'half' }, ['p1']))
    expect(res).toMatchObject({ error: expect.stringMatching(/percentage/) })
    expect(calls).toEqual([])
  })
})

describe('what is refused before the database is troubled', () => {
  const cases: [string, FormData, RegExp][] = [
    ['no owners', form(BASE), /at least one owner/i],
    ['no name', form({ ...BASE, label: '   ' }, ['p1']), /give it a name/i],
    ['no type', form({ ...BASE, item_type: '' }, ['p1']), /choose a type/i],
    ['no value', form({ ...BASE, value: '' }, ['p1']), /amount/i],
    ['a value that is not an amount', form({ ...BASE, value: 'about 900k' }, ['p1']), /amount/i],
    ['too many decimal places', form({ ...BASE, value: '100.005' }, ['p1']), /two decimal places/i],
    /* Positive on both sides: a liability's value is what is owed, and the side
       decides the sign once, where the totals are worked out. A negative here
       would be a sign error entered by hand. */
    ['a negative value', form({ ...BASE, value: '-100' }, ['p1']), /amount/i],
  ]

  for (const [name, fd, message] of cases) {
    test(name, async () => {
      const res = await createBalanceItem(null, fd)
      expect(res).toMatchObject({ error: expect.stringMatching(message) })
      expect(calls, 'the database was called anyway').toEqual([])
    })
  }

  /** A database refusal reaches the reader as the database worded it — RLS and
   *  the deferred triggers all speak through this one path. */
  test('and an error from the database is passed back, not swallowed', async () => {
    failure = 'new row violates row-level security policy'
    const res = await createBalanceItem(null, form(BASE, ['p1']))
    expect(res).toEqual({ error: 'new row violates row-level security policy' })
  })
})
