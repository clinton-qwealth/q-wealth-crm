import type { PersonDetail } from '@/lib/person'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@/app/(shell)/groups/actions', () => ({
  createMember: vi.fn(), patchMember: vi.fn(), linkMember: vi.fn(),
  revealSensitiveField: vi.fn(async () => ({ error: 'no' })),
  searchPeople: vi.fn(async () => []),
  startVerification: vi.fn(), checkVerification: vi.fn(), attestVerification: vi.fn(),
  abandonVerification: vi.fn(),
}))

const { GroupMembers } = await import('@/components/group-members')
const { InitialsTile } = await import('@/components/ui')

const base = {
  status: 'active', notes: null, title: null, first_name: 'J', middle_name: null, last_name: 'T',
  preferred_name: null, date_of_birth: null, date_of_death: null, gender: null, marital_status: null,
  tfn_status: null, place_of_birth: null, smoker: null, primary_citizenship: null,
  secondary_citizenship: null, tax_residency: null, employment_status: null, occupation: null,
  company_name: null, hin: null, chess_pid: null, coffee_preference: null, hints: {},
  is_primary_group: true, email: null, mobile: null, phone_other: null,
  address: { line1: null, line2: null, suburb: null, state: null, postcode: null },
  postal_address: { line1: null, line2: null, suburb: null, state: null, postcode: null },
  postal_same_as_residential: true, roles: [], other_groups: [], verifications: [],
} as unknown as Omit<PersonDetail, 'party_id' | 'display_name' | 'is_person' | 'member_role'>

const janet: PersonDetail = { ...base, party_id: 'p1', display_name: 'Janet Testsmith', is_person: true, member_role: 'primary' }
const trust: PersonDetail = { ...base, party_id: 'p2', display_name: 'Testsmith Family Trust', is_person: false, member_role: 'entity' }

/** Rows in the visible sheet, not inside any (closed) member-panel dialog. */
const rows = () => screen.getAllByRole('listitem').filter((el) => !el.closest('dialog'))

describe('GroupMembers', () => {
  test('a person is a button that opens their record; an entity is not', () => {
    render(<GroupMembers groupId="g1" groupName="Testsmith Household" members={[janet, trust]} />)
    const [person, entity] = rows()
    expect(person.querySelector('button')).toBeTruthy()
    expect(entity.querySelector('button')).toBeNull()
    expect(entity.textContent).toContain('Testsmith Family Trust')
  })

  test('the role reads as the second line, in words', () => {
    render(<GroupMembers groupId="g1" groupName="Testsmith Household" members={[janet, trust]} />)
    expect(rows()[0].textContent).toContain('primary')
    // underscores never reach the screen
    expect(rows()[1].textContent).not.toContain('_')
  })

  test('a deceased member is marked on the row', () => {
    render(<GroupMembers groupId="g1" groupName="Testsmith Household" members={[{ ...janet, date_of_death: '2026-01-01' }]} />)
    expect(rows()[0].textContent).toContain('Deceased')
  })

  test('no members shows the message and still offers Add member', () => {
    render(<GroupMembers groupId="g1" groupName="Testsmith Household" members={[]} />)
    expect(screen.getByText('No members yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add member/i })).toBeTruthy()
  })
})

describe('InitialsTile', () => {
  const text = (name: string) => render(<InitialsTile name={name} />).container.textContent
  test('two initials from a two-word name', () => expect(text('Janet Testsmith')).toBe('JT'))
  test('at most two, from the first two words', () => expect(text('Testsmith Family Trust')).toBe('TF'))
  test('one initial from one word', () => expect(text('Acme')).toBe('A'))
  test('upper-cased', () => expect(text('rob testsmith')).toBe('RT'))
  test('a placeholder rather than nothing for an empty name', () => expect(text('  ')).toBe('·'))
})
