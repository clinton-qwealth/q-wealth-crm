import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The seven communication channels exist in two places, and they must agree.
 *
 * The **database** holds them as an enum, which is what makes an unknown value
 * impossible to store. The **panel** holds them as an ordered list with display
 * text, because an enum has neither an order nor a name a person can read.
 * Neither can be derived from the other, so the two are kept in step by hand —
 * and this is the test that says when they stop being.
 *
 * The failure it prevents is quiet and one-sided: adding a channel to the enum
 * and forgetting the panel leaves a channel nobody can ever opt into, and it
 * looks exactly like a channel that does not exist. The reverse is louder — the
 * database rejects the value — but still only at the moment somebody presses
 * the toggle.
 *
 * Both files are read as source rather than imported: the panel is a client
 * component whose imports reach server actions, and the migration is SQL.
 */
const panel = readFileSync(resolve(__dirname, '../components/member-panel.tsx'), 'utf8')
const migration = readFileSync(
  resolve(__dirname, '../supabase/migrations/20260911091500_a_client_s_communication_subscriptions.sql'),
  'utf8',
)

/*
 * Scoped to the CHANNELS array rather than matched across the file. The first
 * version of this was not, and swept in MEMBER_ROLES — an identical
 * `['value', 'Label']` shape a few hundred lines away — so the test failed
 * claiming the panel offered a channel called "primary". A pattern that matches
 * the right thing by accident is one that will match the wrong thing later.
 */
const channelsStart = panel.indexOf('const CHANNELS')
/* To the array's OWN closing bracket, on its own line. A plain `indexOf(']')`
   stops inside the type annotation — `[value: string, label: string][]` — and
   returns an empty block, which made every assertion below pass against
   nothing. Caught because the length check failed loudly rather than the set
   comparison passing on two empty sets. */
const channelsBlock = panel.slice(channelsStart, panel.indexOf('\n]', channelsStart))
const pairs = [...channelsBlock.matchAll(/\[\s*'([a-z_]+)',\s*'([^']+)'\s*\]/g)]
const inPanel = pairs.map((m) => m[1])

/** The values the database will accept. */
const enumBlock = migration.slice(
  migration.indexOf('create type public.subscription_channel'),
  migration.indexOf(');', migration.indexOf('create type public.subscription_channel')),
)
const inDatabase = [...enumBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

describe('the subscription channels', () => {
  test('the database accepts exactly seven', () => {
    expect(inDatabase).toHaveLength(7)
    expect(new Set(inDatabase).size, 'a value is listed twice').toBe(7)
  })

  /**
   * **Set equality, both directions.** A subset check either way would pass
   * while one side quietly held something the other did not, which is the whole
   * failure being guarded against.
   */
  test('and the panel offers exactly those, no more and no fewer', () => {
    expect(inPanel).toHaveLength(7)
    expect(new Set(inPanel)).toEqual(new Set(inDatabase))
  })

  /* The panel's order is its own decision — the database has none — but every
     value in it still has to be one the database will take. */
  test('every channel the panel shows is one the database will store', () => {
    for (const v of inPanel) {
      expect(inDatabase, `the panel offers "${v}", which the database would refuse`).toContain(v)
    }
  })

  /* Each one needs text a person can read. A channel shown by its enum value
     would be the database leaking into the screen. */
  test('each channel has a label, and none is its own enum value', () => {
    expect(pairs).toHaveLength(7)
    for (const [, value, label] of pairs) {
      expect(label, `${value} has no readable label`).not.toBe(value)
      expect(label).not.toContain('_')
    }
  })
})
