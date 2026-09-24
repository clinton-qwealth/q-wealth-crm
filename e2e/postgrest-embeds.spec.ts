import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { ADMIN_SELECTS } from '../lib/admin-selects'

/**
 * Every embed the Administration page relies on still names exactly one
 * relationship.
 *
 * ## Why this cannot be a unit test
 *
 * A select string with an embed — `user_groups(...)`, `client_groups(...)` — is
 * a query against the DATABASE SCHEMA. Whether it is valid depends on the
 * foreign keys that exist, so a mocked Supabase client cannot tell you, and
 * neither can the type checker. Only PostgREST can, and it answers at PARSE
 * time, before any privilege is considered:
 *
 *   300 / PGRST201  more than one relationship — the query is ambiguous
 *   400 / PGRST200  no relationship at all — the embed does not exist
 *   401 / 42501     it parsed; the anonymous role simply may not read it
 *
 * **401 is the pass.** It means PostgREST understood the query and refused it
 * on privilege, which is exactly what should happen without a session. No
 * session is needed, and no credential beyond the publishable key.
 *
 * ## The failure this was written for
 *
 * On 24 September 2026 the entire Administration page threw in production:
 *
 *     The user groups could not be read: Could not embed because more than one
 *     relationship was found for 'user_groups' and 'client_groups'
 *
 * Three foreign keys connect those tables. The second arrived on 22 September
 * in a migration that changed no TypeScript whatsoever, and nothing broke until
 * PostgREST reloaded its schema cache two days later — so the change and the
 * breakage were not even on the same day. The full gate passed the whole time.
 *
 * Mutation, and it was run: put `client_groups(id)` back in
 * `lib/admin-selects.ts` and this fails with 300 / PGRST201.
 */

/** The publishable key and URL, from the environment or from .env.local — the
 *  same two values the browser itself ships with, so nothing secret is used. */
function config(): { url: string; key: string } | null {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL
  let key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if ((!url || !key) && existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!m) continue
      const value = m[2].replace(/^["']|["']$/g, '')
      if (m[1] === 'NEXT_PUBLIC_SUPABASE_URL') url ||= value
      if (m[1] === 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') key ||= value
    }
  }
  return url && key ? { url, key } : null
}

test.describe('the Administration page’s PostgREST embeds', () => {
  const cfg = config()
  test.skip(
    !cfg,
    'Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, in the environment or .env.local.',
  )

  for (const [name, { from, select }] of Object.entries(ADMIN_SELECTS)) {
    test(`${name}: resolves to exactly one relationship`, async ({ request }) => {
      const res = await request.get(
        `${cfg!.url}/rest/v1/${from}?select=${encodeURIComponent(select)}`,
        { headers: { apikey: cfg!.key, Authorization: `Bearer ${cfg!.key}` } },
      )
      const body = await res.text()

      /* Named explicitly rather than asserting "not 300", so a future failure
         says which kind of wrong it is without anybody re-deriving the codes. */
      expect(body, `${name} is an AMBIGUOUS embed (PGRST201) — name the relationship`).not.toContain('PGRST201')
      expect(body, `${name} embeds a relationship that does not exist (PGRST200)`).not.toContain('PGRST200')
      expect(
        res.status(),
        `${name} should parse and be refused on privilege (401), not fail to parse. Body: ${body.slice(0, 200)}`,
      ).toBe(401)
    })
  }
})
