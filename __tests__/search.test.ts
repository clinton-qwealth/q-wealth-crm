import { describe, expect, test } from 'vitest'
import { createRoundTripHarness } from './helpers/round-trips'
import {
  EMPTY_RESULTS,
  MIN_QUERY,
  PER_SECTION,
  escapeForFilter,
  searchEverything,
} from '@/lib/search'

/**
 * What the search asks the database, and what it makes of the answer.
 *
 * The queries are stubbed, so nothing here proves a row comes back — that is
 * row-level security's job and it is proved on a branch. What IS proved here is
 * everything the application decides: which tables are read and in how many
 * waves, that a person's typing cannot become a wildcard or break the filter
 * syntax, and that each answer lands in the right section with a link that goes
 * somewhere real.
 */

/** A stub that records what was asked and hands back fixed rows. */
function stubClient(rows: Record<string, unknown[]>, harness?: ReturnType<typeof createRoundTripHarness>) {
  const filters: Record<string, string[]> = {}
  const selects: Record<string, string> = {}

  const client = {
    from(table: string) {
      filters[table] ??= []
      const chain: Record<string, unknown> = {}
      const step = () => chain
      for (const m of ['eq', 'is', 'order', 'limit', 'neq']) {
        chain[m] = (...args: unknown[]) => {
          filters[table].push(`${m}:${args[0]}`)
          return step()
        }
      }
      chain.select = (cols: string) => {
        selects[table] = cols
        return step()
      }
      chain.ilike = (col: string, pattern: string) => {
        filters[table].push(`ilike:${col}=${pattern}`)
        return step()
      }
      chain.then = (resolve: (v: unknown) => void) => {
        const settle = () => resolve({ data: rows[table] ?? [], error: null })
        if (harness) return harness.wait(table).then(settle)
        return Promise.resolve().then(settle)
      }
      return chain
    },
  }
  return { client: client as never, filters, selects }
}

describe('escapeForFilter', () => {
  /**
   * **A `%` typed by a person is a character, not an instruction.** Left
   * unescaped it is a LIKE wildcard, so searching for it matches every row in
   * the table — not what was meant, and a needless read of everything.
   */
  test('wildcards are escaped rather than obeyed', () => {
    expect(escapeForFilter('100%')).toBe('100\\%')
    expect(escapeForFilter('a_b')).toBe('a\\_b')
    expect(escapeForFilter('back\\slash')).toBe('back\\\\slash')
  })

  /**
   * **PostgREST's filter syntax is the other hazard, and the ordinary one.**
   * A comma ends a filter and the rest is parsed as another, so "Smith, J" —
   * a perfectly normal thing to type — fails the request outright.
   */
  test('and the filter syntax cannot be broken by ordinary typing', () => {
    for (const c of [',', '.', '(', ')', '"']) {
      expect(escapeForFilter(`a${c}b`), `"${c}" survived`).not.toContain(c)
    }
    expect(escapeForFilter('Smith, J')).toBe('Smith  J')
  })

  test('and the result is trimmed, so spacing alone is never a query', () => {
    expect(escapeForFilter('   ')).toBe('')
    expect(escapeForFilter('  hi  ')).toBe('hi')
  })
})

describe('searchEverything', () => {
  const rows = {
    client_groups: [
      { id: 'g1', name: 'Testsmith Household', group_type: 'household' },
      { id: 'g2', name: 'Testlee Household', group_type: 'household' },
      { id: 'g3', name: 'Testing Entity Pty Ltd', group_type: 'business_entity' },
    ],
    client_group_members: [
      { party_id: 'p1', group_id: 'g1', parties: { display_name: 'Janet Testsmith' }, client_groups: { name: 'Testsmith Household' } },
    ],
    party_roles: [{ party_id: 'p9', parties: { display_name: 'Netwealth' } }],
    workflow_board: [{ id: 'w1', name: 'Annual review', group_name: 'Testsmith Household' }],
  }

  /**
   * **A single keystroke asks the database nothing.**
   *
   * Not merely "returns empty" — the assertion is that no query is issued at
   * all. A version that queried and then discarded the answer would satisfy a
   * result-shape test while sweeping the whole table on every first letter.
   */
  test('a query below the minimum is refused before any query is made', async () => {
    const { client, filters } = stubClient(rows)
    expect(await searchEverything(client, 'a')).toEqual(EMPTY_RESULTS)
    expect(Object.keys(filters), 'it went to the database anyway').toEqual([])
    expect(MIN_QUERY).toBe(2)
  })

  test('and so does a query that is only punctuation, once escaped', async () => {
    const { client, filters } = stubClient(rows)
    expect(await searchEverything(client, '(),')).toEqual(EMPTY_RESULTS)
    expect(Object.keys(filters)).toEqual([])
  })

  /**
   * **One wave.** The four queries need nothing from one another, and a request
   * to Supabase costs about 170ms whatever it carries — so chaining them would
   * make a search-as-you-type control four times slower for no reason.
   *
   * Measured by the same harness the page depth tests use: it releases pending
   * queries one wave at a time, so the number of waves IS the depth, on any
   * machine and under any load.
   */
  test('reads four tables in a single wave', async () => {
    const harness = createRoundTripHarness()
    const { client } = stubClient(rows, harness)

    const { depth, value } = await harness.measure(() => searchEverything(client, 'test'))

    expect(depth, 'the queries were chained').toBe(1)
    expect(new Set(harness.calls)).toEqual(
      new Set(['client_groups', 'client_group_members', 'party_roles', 'workflow_board']),
    )
    expect(value).toBeDefined()
  })

  /* Groups come back in one read and are split here, so households and
     entities cost one round trip between them rather than two. */
  test('one read of the groups becomes two sections, by type', async () => {
    const { client } = stubClient(rows)
    const out = await searchEverything(client, 'test')

    expect(out.households.map((h) => h.title)).toEqual([
      'Testsmith Household',
      'Testlee Household',
    ])
    expect(out.entities.map((h) => h.title)).toEqual(['Testing Entity Pty Ltd'])
  })

  /**
   * **`!inner` on both embeds, and this is not cosmetic.** Filtering on an
   * embedded column WITHOUT it restricts the embed rather than the rows: every
   * current membership comes back, each with a null party hanging off it, and
   * the section fills with "Unnamed".
   */
  test('the embedded filters restrict the rows, not just the embed', async () => {
    const { client, selects, filters } = stubClient(rows)
    await searchEverything(client, 'test')

    expect(selects.client_group_members).toContain('parties!inner')
    expect(selects.party_roles).toContain('parties!inner')
    expect(filters.client_group_members).toContain('ilike:parties.display_name=%test%')
  })

  test('only current memberships and active provider roles are searched', async () => {
    const { client, filters } = stubClient(rows)
    await searchEverything(client, 'test')

    expect(filters.client_group_members).toContain('is:end_date')
    expect(filters.party_roles).toEqual(
      expect.arrayContaining(['eq:role', 'eq:status', 'is:end_date']),
    )
  })

  /**
   * A person has no page of their own — their record is a panel on the group —
   * so a result goes to the group they are in. A service provider has no page
   * at all, so it carries no link rather than one that 404s.
   */
  test('every result links somewhere real, or says it cannot', async () => {
    const { client } = stubClient(rows)
    const out = await searchEverything(client, 'test')

    expect(out.households[0].href).toBe('/groups/g1')
    expect(out.people[0].href, 'a person goes to their group').toBe('/groups/g1')
    expect(out.people[0].detail).toBe('Testsmith Household')
    expect(out.workflows[0].href).toBe('/workflows/w1')
    expect(out.providers[0].href, 'a provider has no page to link to').toBe('')
    expect(out.providers[0].title).toBe('Netwealth')
  })

  /* Capped per section rather than overall, so a group with many matching
     workflows cannot push the households off the list entirely. */
  test('each section is capped on its own', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`,
      name: `Household ${i}`,
      group_type: 'household',
    }))
    const { client } = stubClient({ ...rows, client_groups: many })
    const out = await searchEverything(client, 'test')
    expect(out.households).toHaveLength(PER_SECTION)
  })

  test('a to-one embed is tolerated as an array, as PostgREST may send it', async () => {
    const { client } = stubClient({
      ...rows,
      client_group_members: [
        { party_id: 'p1', group_id: 'g1', parties: [{ display_name: 'Janet' }], client_groups: [{ name: 'A group' }] },
      ],
    })
    const out = await searchEverything(client, 'test')
    expect(out.people[0].title).toBe('Janet')
    expect(out.people[0].detail).toBe('A group')
  })
})
