import type { PersonDetail } from '@/lib/person'
import { MemberPanel } from './member-panel'
import { InitialsTile, Pill, SHEET, WELL } from './ui'
import { PlusIcon } from './icons'

/**
 * The group's members: a well holding one sheet.
 *
 * This used to be a grey box of white boxed rows — the same boxes-in-a-box
 * that made the accounts list read flat, and it was the last place on the page
 * still built that way. It is now the same object as the ledger in the centre
 * column: a light well, one white sheet lifting off it, hairline-divided rows,
 * a leading tile per row, and the add action as a footer band rather than a
 * loose link underneath. Same tones, same shadow, same rhythm — so the three
 * columns read as one system.
 *
 * The well has NO border of its own. The sheet inside already has one, and two
 * hairlines twelve pixels apart is exactly the outlined-regions look this
 * replaces.
 *
 * Extracted from the page so a preview can render the real component rather
 * than a copy of its markup — copies have drifted before and been mistaken for
 * the thing itself.
 */
export function GroupMembers({
  groupId,
  groupName,
  members,
}: {
  groupId: string
  /** Passed straight through to the panel, whose Memberships tab lists this
   *  group as one row among the person's others and has to name it. */
  groupName: string
  members: PersonDetail[]
}) {
  const role = (m: PersonDetail) => (m.member_role ?? '').replace(/_/g, ' ')

  return (
    <div className={`mt-5 rounded-lg p-3 ${WELL}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Members</h3>

      <div className={`mt-2.5 ${SHEET}`}>
        {members.length ? (
          <ul className="divide-y divide-neutral-200/80">
            {members.map((m) =>
              m.is_person ? (
                <li key={m.party_id}>
                  <MemberPanel
                    groupId={groupId}
                    groupName={groupName}
                    members={members}
                    initialMode="view"
                    initialPartyId={m.party_id}
                  >
                    <InitialsTile name={m.display_name} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-neutral-900">
                          {m.display_name}
                        </span>
                        {m.date_of_death ? <Pill tone="danger">Deceased</Pill> : null}
                      </span>
                      {/* Role as the row's second line, matching every other
                          sheet, rather than right-aligned in small caps where
                          it fought the name for the eye. */}
                      <span className="block truncate text-xs capitalize text-neutral-500">
                        {role(m)}
                      </span>
                    </span>
                  </MemberPanel>
                </li>
              ) : (
                /* A trust or company in the group. Listed for completeness;
                   there is no individual record to open, so no button. */
                <li key={m.party_id} className="flex items-center gap-3 px-3 py-2">
                  <InitialsTile name={m.display_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900">
                      {m.display_name}
                    </span>
                    <span className="block truncate text-xs capitalize text-neutral-500">
                      {role(m)}
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="px-3 py-3 text-sm text-neutral-400">No members yet.</p>
        )}

        {/* The footer band, like a ledger's total row: the action closes the
            sheet rather than dangling under it. Opens the panel searching
            people already on file, because linking an existing record is what
            keeps duplicate people out of the database. */}
        <div className="border-t border-neutral-200 bg-neutral-50">
          <MemberPanel
            groupId={groupId}
            groupName={groupName}
            members={members}
            initialMode="search"
            variant="link"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add member
          </MemberPanel>
        </div>
      </div>
    </div>
  )
}
