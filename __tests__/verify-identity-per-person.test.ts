import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * Verifying a client's identity is granted to a PERSON, not to a profile — the
 * shape of the migration that moved it, read from its text.
 *
 * Three things a careless edit would most plausibly lose, and no test of the
 * app could notice:
 *
 * - `current_staff_has('verify_identity')` reads the PERSON'S column. Every one
 *   of the five verification write paths asks that function by that string, so
 *   this one CASE arm is the whole permission.
 * - The backfill grants it to exactly the people whose profile granted it, and
 *   only if active. Nobody gains or loses on the day; the change is where the
 *   answer is stored.
 * - The profile column is NOT dropped here. The deployed app selects it on every
 *   page load — dropping it before the deploy is the 31 August outage again.
 */
const sql = migrationSource('verify_identity_is_granted_to_a_person')

describe('the migration that made verify-identity a personal grant', () => {
  test('adds the column to the person, off by default', () => {
    expect(sql).toMatch(/alter table public\.staff_users\s+add column verify_identity boolean not null default false/)
  })

  test('the permission check reads the person, not the profile', () => {
    expect(sql).toContain("when 'verify_identity' then su.verify_identity")
    expect(sql, 'no arm still reads the profile column').not.toContain("when 'verify_identity' then ap.verify_identity")
  })

  test('the backfill copies exactly the active people whose profile granted it', () => {
    const backfill = sql.slice(sql.indexOf('update public.staff_users su'), sql.indexOf('set constraints all immediate'))
    expect(backfill).toContain('set verify_identity = true')
    expect(backfill).toContain("su.status = 'active'")
    expect(backfill).toContain('ap.verify_identity')
  })

  test('the patch function accepts the key and insists on a real boolean', () => {
    expect(sql).toMatch(/v_keys\s+text\[\] := array\[[^\]]*'verify_identity'\]/)
    expect(sql).toContain("jsonb_typeof(p_patch->'verify_identity') <> 'boolean'")
  })

  /* The one-way step is a separate file, gated on the deploy. */
  test('the profile column survives this migration, and the migration says so', () => {
    expect(sql).not.toMatch(/alter table public\.access_profiles\s+drop column/)
    expect(sql).toContain("access_profiles.verify_identity must survive M1")
  })

  test('the closing assertions abort rather than report', () => {
    expect(sql).toContain('were not backfilled')
    expect(sql).toContain('gained verify_identity that their profile did not grant')
  })
})

/**
 * The one-way step, gated on the deploy. Pinned separately so that folding the
 * drop back into the first file — which would break the deployed app — is a
 * test failure and not a judgement call.
 */
describe('the migration that drops the profile column', () => {
  const drop = migrationSource('a_profile_no_longer_grants_verify_identity')

  test('drops exactly the profile column, and nothing off the person', () => {
    expect(drop).toMatch(/alter table public\.access_profiles drop column verify_identity/)
    expect(drop).not.toMatch(/alter table public\.staff_users/)
  })

  test('says in its own text that it must wait for the deploy', () => {
    expect(drop).toContain('DO NOT APPLY THIS BEFORE THE APP THAT STOPS SELECTING THE COLUMN IS LIVE')
  })

  test('sweeps every function for a stale read of the profile column', () => {
    expect(drop).toContain("p.prosrc ~ 'ap\\.verify_identity'")
    expect(drop).toContain("These still read verify_identity off the profile")
  })

  test("and confirms the person's column survives with its default", () => {
    expect(drop).toContain("column_name = 'verify_identity' and column_default = 'false'")
  })
})
