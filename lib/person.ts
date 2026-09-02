import { createSupabaseServerClient } from '@/lib/supabase/server'

export type PersonDetail = {
  party_id: string
  display_name: string
  /** A group can hold trusts and companies too. Those have no persons row, so
   *  they appear in the list but have no panel to open. */
  is_person: boolean
  status: string
  notes: string | null
  title: string | null
  first_name: string
  middle_name: string | null
  last_name: string
  preferred_name: string | null
  date_of_birth: string | null
  date_of_death: string | null
  gender: string | null
  marital_status: string | null
  tfn_status: string
  place_of_birth: string | null
  smoker: boolean | null
  primary_citizenship: string | null
  secondary_citizenship: string | null
  tax_residency: string | null
  employment_status: string | null
  occupation: string | null
  company_name: string | null
  hin: string | null
  chess_pid: string | null
  coffee_preference: string | null
  /** Masked hints for the encrypted identifiers, as kind -> hint. Hints only;
   *  the plaintext needs an MFA-gated reveal that is logged. */
  hints: Record<string, string>
  member_role: string | null
  is_primary_group: boolean | null
  email: string | null
  mobile: string | null
  phone_other: string | null
  address: {
    line1: string | null
    line2: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
  }
  roles: { role: string; status: string; start_date: string }[]
  other_groups: { name: string; member_role: string }[]
}

/**
 * Every individual in a group, with the whole record the panel shows.
 *
 * Fetched for all members at once rather than on open. A household holds a
 * handful of people, so four queries with `in` filters cost less than a round
 * trip per panel open — and the panel then has no loading state to design.
 * Worth revisiting if groups ever hold dozens of members.
 */
export async function getGroupMemberDetail(groupId: string): Promise<PersonDetail[]> {
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: memberships } = await supabase
    .from('client_group_members')
    .select('party_id, member_role, is_primary_group, parties(id, display_name, status, notes, party_type)')
    .eq('group_id', groupId)
    .is('end_date', null)

  const rows = (memberships ?? []).map((m) => {
    const raw = (m as Record<string, unknown>).parties
    const party = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null
    return {
      party_id: m.party_id as string,
      member_role: m.member_role as string,
      is_primary_group: m.is_primary_group as boolean,
      party,
    }
  })

  const people = rows.filter((r) => r.party?.party_type === 'person')
  const ids = people.map((p) => p.party_id)

  // Organisations are returned alongside so the members list stays complete;
  // they simply carry no person fields and open no panel.
  const organisations: PersonDetail[] = rows
    .filter((r) => r.party?.party_type !== 'person')
    .map((r) => ({
      party_id: r.party_id,
      display_name: (r.party?.display_name as string) ?? 'Unnamed',
      is_person: false,
      status: (r.party?.status as string) ?? 'active',
      notes: (r.party?.notes as string) ?? null,
      title: null, first_name: '', middle_name: null, last_name: '',
      preferred_name: null, date_of_birth: null, date_of_death: null, gender: null,
      marital_status: null, tfn_status: 'not_provided',
      place_of_birth: null, smoker: null, primary_citizenship: null,
      secondary_citizenship: null, tax_residency: null, employment_status: null,
      occupation: null, company_name: null, hin: null, chess_pid: null,
      coffee_preference: null, hints: {},
      member_role: r.member_role, is_primary_group: r.is_primary_group,
      email: null, mobile: null, phone_other: null,
      address: { line1: null, line2: null, suburb: null, state: null, postcode: null },
      roles: [], other_groups: [],
    }))

  if (ids.length === 0) return organisations.sort((a, b) => a.display_name.localeCompare(b.display_name))

  const [{ data: persons }, { data: contacts }, { data: roles }, { data: allMemberships }, hintResults] =
    await Promise.all([
      supabase.from('persons').select('*').in('party_id', ids),
      supabase.from('contact_points').select('*').in('party_id', ids).eq('is_preferred', true),
      supabase.from('party_roles').select('party_id, role, status, start_date').in('party_id', ids).is('end_date', null),
      supabase
        .from('client_group_members')
        .select('party_id, member_role, client_groups(name)')
        .in('party_id', ids)
        .is('end_date', null)
        .neq('group_id', groupId),
      // One call per person rather than one per field: get_masked_hints returns
      // every encrypted kind held against a party in a single object.
      Promise.all(
        ids.map(async (id) => ({
          id,
          hints: ((await supabase.rpc('get_masked_hints', { p_party_id: id })).data ??
            {}) as Record<string, string>,
        })),
      ),
    ])

  const hintsBy = new Map(hintResults.map((h) => [h.id, h.hints]))

  const personBy = new Map((persons ?? []).map((p) => [p.party_id as string, p]))
  const contactsBy = new Map<string, Record<string, unknown>[]>()
  for (const c of contacts ?? []) {
    const row = c as Record<string, unknown>
    const key = row.party_id as string
    if (!contactsBy.has(key)) contactsBy.set(key, [])
    contactsBy.get(key)!.push(row)
  }

  const pick = (id: string, kind: string) =>
    ((contactsBy.get(id) ?? []).find((c) => c.kind === kind)?.value as string | null) ?? null

  return people
    .map((m): PersonDetail => {
      const p = (personBy.get(m.party_id) ?? {}) as Record<string, unknown>
      const addr = (contactsBy.get(m.party_id) ?? []).find(
        (c) => c.kind === 'address_residential',
      )
      return {
        party_id: m.party_id,
        display_name: (m.party?.display_name as string) ?? 'Unnamed',
        is_person: true,
        status: (m.party?.status as string) ?? 'active',
        notes: (m.party?.notes as string) ?? null,
        title: (p.title as string) ?? null,
        first_name: (p.first_name as string) ?? '',
        middle_name: (p.middle_name as string) ?? null,
        last_name: (p.last_name as string) ?? '',
        preferred_name: (p.preferred_name as string) ?? null,
        date_of_birth: (p.date_of_birth as string) ?? null,
        date_of_death: (p.date_of_death as string) ?? null,
        gender: (p.gender as string) ?? null,
        marital_status: (p.marital_status as string) ?? null,
        tfn_status: (p.tfn_status as string) ?? 'not_provided',
        place_of_birth: (p.place_of_birth as string) ?? null,
        smoker: (p.smoker as boolean | null) ?? null,
        primary_citizenship: (p.primary_citizenship as string) ?? null,
        secondary_citizenship: (p.secondary_citizenship as string) ?? null,
        tax_residency: (p.tax_residency as string) ?? null,
        employment_status: (p.employment_status as string) ?? null,
        occupation: (p.occupation as string) ?? null,
        company_name: (p.company_name as string) ?? null,
        hin: (p.hin as string) ?? null,
        chess_pid: (p.chess_pid as string) ?? null,
        coffee_preference: (p.coffee_preference as string) ?? null,
        hints: hintsBy.get(m.party_id) ?? {},
        member_role: m.member_role,
        is_primary_group: m.is_primary_group,
        email: pick(m.party_id, 'email'),
        mobile: pick(m.party_id, 'phone_mobile'),
        phone_other: pick(m.party_id, 'phone_other'),
        address: {
          line1: (addr?.address_line_1 as string) ?? null,
          line2: (addr?.address_line_2 as string) ?? null,
          suburb: (addr?.suburb as string) ?? null,
          state: (addr?.state as string) ?? null,
          postcode: (addr?.postcode as string) ?? null,
        },
        roles: (roles ?? [])
          .filter((r) => r.party_id === m.party_id)
          .map((r) => ({
            role: r.role as string,
            status: r.status as string,
            start_date: r.start_date as string,
          })),
        other_groups: (allMemberships ?? [])
          .filter((g) => g.party_id === m.party_id)
          .map((g) => {
            const raw = (g as Record<string, unknown>).client_groups
            const grp = (Array.isArray(raw) ? raw[0] : raw) as { name?: string } | null
            return { name: grp?.name ?? 'Unnamed group', member_role: g.member_role as string }
          }),
      }
    })
    .concat(organisations)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
}
