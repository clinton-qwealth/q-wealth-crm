import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * The shape of the registration migration, read from its text.
 *
 * These are the properties a careless edit would most plausibly lose and no
 * unit test of the app could notice: that the request function runs as its
 * owner with an empty search path and is not callable anonymously; that the
 * approval function does NOT run as owner (the approver's own RLS is what
 * names them in the audit trail); that the domain table's key is a uuid, since
 * `record_audit` casts the key; and that the auth hook is callable by Auth's
 * role alone.
 */
const sql = migrationSource('a_person_can_ask_to_join_the_staff')
const enumSql = migrationSource('a_staff_member_may_be_pending')

const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, `${name} is defined`).toBeGreaterThan(-1)
  const end = sql.indexOf('$fn$;', start)
  return sql.slice(start, end)
}

/**
 * Not this migration's own text, but the constraint its idempotence rests on.
 *
 * `request_staff_access()` reads then inserts with no lock, and since 20 Sep 2026
 * it is called from `/auth/confirm` — a GET a browser may repeat. Two concurrent
 * confirmations would both find no row and both insert; `auth_user_id uuid unique`
 * is the only thing that turns that into one row and a clean refusal rather than
 * two pending rows and a `maybeSingle()` that errors for that person forever.
 */
describe('the constraint the request function leans on', () => {
  test('a staff row is unique per auth account', () => {
    expect(migrationSource('create_staff_users')).toMatch(/auth_user_id\s+uuid\s+unique/)
  })
})

describe('the registration migration', () => {
  test('the enum value stands alone in its own file', () => {
    expect(enumSql).toMatch(/alter type public\.staff_status add value if not exists 'pending' before 'active'/)
    expect(enumSql).not.toContain('create ')
    expect(sql).not.toContain('alter type')
  })

  test('request_staff_access runs as owner, with no search path, and only for the signed in', () => {
    const body = fn('request_staff_access')
    expect(body).toContain('security definer')
    expect(body).toContain("set search_path to ''")
    expect(body).toContain('email_confirmed_at')
    expect(body).toContain('public.staff_email_domains')
    expect(body).toContain("values (v_uid, v_email, v_name, 'pending')")
    expect(sql).toContain('revoke all on function public.request_staff_access(text) from public, anon;')
    expect(sql).toContain('grant execute on function public.request_staff_access(text) to authenticated;')
  })

  test('approve_staff_registration runs as the approver', () => {
    const body = fn('approve_staff_registration')
    expect(body).toContain('security invoker')
    expect(body).not.toContain('security definer')
    expect(body).toContain("current_staff_has('manage_staff')")
    expect(body).toContain("if v_status <> 'pending'")
    expect(sql).toContain('revoke all on function public.approve_staff_registration(uuid, uuid) from public, anon;')
  })

  test('the domain table has a uuid key, one seed, and an audit trigger', () => {
    expect(sql).toMatch(/create table public\.staff_email_domains \(\s*id\s+uuid primary key/)
    expect(sql).toContain("insert into public.staff_email_domains (domain) values ('qwealth.com.au');")
    expect(sql.match(/insert into public\.staff_email_domains/g)).toHaveLength(1)
    expect(sql).toMatch(/on public\.staff_email_domains\s+for each row execute function public\.record_audit\('id', ''\)/)
    expect(sql).toContain('alter table public.staff_email_domains enable row level security;')
  })

  test('a pending person may read their own row and nothing more', () => {
    expect(sql).toMatch(/create policy staff_read_own_row on public\.staff_users\s+for select to authenticated\s+using \(auth_user_id = \(select auth\.uid\(\)\)\);/)
  })

  test('the auth hook is callable by Auth alone', () => {
    const body = fn('before_user_created_hook')
    expect(body).toContain('security definer')
    expect(body).toContain("'http_code', 403")
    expect(sql).toContain('grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;')
    expect(sql).toContain('revoke execute on function public.before_user_created_hook(jsonb) from public, anon, authenticated;')
  })
})
