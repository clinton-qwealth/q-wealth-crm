/**
 * The loading state for the drill-in from the groups index to a group's file.
 *
 * The shell-level `loading.tsx` does not reach here: a loading boundary is
 * scoped to its segment's direct child slot, and `/groups` → `/groups/[id]`
 * changes a key INSIDE the `groups` segment. Without this file that click —
 * onto the slowest page in the app — would keep the old page painted until the
 * server finished, exactly the behaviour the shell file fixes for tab clicks.
 *
 * Same skeleton as the shell's, on purpose. See `app/(shell)/loading.tsx`.
 */
export { PageSkeleton as default } from '@/components/page-skeleton'
