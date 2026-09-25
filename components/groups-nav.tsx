'use client'

/*
 * A CLIENT component, and the directive is load-bearing in a way jsdom cannot
 * show you: the ICONS map below passes component FUNCTIONS into `SectionNav`,
 * and a function cannot cross a server→client boundary — the page throws
 * "Functions cannot be passed directly to Client Components" at request time,
 * while every unit test (no boundary in jsdom) and the build (this page is
 * never prerendered) stay green. Found live on /groups, 25 Sep 2026, minutes
 * after the extraction that removed the directive. `section-nav-boundary`
 * is the test that now stands where the compiler does not.
 */
import type { ComponentType } from 'react'
import { BuildingIcon, GroupIcon, ReferralIcon, StructureIcon } from '@/components/icons'
import { SectionNav } from '@/components/section-nav'
import { GROUP_SECTIONS, type GroupSectionId } from '@/lib/group-sections'

/**
 * The client pages' menu: the four registers, each with a glyph, drawn by
 * `SectionNav` — see that file for how these menus look and why. This file
 * only says what the client side's entries are.
 *
 * The glyphs: people for households; an organisation chart for the structures
 * that hold them — NOT `BuildingIcon`, which the search already spends on
 * providers, and which therefore marks the providers register here too, so
 * the two screens agree on what a building means; and a person sending
 * onward for referral partners.
 */
const ICONS: Record<GroupSectionId, ComponentType<{ className?: string }>> = {
  households: GroupIcon,
  entities: StructureIcon,
  providers: BuildingIcon,
  referrers: ReferralIcon,
}

export function GroupsNav({ current }: { current: GroupSectionId }) {
  return (
    <SectionNav
      label="Client sections"
      current={current}
      items={GROUP_SECTIONS.map((s) => ({ ...s, icon: ICONS[s.id] }))}
    />
  )
}
