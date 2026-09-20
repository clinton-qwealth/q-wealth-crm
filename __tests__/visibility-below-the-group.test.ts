import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * "Ideally i want no visibility from the group down. This includes MCP."
 *
 * The migration that made that true, read from its text. Three things it fixes,
 * and each one is pinned with the mutation that would put it back:
 *
 *  - `staff_can_access_party` short-circuited on `view_all_groups`, which is why
 *    a limited person could still reach an assigned household's people — and
 *    through them every account, policy, item and note, since all of those
 *    derive from the party.
 *  - The creator escapes were unbounded, in the helpers AND, separately, inlined
 *    in four SELECT policies. Narrowing only the helpers changed nothing for
 *    reads; the probe on the branch is what caught it.
 *  - The sensitive-field functions never checked access at all — a PRE-EXISTING
 *    hole, wider than territories: `view_sensitive` plus a second factor let
 *    anybody decrypt or overwrite a tax file number for any party by id.
 *
 * The MCP needs no change of its own: it reads through the same row-level
 * security with the caller's token, so the database is the fix for all three
 * clients at once.
 */
const sql = migrationSource('nothing_under_a_household_outlives_its_group')
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, `${name} is rewritten`).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('$fn$;', start))
}
const policy = (name: string) => {
  const start = sql.indexOf(`create policy ${name} on`)
  expect(start, `${name} is rewritten`).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf(');', start))
}

describe('a person is reached only through their households', () => {
  /* The one line that was the whole leak. */
  test('the party helper no longer short-circuits on view_all_groups', () => {
    expect(fn('staff_can_access_party')).not.toContain('view_all_groups')
  })

  test('it defers to the household instead, which is where the territory rule lives', () => {
    expect(fn('staff_can_access_party')).toMatch(/and public\.staff_can_access_group\(m\.group_id\)/)
  })

  /* Deliberate carry-over, not an oversight: a prospect filed under nobody
     belongs to nobody, exactly like an unassigned household. */
  test('a party in no household is still visible to every active staff member', () => {
    expect(fn('staff_can_access_party')).toMatch(
      /if not exists \([\s\S]*?client_group_members m\s+where m\.party_id = p_party_id and m\.end_date is null\s+\) then\s+return true;/,
    )
  })
})

describe('the creator escapes are bounded to the moment of creation', () => {
  test.each([
    ['staff_can_access_account', 'financial_account_owners'],
    ['staff_can_access_item', 'asset_liability_owners'],
    ['staff_can_access_policy', 'insurance_policy_parties'],
    ['staff_can_access_note', 'note_subjects'],
  ])('%s only trusts its creator while nothing is attached', (name, child) => {
    const body = fn(name)
    expect(body).toContain('and not exists (')
    expect(body).toContain(child)
  })

  /**
   * THE ONE THE PROBE CAUGHT. Four SELECT policies inline the rule rather than
   * calling the helper, so narrowing the helpers alone left reads wide open.
   */
  test.each([
    ['notes_select', 'note_has_subjects', 'staff_can_access_note'],
    ['accounts_select', 'account_has_owners', 'staff_can_access_account'],
    ['policies_select', 'policy_has_parties', 'staff_can_access_policy'],
    ['items_select', 'item_has_owners', 'staff_can_access_item'],
  ])('%s bounds its inline creator test and defers for everything else', (name, bound, helper) => {
    const rule = policy(name)
    expect(rule).toContain(`not public.${bound}(id)`)
    expect(rule).toContain(`public.${helper}(id)`)
  })

  /**
   * And why the creator test stays INLINE rather than moving into the helper:
   * the helpers are STABLE and re-read the parent row, so during
   * `INSERT ... RETURNING` they run against the statement's snapshot, cannot see
   * the row just inserted, and refuse it to its own author. Replacing the inline
   * form outright broke record creation on the branch.
   */
  test.each(['notes_select', 'accounts_select', 'policies_select', 'items_select'])(
    '%s still tests the creator column on the new row itself',
    (name) => {
      expect(policy(name)).toMatch(/(created_by_staff_id|author_staff_id) = public\.current_staff_id\(\)/)
    },
  )

  /* The bound cannot be an ordinary subquery: it would be filtered by the child
     table's own policy and answer "nothing attached" for a record whose owners
     the caller may not see — handing the creator access for ever. */
  test.each(['account_has_owners', 'policy_has_parties', 'item_has_owners', 'note_has_subjects'])(
    '%s counts past row-level security',
    (name) => {
      expect(fn(name)).toContain('security definer')
    },
  )
})

describe('sensitive fields ask who the party is', () => {
  test.each(['reveal_sensitive_field', 'set_sensitive_field', 'get_masked_hint', 'get_masked_hints'])(
    '%s checks access to the party',
    (name) => {
      expect(fn(name)).toContain('staff_can_access_party(p_party_id)')
    },
  )

  /* Refused before the second-factor prompt, so nobody is asked to authenticate
     for a record they were never going to be shown. */
  test('the reveal refuses an inaccessible party before it asks for a second factor', () => {
    const body = fn('reveal_sensitive_field')
    expect(body.indexOf('staff_can_access_party')).toBeLessThan(body.indexOf('has_mfa'))
    expect(body).toMatch(/raise exception 'No such client, or not one you have access to'/)
  })

  test('the write is refused the same way, and is still logged', () => {
    const body = fn('set_sensitive_field')
    expect(body).toMatch(/raise exception 'No such client, or not one you have access to'/)
    expect(body).toContain("'write'")
  })
})

describe('the migration refuses to land half-done', () => {
  test('it aborts if the shortcut, a hatch, a policy or a sensitive path regresses', () => {
    expect(sql).toContain("raise exception 'staff_can_access_party still short-circuits on view_all_groups'")
    expect(sql).toContain("raise exception '% still lets its creator see the record for ever', v_fn")
    expect(sql).toContain("raise exception '% lets its creator read the record for ever', v_fn")
    expect(sql).toContain("raise exception '% does not check access to the party', v_fn")
    expect(sql).toContain(
      "raise exception 'the ungrouped-party carve-out is gone; that is a bigger decision than this file'",
    )
  })
})
