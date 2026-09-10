import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { PageHeading, Placeholder } from '@/components/ui'

/**
 * The client groups INDEX — deliberately empty.
 *
 * This is the page the navbar's Groups item opens, added 10 September. It will
 * become the list a person picks a group from, and picking one will open
 * `/groups/[id]`, which is the detail page that used to live here.
 *
 * **Why the split happened.** The detail page was at `/groups?id=`, with an id
 * in the query string and a fallback to "the first group visible to this staff
 * member" when there was none. Its own comment said group selection "is not
 * built yet — that belongs with the client list." Putting Groups in the navbar
 * made that gap the visible one: a nav item should open a place you choose
 * from, not one arbitrary client's file. So the detail page moved to a path
 * segment and this took its place.
 *
 * **Empty on purpose, and it says so.** The list needs a decision about what a
 * row shows and how the set is scoped, and inventing that now would commit the
 * screen to guesses. The Placeholder is the house treatment for a screen that
 * is planned rather than broken — the same one the workflow detail page's third
 * column uses.
 *
 * The staff check is not decoration: every page inside the shell makes it, and
 * a page that skipped it would be the one that mattered.
 */
export default async function GroupsIndexPage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  return (
    <>
      <PageHeading
        eyebrow="Clients"
        title="Groups"
        description="The households and business entities you look after."
      />

      <div className="col-span-full">
        <Placeholder className="h-64">
          A list of the client groups you can see goes here. Choosing one opens its file.
        </Placeholder>
      </div>
    </>
  )
}
