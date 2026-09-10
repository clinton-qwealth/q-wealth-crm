import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The two workflow loaders that became single embedded reads on 10 September:
 * the `#` entity choices and the default email recipient.
 *
 * The round-trip harness proves they are ONE read each. This file proves they
 * still answer the same questions the three-read versions did — which members
 * count, whose email wins, what is left out — now that the filtering PostgREST
 * used to do (`end_date is null`, `kind = 'email'`, the `clients` join) is done
 * on the embedded rows instead.
 */
let ROW: Record<string, unknown> | null = null
const selects: string[] = []

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: (cols: string) => {
          selects.push(`${table}:${cols}`)
          return chain
        },
        eq: () => chain,
        maybeSingle: async () => ({ data: ROW, error: null }),
      }
      return chain
    },
  }),
}))

const { getWorkflowEntityChoices, getWorkflowRecipient } = await import('@/lib/workflows')

beforeEach(() => {
  ROW = null
  selects.length = 0
})

describe('getWorkflowEntityChoices', () => {
  const row = (group: Record<string, unknown>) => ({ group_id: 'g1', client_groups: group })

  test('the group first, then current members who are clients, then the OTHER workflows newest first', async () => {
    ROW = row({
      name: 'Testsmith Household',
      members: [
        { party_id: 'p1', end_date: null, clients: { display_name: 'Janet Testsmith' } },
        // Left the group: excluded, however good the label.
        { party_id: 'p9', end_date: '2025-01-01', clients: { display_name: 'Left The Group' } },
        // In the group but not an active client: no `clients` row, excluded.
        { party_id: 'p8', end_date: null, clients: null },
      ],
      siblings: [
        { id: 'w2', name: 'Older', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'w1', name: 'This one', updated_at: '2026-07-01T00:00:00Z' },
        { id: 'w3', name: 'Newer', updated_at: '2026-08-01T00:00:00Z' },
      ],
    })
    await expect(getWorkflowEntityChoices('w1')).resolves.toEqual([
      { kind: 'group', id: 'g1', label: 'Testsmith Household' },
      { kind: 'client', id: 'p1', label: 'Janet Testsmith' },
      { kind: 'workflow', id: 'w3', label: 'Newer' },
      { kind: 'workflow', id: 'w2', label: 'Older' },
    ])
  })

  test('a workflow that cannot be seen, or has no group, offers nothing', async () => {
    ROW = null
    await expect(getWorkflowEntityChoices('w1')).resolves.toEqual([])
    ROW = { group_id: null, client_groups: null }
    await expect(getWorkflowEntityChoices('w1')).resolves.toEqual([])
  })

  test('tolerates PostgREST returning to-one embeds as arrays', async () => {
    ROW = { group_id: 'g1', client_groups: [{ name: 'G', members: [{ party_id: 'p1', end_date: null, clients: [{ display_name: 'J' }] }], siblings: [] }] }
    await expect(getWorkflowEntityChoices('w1')).resolves.toEqual([
      { kind: 'group', id: 'g1', label: 'G' },
      { kind: 'client', id: 'p1', label: 'J' },
    ])
  })

  test('is one read of the workflow row, embedding the rest', async () => {
    ROW = null
    await getWorkflowEntityChoices('w1')
    expect(selects).toHaveLength(1)
    expect(selects[0]).toMatch(/^workflows:/)
    expect(selects[0]).toContain('client_group_members(')
    expect(selects[0]).toContain('clients(')
    expect(selects[0]).toContain('siblings:workflows(')
  })
})

describe('getWorkflowRecipient', () => {
  const row = (group: Record<string, unknown> | null) => ({ group_id: 'g1', client_groups: group })
  const contact = (points: unknown[]) => ({ display_name: 'Janet Testsmith', contact_points: points })

  test('the primary contact’s PREFERRED email wins, phones are ignored', async () => {
    ROW = row({
      primary_contact_party_id: 'p1',
      contact: contact([
        { value: '0412 555 901', is_preferred: true, kind: 'phone_mobile' },
        { value: 'old@example.com', is_preferred: false, kind: 'email' },
        { value: 'janet@example.com', is_preferred: true, kind: 'email' },
      ]),
    })
    await expect(getWorkflowRecipient('w1')).resolves.toEqual({ email: 'janet@example.com', name: 'Janet Testsmith' })
  })

  test('with no preference, the first email on file', async () => {
    ROW = row({ primary_contact_party_id: 'p1', contact: contact([
      { value: 'first@example.com', is_preferred: false, kind: 'email' },
      { value: 'second@example.com', is_preferred: false, kind: 'email' },
    ]) })
    await expect(getWorkflowRecipient('w1')).resolves.toMatchObject({ email: 'first@example.com' })
  })

  test('nobody to write to is null, not a throw: no group, no primary contact, no email', async () => {
    ROW = null
    await expect(getWorkflowRecipient('w1')).resolves.toBeNull()
    ROW = row({ primary_contact_party_id: null, contact: null })
    await expect(getWorkflowRecipient('w1')).resolves.toBeNull()
    ROW = row({ primary_contact_party_id: 'p1', contact: contact([{ value: '0412 555 901', is_preferred: true, kind: 'phone_mobile' }]) })
    await expect(getWorkflowRecipient('w1')).resolves.toBeNull()
  })

  /**
   * The hint is the difference between an embed that resolves and PGRST201:
   * client_groups reaches parties by two paths. Pinned so a tidy-up cannot
   * drop it and break the page in production only.
   */
  test('is one read, and names the primary-contact key on the parties embed', async () => {
    ROW = null
    await getWorkflowRecipient('w1')
    expect(selects).toHaveLength(1)
    expect(selects[0]).toMatch(/^workflows:/)
    expect(selects[0]).toContain('parties!primary_contact_party_id(')
    expect(selects[0]).toContain('contact_points(')
  })
})
