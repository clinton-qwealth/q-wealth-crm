import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * `saveAccountDetails` and `savePolicyDetails` — the patch each one builds.
 *
 * These actions are thin by design: the database holds every rule, and what
 * happens here is turning a submitted form into a patch object where KEY
 * PRESENCE is the whole meaning. The failure worth testing is therefore not a
 * rejected value but a key that should or should not be in the patch at all —
 * a form carrying only a name must leave the owners untouched, and an owner
 * list emptied on purpose must not look identical to one that was never shown.
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

const { saveAccountDetails, savePolicyDetails } = await import('@/app/(shell)/groups/actions')
const { revalidatePath } = await import('next/cache')

function form(entries: Record<string, string>, lists: Record<string, string[]> = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  for (const [k, vs] of Object.entries(lists)) for (const v of vs) fd.append(k, v)
  return fd
}

const patch = () => calls[0].args.p_patch as Record<string, unknown>

beforeEach(() => {
  calls.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('saveAccountDetails', () => {
  test('sends only the keys the form actually carried', async () => {
    const res = await saveAccountDetails(null, form({ account_id: 'a1', label: '  Wrap  ' }))
    expect(res).toEqual({ ok: true })
    expect(calls[0].name).toBe('update_financial_account_patch')
    expect(calls[0].args.p_account_id).toBe('a1')
    expect(patch()).toEqual({ label: 'Wrap' })
  })

  test('and all three when all three are on it', async () => {
    await saveAccountDetails(
      null,
      form({ account_id: 'a1', label: 'Wrap', account_type: 'superannuation', owners_present: '1' }, {
        owner_party_ids: ['p1', 'p2'],
      }),
    )
    expect(patch()).toEqual({
      label: 'Wrap',
      account_type: 'superannuation',
      owner_party_ids: ['p1', 'p2'],
    })
  })

  /**
   * The sentinel's whole purpose. Without it, a form with no owner editor and a
   * form with every box unticked are indistinguishable — `getAll` returns `[]`
   * for both — and the second would silently do nothing.
   */
  test('leaves the owners alone when the editor was not on the form', async () => {
    await saveAccountDetails(null, form({ account_id: 'a1', label: 'Wrap' }))
    expect(patch()).not.toHaveProperty('owner_party_ids')
  })

  test('and refuses an emptied list rather than treating it as absent', async () => {
    const res = await saveAccountDetails(
      null,
      form({ account_id: 'a1', owners_present: '1' }),
    )
    expect(res).toEqual({ error: 'Choose at least one owner.' })
    expect(calls, 'nothing should reach the database').toHaveLength(0)
  })

  test('refuses a blank name before the round trip', async () => {
    const res = await saveAccountDetails(null, form({ account_id: 'a1', label: '   ' }))
    expect(res).toEqual({ error: 'Give the account a name.' })
    expect(calls).toHaveLength(0)
  })

  test('refuses a form with nothing on it', async () => {
    const res = await saveAccountDetails(null, form({ account_id: 'a1' }))
    expect(res).toEqual({ error: 'Nothing to save.' })
    expect(calls).toHaveLength(0)
  })

  test('and one with no account at all', async () => {
    const res = await saveAccountDetails(null, form({ label: 'Wrap' }))
    expect(res).toEqual({ error: 'No account selected.' })
  })

  /**
   * The database's refusals here are already sentences an adviser can act on.
   * Rewriting them would lose the one that names a party outside their access.
   */
  test('passes a database refusal through unchanged', async () => {
    failure = 'One of those owners is not someone you can add to this account'
    const res = await saveAccountDetails(null, form({ account_id: 'a1', label: 'Wrap' }))
    expect(res).toEqual({ error: failure })
  })

  /* The route pattern, not one path: a joint account belongs to two groups and
     an owner edit can move it between them. */
  test('revalidates the route pattern once', async () => {
    await saveAccountDetails(null, form({ account_id: 'a1', label: 'Wrap' }))
    expect(revalidatePath).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith('/groups/[id]', 'page')
  })

  test('and does not revalidate when it refused', async () => {
    await saveAccountDetails(null, form({ account_id: 'a1' }))
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('savePolicyDetails', () => {
  test('carries both role sets independently', async () => {
    await savePolicyDetails(
      null,
      form({ policy_id: 'pol1', owners_present: '1', lives_present: '1' }, {
        owner_party_ids: ['p1'],
        life_insured_party_ids: ['p1', 'p2'],
      }),
    )
    expect(calls[0].name).toBe('update_insurance_policy_patch')
    expect(patch()).toEqual({
      owner_party_ids: ['p1'],
      life_insured_party_ids: ['p1', 'p2'],
    })
  })

  /* A person is routinely both, which is two rows for one party. Nothing here
     should de-duplicate across the two sets. */
  test('and keeps the same person in both roles', async () => {
    await savePolicyDetails(
      null,
      form({ policy_id: 'pol1', owners_present: '1', lives_present: '1' }, {
        owner_party_ids: ['p1'],
        life_insured_party_ids: ['p1'],
      }),
    )
    expect(patch()).toEqual({ owner_party_ids: ['p1'], life_insured_party_ids: ['p1'] })
  })

  test('changes one role set without touching the other', async () => {
    await savePolicyDetails(
      null,
      form({ policy_id: 'pol1', owners_present: '1' }, { owner_party_ids: ['p2'] }),
    )
    expect(patch()).toEqual({ owner_party_ids: ['p2'] })
    expect(patch()).not.toHaveProperty('life_insured_party_ids')
  })

  test('refuses each set emptied, with its own words', async () => {
    expect(await savePolicyDetails(null, form({ policy_id: 'pol1', owners_present: '1' }))).toEqual({
      error: 'Choose at least one owner.',
    })
    expect(await savePolicyDetails(null, form({ policy_id: 'pol1', lives_present: '1' }))).toEqual({
      error: 'Name at least one life insured.',
    })
    expect(calls).toHaveLength(0)
  })

  test('refuses a blank name', async () => {
    expect(await savePolicyDetails(null, form({ policy_id: 'pol1', label: ' ' }))).toEqual({
      error: 'Give the policy a name.',
    })
  })
})
