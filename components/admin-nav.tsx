import type { ComponentType } from 'react'
import { GroupIcon, PulseIcon, WorkflowIcon } from '@/components/icons'
import { SectionNav } from '@/components/section-nav'
import { ADMIN_SECTIONS, type AdminSectionId } from '@/lib/admin-sections'

/**
 * The Administration page's menu: its sections, each with a glyph, drawn by
 * `SectionNav` — which carries the whole of how these menus look and move, and
 * the history of why. This file only says what Administration's entries are.
 *
 * Icons live here, not in `lib/admin-sections.ts`, so that list stays JSX-free
 * and importable by `no-dead-links`. The `Record` over the id union means a
 * new section cannot be added to the list without a glyph being chosen for it
 * — TypeScript refuses the omission.
 */
const ICONS: Record<AdminSectionId, ComponentType<{ className?: string }>> = {
  users: GroupIcon,
  workflows: WorkflowIcon,
  observability: PulseIcon,
}

export function AdminNav({ current }: { current: AdminSectionId }) {
  return (
    <SectionNav
      label="Administration sections"
      current={current}
      items={ADMIN_SECTIONS.map((s) => ({ ...s, icon: ICONS[s.id] }))}
    />
  )
}
